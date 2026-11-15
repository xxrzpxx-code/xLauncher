const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEYS = { nick: 's', lang: 's', startup: 'b', discord: 'b', errors: 'b', uiScale: 'n', anim: 'b', showNews: 'b', showSrv: 'b', gfx: 'n', entDist: 'n', maxFps: 'n', bgFps: 'b', ramMin: 'n', ramMax: 'n', javaPath: 's', jvmArgs: 's', fullscreen: 'b', resW: 'n', resH: 'n', minimize: 'b' };
const UNIT = { uiScale: '%', entDist: 'x', ramMin: ' GB', ramMax: ' GB' };
const NEWS = [
  { tag: 'Nowe', title: 'Wypuszczenie launchera', text: 'xLauncher 1.0 - pierwsza publiczna wersja.' }
];
const WARD = [['Peleryna', 'cape'], ['Kapelusz', 'hat'], ['Skrzydla', 'wings'], ['Tarcza', 'shield'], ['Aura', 'aura'], ['Zwierzak', 'pet']];
const KLAB = { mods: 'mody', resourcepacks: 'resource packi', shaderpacks: 'shadery' };
const LBL = { fabric: 'Fabric', forge: 'Forge', vanilla: 'Vanilla' };
let S, P = [], SRV = [], VERS = [], busy = false, editId = null, mProf = null, mKind = 'mods', pFilter = 'all', mTimer = 0, selId = null;

const fmt = s => s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min' : (s / 3600).toFixed(1).replace('.', ',') + ' h';
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mln' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' tys.' : String(n);
const ago = t => { if (!t) return 'nigdy nie grano'; const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'dzis' : d + ' dni temu'; };
const javaNeed = v => { const [a, m = 0, p = 0] = v.split('.').map(Number); return a >= 26 ? 25 : m >= 21 || (m === 20 && p >= 5) ? 21 : m >= 18 ? 17 : 8; };
const curProf = () => P.find(x => x.id === mProf);
const lastProf = () => [...P].sort((a, b) => b.last - a.last)[0];
const modsOK = p => p.loader !== 'vanilla';
const shadersOK = p => p.loader === 'fabric';
const note = m => { $('#status').textContent = m; };
const flash = m => { $('#saved').textContent = m; setTimeout(() => $('#saved').textContent = '', 2000); };

// --- nawigacja i delegacja klikniec ---
const go = t => {
  if (t === 'wardrobe' || t === 'servers') return; // w przygotowaniu
  $$('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('on', s.id === t));
  if (t === 'mods') { loadMods(); if (!$('#resList').children.length) searchMods(''); }
};
$$('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
  const a = e.target.closest('[data-act]'); if (!a) return;
  const { act, id, n, ip, port, title } = a.dataset;
  if (act === 'play') play(id);
  if (act === 'select') selectProfile(id);
  if (act === 'edit') openDlg(id);
  if (act === 'pin') togglePin(id);
  if (act === 'dir') api.openDir(id);
  if (act === 'join') { const l = lastProf(); if (l) play(l.id, { host: ip, port: +port }); else alert('Najpierw dodaj profil.'); }
  if (act === 'install') installMod(id, title);
  if (act === 'rm') removeFile(n);
});
$('#min').onclick = () => api.win('min'); $('#close').onclick = () => api.win('close');
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());

// --- profile ---
async function loadProfiles() {
  P = await api.profiles();
  if (!P.find(p => p.id === mProf)) mProf = P[0].id;
  $('#mProf').innerHTML = P.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.mc)} · ${LBL[p.loader]}</option>`).join('');
  $('#mProf').value = mProf;
  renderProfiles(); renderHome(); renderHotbar();
}
function renderProfiles() {
  const q = $('#pSearch').value.trim().toLowerCase();
  const list = P.filter(p => (pFilter === 'all' || p.pinned) && p.name.toLowerCase().includes(q));
  $('#cAll').textContent = P.length; $('#cPin').textContent = P.filter(p => p.pinned).length; $('#cGrp').textContent = list.length;
  $('#profGrid').innerHTML = list.map(p => `<div class="pcard"><div class="pban"></div>
    <button class="pin${p.pinned ? ' on' : ''}" data-act="pin" data-id="${esc(p.id)}" aria-label="Przypnij">★</button>
    <div class="pbody"><b>${esc(p.name)}</b><small>${LBL[p.loader]} ${esc(p.mc)} · Java ${javaNeed(p.mc)}+</small>
      <div class="pact"><button class="play" data-act="play" data-id="${esc(p.id)}">▶ Graj</button><button class="gbtn" data-act="edit" data-id="${esc(p.id)}" aria-label="Edytuj">⚙</button><button class="gbtn" data-act="dir" data-id="${esc(p.id)}" aria-label="Folder">📁</button></div>
      <small>${ago(p.last)} · ${fmt(p.playSec || 0)}</small></div></div>`).join('') || '<p class="muted">Brak profili pasujacych do filtra.</p>';
}
function renderHome() {
  $('#tTime').textContent = fmt(P.reduce((a, p) => a + (p.playSec || 0), 0));
  $('#tProf').textContent = P.length;
  const l = lastProf(); $('#tLast').textContent = l && l.last ? l.name : '—';
  $('#lastList').innerHTML = [...P].sort((a, b) => b.last - a.last).slice(0, 3).map(p => `<div class="lrow"><img class="pico" src="img/block.png" alt=""><div class="pinfo"><b>${esc(p.name)}</b><small>${LBL[p.loader]} ${esc(p.mc)} · ${ago(p.last)}</small></div><button class="play" data-act="play" data-id="${esc(p.id)}">▶ Graj</button></div>`).join('');
}
async function togglePin(id) { P = await api.pinProfile(id); renderProfiles(); }
$$('[data-f]').forEach(b => b.onclick = () => { pFilter = b.dataset.f; $$('[data-f]').forEach(x => x.classList.toggle('on', x === b)); renderProfiles(); });
$('#pSearch').oninput = renderProfiles;
function openDlg(id) {
  editId = id; const p = P.find(x => x.id === id);
  $('#dlgT').textContent = p ? 'Edytuj profil' : 'Nowy profil';
  $('#pName').value = p ? p.name : ''; $('#pVer').value = p ? p.mc : VERS[0]; $('#pLoader').value = p ? p.loader : 'fabric';
  $('#pDel').hidden = !(p && P.length > 1);
  $('#dlg').showModal();
}
const afterChange = async () => { await loadProfiles(); if ($('#mods').classList.contains('on')) loadMods(); };
$('#newProf').onclick = () => openDlg(null);
$('#pCancel').onclick = () => $('#dlg').close();
$('#pSave').onclick = async () => {
  try { await api.saveProfile({ id: editId, name: $('#pName').value, mc: $('#pVer').value, loader: $('#pLoader').value }); $('#dlg').close(); await afterChange(); }
  catch (e) { alert(e.message); }
};
$('#pDel').onclick = async () => { if (confirm('Usunac profil razem z jego modami i swiatami?')) { await api.delProfile(editId); $('#dlg').close(); await afterChange(); } };

// --- hotbar: klik wybiera profil, GRAJ uruchamia ---
function selectProfile(id) { selId = id; renderHotbar(); }
function renderHotbar() {
  if (!P.find(p => p.id === selId)) selId = (lastProf() || P[0]).id;
  const sel = P.find(p => p.id === selId);
  const top = [...P].sort((a, b) => b.last - a.last);
  $('#bigPlayName').textContent = sel ? `${sel.name} · ${sel.mc} · ${LBL[sel.loader]}` : 'Dodaj profil, aby zagrac';
  $('#bigPlay').onclick = () => { if (selId) play(selId); else go('profiles'); };
  $('#hotbar').innerHTML = Array.from({ length: 9 }, (_, i) => top[i]
    ? `<button class="slot filled${top[i].id === selId ? ' sel' : ''}" data-act="select" data-id="${esc(top[i].id)}" title="${esc(top[i].name)}"><em>${i + 1}</em><img class="blk" src="img/block.png" alt=""><small>${esc(top[i].name)}</small></button>`
    : `<div class="slot"><em>${i + 1}</em></div>`).join('');
}

// --- start gry ---
function play(id, server) {
  if (busy) return;
  busy = true; $$('.play,.join').forEach(b => b.disabled = true);
  note(server ? `Dolaczam do ${server.host}...` : 'Sprawdzam pliki gry...');
  api.launch({ id, server });
}
const reset = m => { busy = false; $('#fill').style.width = '0'; note(m || 'Gotowy.'); loadProfiles(); };
api.on('stage', t => note(t));
api.on('update', t => note(t));
api.on('progress', p => { $('#fill').style.width = (p.total ? Math.round(p.task / p.total * 100) : 0) + '%'; note('Pobieram: ' + p.type); });
api.on('started', () => { $('#fill').style.width = '100%'; note('Minecraft uruchomiony. Milej gry!'); });
api.on('closed', () => reset('Gra zamknieta.'));
api.on('error', e => reset(e));

// --- mody / resource packi / shadery ---
const kindOK = p => (mKind === 'shaderpacks' ? shadersOK(p) : mKind === 'mods' ? modsOK(p) : true);
async function loadMods() {
  const p = curProf(); if (!p) return;
  $('#modsInfo').textContent = kindOK(p)
    ? `Profil "${p.name}" · ${p.mc} · ${LBL[p.loader]}. Wyniki sa dobrane pod te wersje i silnik.`
    : (mKind === 'shaderpacks' ? 'Shadery wymagaja profilu Fabric.' : 'Ten profil jest Vanilla. Mody wymagaja Fabric albo Forge.');
  const list = await api.files.list(mProf, mKind);
  $('#modList').innerHTML = list.length ? list.map(m => `<div class="mod">${m.icon ? `<img class="mi" src="${esc(m.icon)}" alt="">` : '<img class="mi" src="img/star.png" alt="">'}<span><b>${esc(m.title || m.name.replace(/\.(jar|zip)$/i, ''))}</b><small>${m.version ? esc(m.version) + ' · ' : ''}${(m.size / 1048576).toFixed(2)} MB</small></span><label class="sw"><input type="checkbox" data-n="${esc(m.name)}" ${m.on ? 'checked' : ''}><i></i></label><button class="del" data-act="rm" data-n="${esc(m.name)}" aria-label="Usun">✕</button></div>`).join('')
    : `<p class="muted">Brak plikow (${KLAB[mKind]}). Dodaj przyciskiem albo przeciagnij je tutaj.</p>`;
}
$('#modList').onchange = e => { if (e.target.matches('input[data-n]')) api.files.toggle(mProf, mKind, e.target.dataset.n, e.target.checked); };
async function removeFile(n) { if (!confirm('Usunac ' + n + '?')) return; await api.files.remove(mProf, mKind, n); loadMods(); }
$('#mProf').onchange = e => { mProf = e.target.value; loadMods(); searchMods($('#mSearch').value.trim()); };
$$('#mKind button').forEach(b => b.onclick = () => {
  mKind = b.dataset.k; $$('#mKind button').forEach(x => x.classList.toggle('on', x === b));
  loadMods(); searchMods($('#mSearch').value.trim());
});
$('#mSearch').oninput = e => { clearTimeout(mTimer); mTimer = setTimeout(() => searchMods(e.target.value.trim()), 400); };
$('#openMods').onclick = () => api.openDir(mProf);
$('#addMods').onclick = async () => { await api.files.add(mProf, mKind); loadMods(); };
const drop = $('#drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = async e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].map(x => api.pathOf(x)); if (f.length) { await api.files.add(mProf, mKind, f); loadMods(); } };

const hitRow = h => `<div class="hit">${h.icon ? `<img class="hi" src="${esc(h.icon)}" alt="">` : '<img class="hi" src="img/star.png" alt="">'}
  <div class="hm"><b>${esc(h.title)}</b><small>${esc(h.author)} · ${fmtN(h.downloads)} pobran</small><p>${esc(h.desc)}</p></div>
  <button class="btn sm" data-act="install" data-id="${esc(h.id)}" data-title="${esc(h.title)}">Zainstaluj</button></div>`;
async function searchMods(q) {
  const p = curProf(); if (!p) return;
  const box = $('#resList');
  $('#resTitle').textContent = q ? 'Wyniki: ' + q : 'Popularne';
  box.innerHTML = '<p class="muted">Szukam na Modrinth...</p>';
  try {
    const hits = await api.mr.search({ kind: mKind, q, mc: p.mc, loader: p.loader });
    box.innerHTML = hits.length ? hits.map(hitRow).join('') : '<p class="muted">Nic nie znaleziono dla tej wersji i silnika.</p>';
    box.querySelectorAll('img.hi').forEach(i => i.onerror = () => i.replaceWith(Object.assign(document.createElement('img'), { className: 'hi', src: 'img/star.png' })));
  } catch (e) { box.innerHTML = `<p class="muted">Nie udalo sie polaczyc z Modrinth (${esc(e.message)}).</p>`; }
}
async function installMod(id, title) {
  const p = curProf(); if (!p) return;
  if (!kindOK(p)) return alert(mKind === 'shaderpacks' ? 'Shadery wymagaja profilu Fabric.' : 'Ten profil jest Vanilla. Mody wymagaja Fabric albo Forge.');
  note('Instaluje: ' + title + '...');
  try { const f = await api.mr.install({ kind: mKind, id, profileId: mProf }); note('Zainstalowano: ' + f); loadMods(); }
  catch (e) { note('Blad: ' + e.message); }
}

// --- konsola ---
const con = $('#con');
api.on('log', t => { con.textContent += t.endsWith('\n') ? t : t + '\n'; if (con.textContent.length > 2e5) con.textContent = con.textContent.slice(-1e5); con.scrollTop = con.scrollHeight; });
$('#clearLog').onclick = () => con.textContent = '';
$('#copyLog').onclick = () => navigator.clipboard.writeText(con.textContent);

// --- serwery partnerskie ---
const srvCard = s => `<div class="scard"><div class="sban" data-bg="${esc(s.bg)}">${esc(s.name)}</div>
  <div class="sbody2"><b>${esc(s.name)}</b><small>${esc(s.ip)}:${s.port}</small><button class="join" data-act="join" data-ip="${esc(s.ip)}" data-port="${s.port}">▶ Dolacz</button></div></div>`;
const paintBanners = () => $$('[data-bg]').forEach(el => el.style.background = `${el.dataset.bg}, url("img/panorama.png") center/cover`);
function renderServers() {
  const q = $('#srvSearch').value.trim().toLowerCase();
  $('#srvGrid').innerHTML = SRV.filter(s => s.name.toLowerCase().includes(q) || s.ip.includes(q)).map(srvCard).join('') || '<p class="muted">Brak serwerow. Dodaj je w pliku servers.json.</p>';
  paintBanners();
}
function renderSrvPreview() { $('#srvPreview').innerHTML = '<p class="muted">Wkrotce</p>'; }
$('#srvSearch').oninput = renderServers;

// --- konto ---
function renderAccount() {
  const ms = S.acctType === 'ms', name = ms ? (S.msName || 'Microsoft') : S.nick;
  $('#whoNick').textContent = S.acctType ? name : 'Zaloguj sie';
  $('#acctType').textContent = !S.acctType ? 'brak konta' : ms ? 'konto Microsoft' : 'tryb offline';
  $('#acctName').textContent = !S.acctType ? 'brak' : ms ? name : name + ' (offline)';
  $('#body').src = 'https://mc-heads.net/body/' + encodeURIComponent(name) + '/170';
}
function openLogin() {
  $('#loginNick').value = S.nick; $('#loginErr').textContent = '';
  $('#loginOut').hidden = !S.acctType;
  $('#loginDlg').showModal();
}
$('#acctBtn').onclick = openLogin; $('#acctChange').onclick = openLogin;
$('#loginClose').onclick = () => $('#loginDlg').close();
$('#loginMs').onclick = async () => {
  $('#loginErr').textContent = 'Otwieram logowanie Microsoft...';
  try { await api.loginMs(); S = await api.getSettings(); renderAccount(); $('#loginDlg').close(); note('Zalogowano kontem Microsoft.'); }
  catch (e) { $('#loginErr').textContent = e.message; }
};
$('#loginOff').onclick = async () => {
  S = await api.loginOffline($('#loginNick').value.trim() || 'Gracz'); renderAccount(); fillSettings();
  $('#loginDlg').close(); note('Tryb offline: ' + S.nick);
};
$('#loginOut').onclick = async () => { S = await api.logout(); renderAccount(); fillSettings(); $('#loginDlg').close(); note('Wylogowano.'); };

// --- ustawienia ---
$$('.snav [data-c]').forEach(b => b.onclick = () => {
  $$('.snav [data-c]').forEach(x => x.classList.toggle('on', x === b));
  $$('.sc').forEach(s => s.classList.toggle('on', s.id === 'c-' + b.dataset.c));
});
const out = el => { const o = document.querySelector(`output[data-for="${el.id}"]`); if (!o) return; const k = el.id.slice(2); o.textContent = k === 'maxFps' && +el.value >= 260 ? 'bez limitu' : el.value + (UNIT[k] || ''); };
$$('input[type=range]').forEach(el => el.addEventListener('input', () => out(el)));
function fillSettings() {
  for (const [k, t] of Object.entries(KEYS)) { const el = $('#s-' + k); if (t === 'b') el.checked = !!S[k]; else el.value = S[k]; }
  $$('input[type=range]').forEach(out);
  $('#acctName').textContent = !S.acctType ? 'brak' : S.acctType === 'ms' ? (S.msName || 'Microsoft') : S.nick + ' (offline)';
}
function collect() {
  const v = {};
  for (const [k, t] of Object.entries(KEYS)) { const el = $('#s-' + k); v[k] = t === 'b' ? el.checked : t === 'n' ? +el.value : el.value.trim(); }
  return v;
}
function applyUi() {
  $('.col').style.zoom = S.uiScale / 100;
  document.body.classList.toggle('noanim', !S.anim);
  $('#newsBox').hidden = !S.showNews; $('#srvBox').hidden = !S.showSrv;
  renderAccount();
}
$('#openSettings').onclick = () => { fillSettings(); $('#setDlg').showModal(); };
$('#sX').onclick = $('#sClose').onclick = () => $('#setDlg').close();
$('#acctChange').onclick = openLogin;
$('#save').onclick = async () => { S = await api.setSettings(collect()); fillSettings(); applyUi(); flash('Zapisano'); };
$('#resetSet').onclick = async () => { if (!confirm('Przywrocic domyslne ustawienia? Profile, mody i konto zostaja.')) return; S = await api.resetSettings(); fillSettings(); applyUi(); flash('Przywrocono'); };
$('#openData').onclick = () => api.openDir(null);
$('#pickJava').onclick = async () => { const p = await api.pickJava(); if (p) $('#s-javaPath').value = p; };

// --- start: ekran powitalny, potem plynne wejscie do launchera ---
(async () => {
  const bar = v => $('#spFill').style.width = v + '%';
  const msg = t => $('#spMsg').textContent = t;
  const t0 = Date.now();
  try {
    msg('Wczytywanie ustawien...'); bar(15);
    S = await api.getSettings(); fillSettings(); applyUi(); bar(35);
    msg('Wczytywanie wersji i profili...');
    VERS = await api.versions(); bar(55);
    $('#pVer').innerHTML = VERS.map(v => `<option>${v}</option>`).join('');
    $('#newsList').innerHTML = NEWS.map(n => `<div class="news"><i>${esc(n.tag)}</i><b>${esc(n.title)}</b><small>${esc(n.text)}</small></div>`).join('');
    $('#cgrid').innerHTML = WARD.map(([n, f]) => `<div class="citem"><img src="img/item-${f}.png" alt=""><b>${esc(n)}</b><small>Wkrotce</small></div>`).join('');
    SRV = await api.servers(); renderSrvPreview(); renderServers(); bar(75);
    msg('Lista profili...');
    await loadProfiles(); bar(100); msg('Gotowe');
    await new Promise(r => setTimeout(r, Math.max(0, 1200 - (Date.now() - t0))));
    $('#splash').classList.add('hide');
    document.body.classList.add('ready');
    setTimeout(() => { $('#splash').hidden = true; }, 700);
    if (!S.acctType) openLogin();
  } catch (e) {
    msg('Blad startu: ' + e.message);
  }
})();
