const { contextBridge, ipcRenderer: r, webUtils } = require('electron');
const inv = (c, ...a) => r.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  getSettings: () => inv('settings:get'),
  setSettings: s => inv('settings:set', s),
  resetSettings: () => inv('settings:reset'),
  versions: () => inv('versions'),
  profiles: () => inv('profiles:list'),
  saveProfile: p => inv('profiles:save', p),
  pinProfile: id => inv('profiles:pin', id),
  delProfile: id => inv('profiles:delete', id),
  servers: () => inv('servers:list'),
  launch: o => inv('game:launch', o),
  openDir: id => inv('folder:open', id),
  openLink: u => inv('link:open', u),
  pickJava: () => inv('java:pick'),
  loginMs: () => inv('auth:ms'),
  loginOffline: nick => inv('auth:offline', nick),
  logout: () => inv('auth:logout'),
  files: {
    list: (i, k) => inv('files:list', i, k),
    toggle: (i, k, n, on) => inv('files:toggle', i, k, n, on),
    remove: (i, k, n) => inv('files:remove', i, k, n),
    add: (i, k, f) => inv('files:add', i, k, f)
  },
  mr: { search: o => inv('mr:search', o), install: o => inv('mr:install', o) },
  pathOf: f => webUtils.getPathForFile(f),
  win: a => r.send('win', a),
  on: (c, f) => r.on(c, (_, d) => f(d))
});
