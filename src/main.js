const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client, Authenticator } = require('minecraft-launcher-core');
const CFG = (() => { try { return require('./config.json'); } catch { return {}; } })();
app.setName('xLauncher');
app.setAppUserModelId('pl.xlauncher.app');
// kazde okno (takze okno logowania Microsoft z biblioteki msmc) dostaje logo xLaunchera i wlasny tytul
app.on('browser-window-created', (_, w) => {
  w.setIcon(path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
  w.setTitle('xLauncher');
  w.on('page-title-updated', e => { e.preventDefault(); w.setTitle('xLauncher'); });
});

const UA = 'xLauncher/2.5 (personal launcher)';
const DEF = () => ({
  acctType: '', msName: '', nick: 'Gracz', lang: 'pl', startup: false, discord: true, errors: false,
  uiScale: 100, anim: true, showNews: true, showSrv: true,
  gfx: 1, entDist: 1, maxFps: 120, bgFps: true,
  ramMin: 1, ramMax: 4, javaPath: '', jvmArgs: '',
  fullscreen: false, resW: 1280, resH: 720, minimize: true,
  gameDir: path.join(app.getPath('userData'), 'minecraft')
});
const TYPES = { acctType: 's', msName: 's', nick: 's', lang: 's', startup: 'b', discord: 'b', errors: 'b', uiScale: 'n', anim: 'b', showNews: 'b', showSrv: 'b', gfx: 'n', entDist: 'n', maxFps: 'n', bgFps: 'b', ramMin: 'n', ramMax: 'n', javaPath: 's', jvmArgs: 's', fullscreen: 'b', resW: 'n', resH: 'n', minimize: 'b' };
const LOADERS = ['fabric', 'forge', 'vanilla'];
const LBL = { fabric: 'Fabric', forge: 'Forge', vanilla: 'Vanilla' };
const KIND = {
  mods: { dir: 'mods', ext: 'jar', pt: 'mod' },
  resourcepacks: { dir: 'resourcepacks', ext: 'zip', pt: 'resourcepack' },
  shaderpacks: { dir: 'shaderpacks', ext: 'zip', pt: 'shader', loader: 'iris' }
};
const kind = k => { if (!KIND[k]) throw new Error('Zly typ: ' + k); return KIND[k]; };
const loaderOf = (k, p) => (k === 'mods' ? p.loader : KIND[k].loader);
const ud = f => path.join(app.getPath('userData'), f);
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(ud(f), 'utf8')); } catch { return d; } };
const wj = (f, o) => { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(ud(f), JSON.stringify(o, null, 2)); return o; };
const load = () => ({ ...DEF(), ...rj('settings.json', {}) });
const profiles = () => { const p = rj('profiles.json', null); return p && p.length ? p : wj('profiles.json', [{ id: 'default', name: 'Domyslny', mc: '1.21.4', loader: 'fabric', pinned: false, last: 0, playSec: 0 }]); };
const iDir = (s, id) => path.join(s.gameDir, 'instances', path.basename(id));
const readMeta = d => { try { return JSON.parse(fs.readFileSync(path.join(d, 'xl-meta.json'), 'utf8')); } catch { return {}; } };
const writeMeta = (d, o) => fs.writeFileSync(path.join(d, 'xl-meta.json'), JSON.stringify(o, null, 2));
const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
// rozpoznaje pliki po sumie SHA-1 w Modrinth (dziala tez dla modow pobranych wczesniej)
async function identify(d, files) {
  const meta = readMeta(d);
  const todo = files.filter(f => !meta[f.replace(/\.disabled$/, '')]);
  if (!todo.length) return meta;
  try {
    const byHash = {};
    for (const f of todo) byHash[sha1(path.join(d, f))] = f.replace(/\.disabled$/, '');
    const r = await fetch('https://api.modrinth.com/v2/version_files', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: Object.keys(byHash), algorithm: 'sha1' }) });
    if (r.ok) {
      const found = await r.json();
      for (const [h, v] of Object.entries(found)) {
        const name = byHash[h]; if (!name || !v) continue;
        const info = await mr(`/project/${v.project_id}`).catch(() => ({}));
        meta[name] = { title: info.title || name, icon: info.icon_url || '', version: v.version_number || '', id: v.project_id };
      }
      for (const name of Object.values(byHash)) if (!meta[name]) meta[name] = { none: true };
      writeMeta(d, meta);
    }
  } catch {}
  return meta;
}
const kDir = (id, k) => path.join(iDir(load(), id), kind(k).dir);
const reOf = k => new RegExp('\\.' + kind(k).ext + '(\\.disabled)?$', 'i');
const javaBin = s => { const j = s.javaPath.trim(); if (process.platform !== 'win32') return j || 'java'; return j ? j.replace(/java\.exe$/i, 'javaw.exe') : 'javaw'; };
const mr = async p => { const r = await fetch('https://api.modrinth.com/v2' + p, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('Modrinth HTTP ' + r.status); return r.json(); };
async function fetchTo(url, file) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('Pobieranie HTTP ' + r.status); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); }

let win, running = false, vcache, rpc = null, rpcOn = false, startTs = Date.now();
const send = (ch, d) => win && !win.isDestroyed() && win.webContents.send(ch, d);
process.on('uncaughtException', e => { running = false; send('error', 'Blad: ' + e.message); });

// --- Discord RPC (wymaga ID aplikacji w src/config.json i uruchomionego Discorda) ---
async function rpcSet(details, state, timed) {
  if (!load().discord || !CFG.discordClientId) return;
  try {
    if (!rpc) {
      const DRPC = require('discord-rpc');
      rpc = new DRPC.Client({ transport: 'ipc' });
      rpc.on('disconnected', () => { rpc = null; rpcOn = false; });
      await rpc.login({ clientId: CFG.discordClientId });
    }
    rpcOn = true;
    await rpc.setActivity({ details, state, largeImageKey: 'logo', largeImageText: 'xLauncher', startTimestamp: timed ? startTs : undefined });
  } catch (e) { rpc = null; rpcOn = false; }
}
function rpcClear() { try { if (rpc) rpc.destroy(); } catch {} rpc = null; rpcOn = false; }

// --- konto: Microsoft (msmc) albo offline; token zaszyfrowany przez systemowy magazyn ---
const AUTH_FILE = 'auth.bin';
const saveAuth = a => { try { if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(ud(AUTH_FILE), safeStorage.encryptString(JSON.stringify({ a, t: Date.now() })).toString('base64')); } catch {} };
const loadAuth = () => { try { const o = JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(ud(AUTH_FILE), 'utf8'), 'base64'))); return Date.now() - o.t < 20 * 3600e3 ? o.a : null; } catch { return null; } };
const clearAuth = () => fs.rmSync(ud(AUTH_FILE), { force: true });
async function msLogin() {
  const { Auth } = require('msmc');
  const xb = await new Auth('select_account').launch('electron');
  const mc = await xb.getMinecraft();
  const a = mc.mclc();
  saveAuth(a);
  wj('settings.json', { ...load(), acctType: 'ms', msName: a.name });
  return a;
}
const getAuth = async s => (s.acctType === 'ms' ? (loadAuth() || await msLogin()) : Authenticator.getAuth(s.nick));

// --- automatyczne aktualizacje (dzialaja tylko w zainstalowanej wersji exe, nie przy npm start) ---
function setupUpdater() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => send('update', `Dostepna aktualizacja ${i.version}. Pobieram...`));
  autoUpdater.on('download-progress', p => send('update', `Pobieram aktualizacje: ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', i => send('update', `Wersja ${i.version} gotowa. Zainstaluje sie po zamknieciu launchera.`));
  autoUpdater.on('error', () => {});
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1280, height: 780, minWidth: 1100, minHeight: 680, frame: false, backgroundColor: '#0a0a0b', title: 'xLauncher', icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.removeMenu(); win.loadFile(path.join(__dirname, 'index.html'));
  setTimeout(() => rpcSet('W launcherze', 'Wybiera profil', false), 1500);
  setupUpdater();
});
app.on('window-all-closed', () => { rpcClear(); app.quit(); });
ipcMain.on('win', (_, a) => { if (a === 'min') win.minimize(); if (a === 'close') win.close(); });

// --- ustawienia ---
ipcMain.handle('settings:get', () => load());
ipcMain.handle('settings:set', (_, p) => {
  const prev = load(), n = { ...prev };
  for (const [k, t] of Object.entries(TYPES)) if (k in p) n[k] = t === 'b' ? !!p[k] : t === 'n' ? (Number(p[k]) || 0) : String(p[k]);
  n.nick = n.nick.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Gracz';
  n.ramMax = Math.min(32, Math.max(1, n.ramMax)); n.ramMin = Math.min(Math.max(1, n.ramMin), n.ramMax);
  n.uiScale = Math.min(130, Math.max(80, n.uiScale));
  n.maxFps = Math.min(260, Math.max(30, n.maxFps)); n.entDist = Math.min(5, Math.max(0.5, n.entDist));
  n.resW = Math.max(640, n.resW); n.resH = Math.max(480, n.resH);
  if (![0, 1, 2].includes(n.gfx)) n.gfx = 1;
  app.setLoginItemSettings({ openAtLogin: n.startup });
  if (prev.discord && !n.discord) rpcClear();
  if (!prev.discord && n.discord) rpcSet('W launcherze', 'Wybiera profil', false);
  return wj('settings.json', n);
});
ipcMain.handle('settings:reset', () => {
  const k = load(); app.setLoginItemSettings({ openAtLogin: false });
  return wj('settings.json', { ...DEF(), acctType: k.acctType, msName: k.msName, nick: k.nick });
});
ipcMain.handle('auth:ms', async () => {
  try { const a = await msLogin(); return { name: a.name, uuid: a.uuid }; }
  catch (e) { throw new Error('Logowanie Microsoft nie powiodlo sie: ' + e.message + ' (potrzebna kupiona gra Minecraft Java Edition)'); }
});
ipcMain.handle('auth:offline', (_, nick) => {
  clearAuth();
  const n = String(nick || 'Gracz').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Gracz';
  return wj('settings.json', { ...load(), acctType: 'offline', nick: n, msName: '' });
});
ipcMain.handle('auth:logout', () => { clearAuth(); return wj('settings.json', { ...load(), acctType: '', msName: '' }); });
ipcMain.handle('versions', async () => {
  if (vcache) return vcache;
  try { const m = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json(); return vcache = m.versions.filter(v => v.type === 'release').slice(0, 45).map(v => v.id); }
  catch { return ['1.21.11', '1.21.4', '1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5']; }
});

// --- profile ---
ipcMain.handle('profiles:list', () => profiles());
ipcMain.handle('profiles:save', (_, p) => {
  const L = profiles();
  if (!/^\d+(\.\d+){1,2}$/.test(p.mc)) throw new Error('Zla wersja');
  const name = String(p.name || '').trim().slice(0, 32) || 'Profil';
  const loader = LOADERS.includes(p.loader) ? p.loader : 'fabric';
  const i = L.findIndex(x => x.id === p.id);
  if (i < 0) L.push({ id: Date.now().toString(36), name, mc: p.mc, loader, pinned: false, last: 0, playSec: 0 });
  else L[i] = { ...L[i], name, mc: p.mc, loader };
  return wj('profiles.json', L);
});
ipcMain.handle('profiles:pin', (_, id) => { const L = profiles(), q = L.find(x => x.id === id); if (q) q.pinned = !q.pinned; return wj('profiles.json', L); });
ipcMain.handle('profiles:delete', (_, id) => {
  const L = profiles(); if (L.length < 2) return L;
  fs.rmSync(iDir(load(), id), { recursive: true, force: true });
  return wj('profiles.json', L.filter(x => x.id !== id));
});
ipcMain.handle('servers:list', () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'servers.json'), 'utf8')); } catch { return []; } });
ipcMain.handle('folder:open', (_, id) => { const s = load(), d = id ? iDir(s, id) : s.gameDir; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });
ipcMain.handle('link:open', (_, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
ipcMain.handle('java:pick', async () => { const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Java', extensions: ['exe'] }], properties: ['openFile'] }); return r.canceled ? null : r.filePaths[0]; });

// --- mody / resource packi / shadery (per profil) ---
ipcMain.handle('files:list', async (_, id, k) => {
  const d = kDir(id, k), re = reOf(k);
  let names;
  try { names = fs.readdirSync(d).filter(f => re.test(f)); } catch { return []; }
  const meta = await identify(d, names);
  return names.map(f => {
    const name = f.replace(/\.disabled$/, ''), x = meta[name] || {};
    return { name, on: !f.endsWith('.disabled'), size: fs.statSync(path.join(d, f)).size, title: x.title, icon: x.icon, version: x.version };
  });
});
ipcMain.handle('files:toggle', (_, id, k, n, on) => { const f = path.join(kDir(id, k), path.basename(n)); fs.renameSync(on ? f + '.disabled' : f, on ? f : f + '.disabled'); });
ipcMain.handle('files:remove', (_, id, k, n) => {
  const d = kDir(id, k), base = path.basename(n), f = path.join(d, base);
  fs.rmSync(f, { force: true }); fs.rmSync(f + '.disabled', { force: true });
  const meta = readMeta(d); delete meta[base]; writeMeta(d, meta);
});
ipcMain.handle('files:add', async (_, id, k, files) => {
  const K = kind(k);
  if (!files) { const r = await dialog.showOpenDialog(win, { filters: [{ name: k, extensions: [K.ext] }], properties: ['openFile', 'multiSelections'] }); if (r.canceled) return; files = r.filePaths; }
  const d = kDir(id, k); fs.mkdirSync(d, { recursive: true });
  files.filter(f => f.toLowerCase().endsWith('.' + K.ext)).forEach(f => fs.copyFileSync(f, path.join(d, path.basename(f))));
});

// --- Modrinth: wyszukiwanie i instalacja (loader zalezy od profilu: Fabric / Forge) ---
ipcMain.handle('mr:search', async (_, { kind: k, q, mc, loader }) => {
  const K = kind(k), f = [[`project_type:${K.pt}`]];
  if (mc) f.push([`versions:${mc}`]);
  const ld = k === 'mods' ? loader : K.loader;
  if (ld) f.push([`categories:${ld}`]);
  const d = await mr(`/search?query=${encodeURIComponent(q || '')}&facets=${encodeURIComponent(JSON.stringify(f))}&index=${q ? 'relevance' : 'downloads'}&limit=20`);
  return d.hits.map(h => ({ id: h.project_id, title: h.title, author: h.author, desc: h.description, icon: h.icon_url, downloads: h.downloads }));
});
ipcMain.handle('mr:install', async (_, { kind: k, id, profileId }) => {
  const K = kind(k), p = profiles().find(x => x.id === profileId);
  if (!p) throw new Error('Nie ma takiego profilu.');
  const ld = loaderOf(k, p);
  if (k === 'shaderpacks' && p.loader !== 'fabric') throw new Error('Shadery wymagaja profilu Fabric.');
  if (k === 'mods' && p.loader === 'vanilla') throw new Error('Mody wymagaja profilu Fabric albo Forge.');
  const dir = path.join(iDir(load(), p.id), K.dir); fs.mkdirSync(dir, { recursive: true });
  const gv = `game_versions=${encodeURIComponent(JSON.stringify([p.mc]))}`;
  const lv = ld ? `&loaders=${encodeURIComponent(JSON.stringify([ld]))}` : '';
  const done = new Set();
  const get = async (pid, depth) => {
    const vs = await mr(`/project/${pid}/version?${gv}${lv}`);
    if (!vs.length) throw new Error(`Brak wersji dla ${p.mc}${ld ? ' (' + ld + ')' : ''}.`);
    const v = vs[0], f = v.files.find(x => x.primary) || v.files[0], name = path.basename(f.filename);
    if (!done.has(name)) {
      await fetchTo(f.url, path.join(dir, name)); done.add(name);
      const info = await mr(`/project/${pid}`).catch(() => ({}));
      const meta = readMeta(dir); meta[name] = { title: info.title || name, icon: info.icon_url || '', version: v.version_number || '', id: pid }; writeMeta(dir, meta);
    }
    if (depth === 0 && k === 'mods') for (const d of v.dependencies || []) if (d.dependency_type === 'required' && d.project_id) { try { await get(d.project_id, 1); } catch {} }
    return name;
  };
  return get(id, 0);
});

// --- Fabric ---
async function ensureFabric(root, mc) {
  const j = async u => { const r = await fetch(u); if (!r.ok) throw new Error('Fabric meta: HTTP ' + r.status); return r.json(); };
  const vdir = path.join(root, 'versions');
  try {
    const list = await j(`https://meta.fabricmc.net/v2/versions/loader/${mc}`);
    const L = (list.find(x => x.loader.stable) || list[0]).loader.version, id = `fabric-loader-${L}-${mc}`, f = path.join(vdir, id, id + '.json');
    if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(await j(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${L}/profile/json`))); }
    return id;
  } catch (e) {
    const have = fs.existsSync(vdir) && fs.readdirSync(vdir).filter(d => d.startsWith('fabric-loader-') && d.endsWith('-' + mc)).sort().pop();
    if (have) return have;
    throw new Error('Nie udalo sie pobrac Fabrica (brak internetu lub brak wsparcia dla ' + mc + '). ' + e.message);
  }
}
// --- Forge: pobiera instalator z oficjalnych serwerow (recommended, a gdy brak - latest) ---
async function ensureForge(root, mc) {
  const promos = await (await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { headers: { 'User-Agent': UA } })).json();
  const fv = promos[`${mc}-recommended`] || promos[`${mc}-latest`];
  if (!fv) throw new Error(`Forge nie ma wersji dla Minecraft ${mc}.`);
  const file = path.join(root, 'forge', `forge-${mc}-${fv}-installer.jar`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await fetchTo(`https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${fv}/forge-${mc}-${fv}-installer.jar`, file);
  }
  return file;
}
function applyOptions(dir, kv) {
  const f = path.join(dir, 'options.txt'); let L = [];
  try { L = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
  for (const [k, v] of Object.entries(kv)) { const i = L.findIndex(l => l.startsWith(k + ':')); if (i < 0) L.push(k + ':' + v); else L[i] = k + ':' + v; }
  fs.writeFileSync(f, L.join('\n') + '\n');
}

// --- start gry ---
ipcMain.handle('game:launch', async (_, { id, server } = {}) => {
  if (running) { send('error', 'Gra juz dziala. Poczekaj, az sie zamknie.'); return; }
  running = true;
  const s = load(), p = profiles().find(x => x.id === id), log = t => send('log', String(t));
  try {
    if (!p) throw new Error('Nie ma takiego profilu.');
    if (!s.acctType) throw new Error('Najpierw wybierz konto (Microsoft albo offline).');
    const version = { number: p.mc, type: 'release' }, extra = {};
    if (p.loader === 'fabric') { send('stage', 'Przygotowuje Fabric...'); version.custom = await ensureFabric(s.gameDir, p.mc); }
    if (p.loader === 'forge') { send('stage', 'Przygotowuje Forge (pierwszy raz trwa dluzej)...'); extra.forge = await ensureForge(s.gameDir, p.mc); }
    send('stage', s.acctType === 'ms' ? 'Logowanie Microsoft...' : 'Przygotowuje gre...');
    const authorization = await getAuth(s);
    const dir = iDir(s, p.id);
    ['mods', 'resourcepacks', 'shaderpacks'].forEach(d => fs.mkdirSync(path.join(dir, d), { recursive: true }));
    applyOptions(dir, { graphicsMode: s.gfx, entityDistanceScaling: s.entDist, maxFps: s.maxFps, ...(s.bgFps ? { inactivityFpsLimit: 'minimized' } : {}) });
    const opts = {
      authorization, root: s.gameDir, javaPath: javaBin(s), version,
      memory: { max: s.ramMax + 'G', min: s.ramMin + 'G' }, overrides: { gameDirectory: dir },
      window: { width: s.resW, height: s.resH, fullscreen: s.fullscreen }, ...extra
    };
    if (s.jvmArgs.trim()) opts.customArgs = s.jvmArgs.trim().split(/\s+/);
    if (server && server.host) opts.server = { host: String(server.host), port: String(server.port || 25565) };
    const l = new Client(); let t0 = 0;
    l.on('progress', e => send('progress', { task: e.task, total: e.total, type: e.type }));
    l.on('debug', log);
    l.on('data', d => {
      if (!t0) { t0 = Date.now(); startTs = t0; send('started'); rpcSet(`Gra: ${p.name}`, `${p.mc} · ${LBL[p.loader]}`, true); if (s.minimize) win.minimize(); }
      log(d);
    });
    l.on('close', code => {
      running = false;
      if (t0) { const L = profiles(), q = L.find(x => x.id === id); if (q) { q.playSec = (q.playSec || 0) + Math.round((Date.now() - t0) / 1000); wj('profiles.json', L); } }
      rpcSet('W launcherze', 'Wybiera profil', false);
      if (win && !win.isDestroyed()) { win.restore(); win.show(); }
      send('closed', code);
    });
    if (!await l.launch(opts)) throw new Error('Start nieudany. Sprawdz Jave w Ustawieniach i konsole.');
    const L = profiles(), q = L.find(x => x.id === id); q.last = Date.now(); wj('profiles.json', L);
  } catch (e) { running = false; send('error', e.message); }
});
