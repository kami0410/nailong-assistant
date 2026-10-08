const $ = (id) => document.getElementById(id);
const api = window.widget;

const S = {
  cfg: { baseUrl: '', model: '', hasKey: false },
  withShot: false,
  auto: false,
  busy: false,
  pending: null,
  pinned: true
};

function show(view) {
  $('setup').className = 'view' + (view === 'setup' ? '' : ' hidden');
  $('chat').className = 'view' + (view === 'chat' ? '' : ' hidden');
}

function addMsg(kind, text, shot) {
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  div.textContent = text;
  if (shot) {
    const img = document.createElement('img');
    img.className = 'shot';
    img.src = shot;
    div.appendChild(img);
  }
  $('msgs').appendChild(div);
  $('msgs').scrollTop = $('msgs').scrollHeight;
  return div;
}

function setPending(d) {
  S.pending = d || null;
  if (d) {
    $('pendingDesc').textContent = '即将执行：' + d;
    $('pending').style.display = '';
  } else {
    $('pending').style.display = 'none';
  }
}

function setBusy(b) {
  S.busy = b;
  $('sendBtn').className = b ? 'busy' : '';
  $('sendBtn').textContent = b ? '…' : '发送';
}

function renderMode() {
  $('modeToggle').className = S.auto ? 'on' : '';
  $('modeToggle').textContent = S.auto ? '自动执行 ⚡' : '每步确认';
}

function renderStatus() {
  $('status').innerHTML = '<span>' + (S.cfg.model || '未设置模型') + '</span>'
    + '<span class="sb" id="clearBtn">清空</span>'
    + '<span class="sb" id="stopBtn">停止</span>';
  $('clearBtn').onclick = async () => { await api.agentClear(); $('msgs').innerHTML = ''; setPending(null); setBusy(false); };
  $('stopBtn').onclick = async () => { await api.agentStop(); setPending(null); addMsg('sys', '已请求停止'); setBusy(false); };
}

function handle(res) {
  setBusy(false);
  if (!res) { addMsg('sys', '（没有返回）'); return; }
  if (res.error) { addMsg('sys', '⚠ ' + res.error); return; }
  if (res.pending) { setPending(res.desc); return; }
  setPending(null);
  if (res.reply) { addMsg('bot', res.reply); }
}

async function send() {
  if (S.busy) { return; }
  const text = $('msgInput').value.trim();
  if (!text) { return; }
  $('msgInput').value = '';
  addMsg('user', text);
  setPending(null);
  setBusy(true);
  if (S.withShot) { addMsg('sys', '📷 附带当前屏幕截图'); }
  const res = await api.agentSend({ text: text, withShot: S.withShot, auto: S.auto });
  handle(res);
}

async function confirm(choice) {
  setPending(null);
  setBusy(true);
  const res = await api.agentConfirm({ choice: choice });
  handle(res);
}

async function loadCfg() {
  S.cfg = await api.agentCfgGet();
  $('cfgBase').value = S.cfg.baseUrl || '';
  $('cfgModel').value = S.cfg.model || '';
  $('cfgKey').value = S.cfg.hasKey ? '••••••••••••' : '';
  renderStatus();
  show(S.cfg.hasKey ? 'chat' : 'setup');
}

async function saveCfg() {
  const baseUrl = $('cfgBase').value.trim();
  const key = $('cfgKey').value.trim();
  const model = $('cfgModel').value.trim();
  if (!baseUrl || !model || (!key && !S.cfg.hasKey)) {
    $('setupStatus').className = 'err';
    $('setupStatus').textContent = '请把 Base URL、API Key、模型名都填上';
    return;
  }
  $('setupStatus').className = '';
  $('setupStatus').textContent = '保存中…';
  S.cfg = await api.agentCfgSave({ baseUrl: baseUrl, key: key, model: model });
  $('cfgKey').value = '••••••••••••';
  $('setupStatus').textContent = '正在测试连接…';
  const r = await api.agentTest();
  if (r && r.ok) {
    $('setupStatus').textContent = '✓ 连接成功：' + (r.reply || '');
    renderStatus();
    setTimeout(() => show('chat'), 600);
  } else {
    $('setupStatus').className = 'err';
    $('setupStatus').textContent = '✗ 失败：' + ((r && r.error) || '未知错误');
  }
}

(async function init() {
  await loadCfg();
  renderMode();
  const pinState = await api.asstPinGet();
  S.pinned = !!(pinState && pinState.pinned);
  $('pin').className = S.pinned ? 'icobtn on' : 'icobtn';
  $('pin').onclick = async () => {
    S.pinned = !S.pinned;
    $('pin').className = S.pinned ? 'icobtn on' : 'icobtn';
    await api.asstPinSet(S.pinned);
  };
  $('gear').onclick = () => show('setup');
  $('close').onclick = () => api.assistantHide();
  $('saveCfg').onclick = saveCfg;
  $('shotToggle').onclick = () => {
    S.withShot = !S.withShot;
    $('shotToggle').className = S.withShot ? 'on' : '';
    $('shotToggle').textContent = S.withShot ? '📷 附带截图 ✓' : '📷 附带截图';
  };
  $('modeToggle').onclick = () => { S.auto = !S.auto; renderMode(); };
  $('sendBtn').onclick = send;
  $('execBtn').onclick = () => confirm('exec');
  $('skipBtn').onclick = () => confirm('skip');
  $('autoBtn').onclick = () => { S.auto = true; renderMode(); confirm('auto'); };
  $('msgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { send(); } });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { api.assistantHide(); } });
  api.onAsstBackdrop((url) => { $('backdrop').src = url; });
  api.onAssistantState((open) => { if (open) { $('msgInput').focus(); } });
  api.onAgentStep((s) => {
    if (!s) { return; }
    if (s.kind === 'shot') { addMsg('sys', s.text || '📷 看屏幕', s.shot); }
    else if (s.kind === 'sys') { addMsg('sys', s.text || '', s.shot || null); }
  });

  if (location.search.indexOf('debug=1') !== -1) {
    setInterval(() => {
      const rect = (id) => {
        const el = $(id);
        if (!el) { return null; }
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height };
      };
      api.debugDumpAsst({
        view: ($('setup').className.indexOf('hidden') < 0) ? 'setup' : 'chat',
        hasKey: S.cfg.hasKey,
        auto: S.auto,
        busy: S.busy,
        rects: {
          cfgBase: rect('cfgBase'), cfgKey: rect('cfgKey'), cfgModel: rect('cfgModel'),
          saveCfg: rect('saveCfg'), gear: rect('gear'), close: rect('close'),
          shotToggle: rect('shotToggle'), modeToggle: rect('modeToggle'),
          msgInput: rect('msgInput'), sendBtn: rect('sendBtn'),
          execBtn: rect('execBtn'), skipBtn: rect('skipBtn'), autoBtn: rect('autoBtn')
        }
      });
    }, 800);
  }
})();
