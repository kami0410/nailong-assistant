const { contextBridge, ipcRenderer, webUtils } = require('electron');

let dropCb = null;
let dragCb = null;

function pathsFromTransfer(dt) {
  const out = [];
  try {
    const files = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
    for (let i = 0; i < files.length; i++) {
      try {
        const p = webUtils.getPathForFile(files[i]);
        if (p) { out.push(p); }
      } catch (e) { }
    }
  } catch (e) { }
  if (!out.length) {
    const texts = [];
    try { texts.push(dt.getData('text/uri-list') || ''); } catch (e) { }
    try { texts.push(dt.getData('text/plain') || ''); } catch (e) { }
    texts.join('\r\n').split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (s.toLowerCase().indexOf('file:///') === 0) {
        try { out.push(decodeURIComponent(s.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'))); } catch (e) { }
      }
    });
  }
  return out;
}

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (dragCb) { dragCb(true); }
}, true);

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  try { if (e.dataTransfer) { e.dataTransfer.dropEffect = 'copy'; } } catch (err) { }
}, true);

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
    if (dragCb) { dragCb(false); }
  }
}, true);

window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (dragCb) { dragCb(false); }
  const paths = pathsFromTransfer(e.dataTransfer);
  if (paths.length && dropCb) { dropCb(paths); }
}, true);

contextBridge.exposeInMainWorld('widget', {
  petInit: () => ipcRenderer.invoke('pet-init'),
  popupInit: () => ipcRenderer.invoke('popup-init'),
  saveSchedule: (text) => ipcRenderer.invoke('save-schedule', text),
  saveCountdown: (text) => ipcRenderer.invoke('save-countdown', text),
  toggleDone: (p) => ipcRenderer.invoke('toggle-done', p),
  saveSettings: (p) => ipcRenderer.invoke('save-settings', p),
  savePopupPos: (p) => ipcRenderer.invoke('save-popup-pos', p),
  resetPopupPos: () => ipcRenderer.invoke('reset-popup-pos'),
  openAssistant: () => ipcRenderer.invoke('open-assistant'),
  assistantHide: () => ipcRenderer.invoke('assistant-hide'),
  openModeMenu: () => ipcRenderer.invoke('open-mode-menu'),
  asstPinGet: () => ipcRenderer.invoke('asst-pin-get'),
  asstPinSet: (v) => ipcRenderer.invoke('asst-pin-set', v),
  setMode: (m) => ipcRenderer.invoke('set-mode', m),
  modeGet: () => ipcRenderer.invoke('mode-get'),
  toolHide: () => ipcRenderer.invoke('tool-hide'),
  petPing: (p) => ipcRenderer.invoke('pet-ping', p),
  petEvent: (p) => ipcRenderer.invoke('pet-event', p),
  recyclePaths: (paths) => ipcRenderer.invoke('recycle-paths', paths),
  onFilesDropped: (cb) => { dropCb = cb; ipcRenderer.on('drop-files', (e, p) => cb(p)); },
  onFilesDrag: (cb) => { dragCb = cb; },
  dropSubmit: (paths) => ipcRenderer.invoke('drop-submit', paths),
  askDone: () => ipcRenderer.invoke('ask-done-event'),
  onModeChanged: (cb) => ipcRenderer.on('mode-changed', (e, m) => cb(m)),
  onModeCurrent: (cb) => ipcRenderer.on('mode-current', (e, m) => cb(m)),
  onToolView: (cb) => ipcRenderer.on('tool-view', (e, m) => cb(m)),
  onPetPing: (cb) => ipcRenderer.on('pet-ping', (e, p) => cb(p || {})),
  onPetEvent: (cb) => ipcRenderer.on('pet-event', (e, p) => cb(p || {})),
  agentCfgGet: () => ipcRenderer.invoke('agent-cfg-get'),
  agentCfgSave: (c) => ipcRenderer.invoke('agent-cfg-save', c),
  agentTest: () => ipcRenderer.invoke('agent-test'),
  agentDetectModel: () => ipcRenderer.invoke('agent-detect-model'),
  agentShot: () => ipcRenderer.invoke('agent-shot'),
  agentSend: (p) => ipcRenderer.invoke('agent-send', p),
  agentConfirm: (p) => ipcRenderer.invoke('agent-confirm', p),
  onAgentStep: (cb) => ipcRenderer.on('agent-step', (e, s) => cb(s)),
  agentStop: () => ipcRenderer.invoke('agent-stop'),
  agentClear: () => ipcRenderer.invoke('agent-clear'),
  onAsstBackdrop: (cb) => ipcRenderer.on('asst-backdrop', (e, u) => cb(u)),
  onAssistantState: (cb) => ipcRenderer.on('assistant-state', (e, v) => cb(v)),
  saveTheme: (t) => ipcRenderer.invoke('save-theme', t),
  petMove: (p) => ipcRenderer.invoke('pet-move', p),
  petMoveBy: (d) => ipcRenderer.invoke('pet-move-by', d),
  togglePopup: () => ipcRenderer.invoke('toggle-popup'),
  hidePopup: () => ipcRenderer.invoke('hide-popup'),
  setIgnore: (b) => ipcRenderer.send('set-ignore', b),
  refreshPopupBackdrop: () => ipcRenderer.invoke('refresh-popup-backdrop'),
  close: () => ipcRenderer.invoke('close-app'),
  debugDump: (d) => ipcRenderer.invoke('debug-dump', d),
  debugDumpAsst: (d) => ipcRenderer.invoke('debug-dump-asst', d),
  onScheduleChanged: (cb) => ipcRenderer.on('schedule-changed', (e, t) => cb(t)),
  onCountdownChanged: (cb) => ipcRenderer.on('countdown-changed', (e, t) => cb(t)),
  onStateChanged: (cb) => ipcRenderer.on('state-changed', (e, s) => cb(s)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (e, s) => cb(s)),
  onCelebrate: (cb) => ipcRenderer.on('celebrate', (e, v) => cb(v)),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (e, t) => cb(t)),
  onPopupState: (cb) => ipcRenderer.on('popup-state', (e, v) => cb(v)),
  onPopupBackdrop: (cb) => ipcRenderer.on('popup-backdrop', (e, u) => cb(u)),
  onPetBackdrop: (cb) => ipcRenderer.on('pet-backdrop', (e, u) => cb(u))
});
