const { app, BrowserWindow, ipcMain, screen, desktopCapturer, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const L = require('./renderer/logic.js');

const ROOT = __dirname;
app.setPath('userData', path.join(ROOT, '.userdata'));
app.setName('奶蛙助手');
if (process.platform === 'win32') { app.setAppUserModelId('com.naifrog.naifrog-assistant'); }

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const PET_W = 190, PET_H = 230;
const POP_W = 330, POP_H = 452;
const PET_TITLE = '奶蛙助手';
const POP_TITLE = '奶蛙面板';

const PET_CFG = path.join(ROOT, 'pet.cfg');
const WIDGET_CFG = path.join(ROOT, 'widget.cfg');
const SCHEDULE = path.join(ROOT, 'schedule.txt');
const COUNTDOWN = path.join(ROOT, 'countdown.txt');
const STATE = path.join(ROOT, 'state.json');
const POPUP_CFG = path.join(ROOT, 'popup.cfg');
const POP_BACKDROP = path.join(ROOT, '.cache', 'popup-backdrop.png');
const ASST_BACKDROP = path.join(ROOT, '.cache', 'asst-backdrop.png');
const ICON = path.join(ROOT, 'assets', 'icon.ico');

const ASST_W = 380, ASST_H = 560;
const ASST_TITLE = '奶蛙助手 · 对话';
const MENU_W = 176, MENU_H = 296;
const MENU_TITLE = '奶蛙形态';
const TOOL_W = 336, TOOL_H = 312;
const TOOL_TITLE = '奶蛙工具';
const AGENT_CFG = path.join(ROOT, 'agent.json');
const AGENT_MAX_STEPS = 12;

const DEMO = process.env.WIDGET_DEMO === '1';
const DEMO_SCHEDULE = ['08:30|早餐 · 看一篇论文', '10:00|组会汇报', '14:00|实验：样品制备', '19:30|健身 30 分钟', '21:30|读书 20 页'].join('\r\n');
const DEMO_COUNTDOWN = ['2026-10-31|万圣节', '2026-12-25|圣诞节', '2027-01-01|元旦假期'].join('\r\n');
function demoState() {
  return { done: {}, completedDays: [], streak: 4, settings: { sound: true } };
}

let petWin = null;
let popWin = null;
let watcher = null;
let theme = 0;
let petPos = null;
let state = null;
let asstWin = null;
let menuWin = null;
let toolWin = null;
let petMode = 'normal';
let asstPinned = true;
let inputProc = null;
let agentCfg = { baseUrl: '', model: '', key: '' };
let agentMsgs = [];
let lastShot = null;
let agentSteps = 0;
let agentAuto = false;
let agentAbort = false;
let agentPending = null;

function newAgentSession() {
  return 'nailong-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
let agentSessionId = newAgentSession();

function resetAgentMsgs() {
  agentMsgs = [{ role: 'system', content: AGENT_SYS }];
}

const AGENT_SYS = [
  '你是"奶蛙助手"，一只住在用户 Windows 桌面上的黄色小奶蛙，可以看屏幕并直接操作电脑（真正的 computer use）。',
  '工作方式：',
  '1. 需要了解屏幕时调用 screenshot 工具（不要凭空猜坐标，坐标以最近一次截图像素为准，左上角 0,0）。',
  '2. 需要操作时调用 click / dblclick / rightclick / type / key / scroll / wait / launch 工具，一次调用一个动作。',
  '3. 每次操作后你会自动收到一张最新截图，据此判断是否达成目标，再决定下一步。',
  '4. 达到目标后用简体中文简短汇报结果；不要输出代码块或 JSON 文本。',
  '5. 禁止危险操作（删除文件、付款、发送消息、修改系统设置等）；遇到这类需求先停下来询问用户。',
  '6. 尽量少截图、少动作，能一步完成就不要拆成多步。'
].join('\n');

const CU_TOOLS = [
  { type: 'function', function: { name: 'screenshot', description: '截取当前主屏幕画面并返回图片。需要查看屏幕或确认操作结果时调用。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'click', description: '在屏幕坐标单击左键', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'dblclick', description: '在屏幕坐标双击左键', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'rightclick', description: '在屏幕坐标单击右键', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'type', description: '向当前焦点输入文字', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'key', description: '按下按键或组合键，如 "enter"、"ctrl+s"、"win+r"', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'scroll', description: '滚动鼠标滚轮，正数向下、负数向上', parameters: { type: 'object', properties: { dy: { type: 'integer' } }, required: ['dy'] } } },
  { type: 'function', function: { name: 'wait', description: '等待若干毫秒（界面加载时使用）', parameters: { type: 'object', properties: { ms: { type: 'integer' } }, required: ['ms'] } } },
  { type: 'function', function: { name: 'launch', description: '启动应用或打开网址，如 "notepad"、"explorer"、"https://www.baidu.com"', parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } } }
];

function loadAgentCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(AGENT_CFG, 'utf8'));
    let key = '';
    if (raw.keyEnc) {
      try { key = safeStorage.decryptString(Buffer.from(raw.keyEnc, 'base64')); } catch (e) { key = ''; }
    } else if (raw.key) {
      key = String(raw.key);
    }
    agentCfg = { baseUrl: String(raw.baseUrl || ''), model: String(raw.model || ''), key: key };
  } catch (e) { }
}

function saveAgentCfg() {
  const out = { baseUrl: agentCfg.baseUrl, model: agentCfg.model };
  try {
    if (agentCfg.key && safeStorage.isEncryptionAvailable()) {
      out.keyEnc = safeStorage.encryptString(agentCfg.key).toString('base64');
    } else {
      out.key = agentCfg.key;
    }
  } catch (e) { out.key = agentCfg.key; }
  try { fs.writeFileSync(AGENT_CFG, JSON.stringify(out), 'utf8'); } catch (e) { }
}

function ensureInput() {
  if (inputProc && !inputProc.killed && inputProc.stdin && inputProc.stdin.writable) { return inputProc; }
  try {
    inputProc = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', path.join(ROOT, 'native', 'agent_input.ps1')
    ], { windowsHide: true });
    inputProc.stdout.on('data', () => { });
    inputProc.on('error', () => { inputProc = null; });
    inputProc.on('exit', () => { inputProc = null; });
  } catch (e) { inputProc = null; }
  return inputProc;
}

function inputCmd(cmd) {
  const p = ensureInput();
  if (p && p.stdin && p.stdin.writable) { p.stdin.write(cmd + '\n'); }
}

async function captureShot() {
  const overlays = [asstWin, petWin, popWin, toolWin, menuWin].filter((w) => w && !w.isDestroyed() && w.isVisible());
  overlays.forEach((w) => { try { w.setOpacity(0); } catch (e) { } });
  try {
    const disp = screen.getPrimaryDisplay();
    const physW = Math.round(disp.size.width * disp.scaleFactor);
    const physH = Math.round(disp.size.height * disp.scaleFactor);
    const targetW = Math.min(1280, physW);
    const targetH = Math.max(1, Math.round(physH * targetW / physW));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: targetW, height: targetH } });
    if (!sources || !sources.length) { return null; }
    const img = sources[0].thumbnail;
    const sz = img.getSize();
    const jpg = img.toJPEG(72);
    const dataUrl = 'data:image/jpeg;base64,' + jpg.toString('base64');
    lastShot = { physW: physW, physH: physH, sentW: sz.width, sentH: sz.height, dataUrl: dataUrl };
    return lastShot;
  } finally {
    overlays.forEach((w) => { if (w && !w.isDestroyed()) { try { w.setOpacity(1); } catch (e) { } } });
  }
}

function shotContent(text, shot) {
  return [
    { type: 'text', text: text },
    { type: 'image_url', image_url: { url: shot.dataUrl } }
  ];
}

async function callChat(messages, useTools) {
  if (!agentCfg.baseUrl || !agentCfg.key || !agentCfg.model) {
    throw new Error('请先在设置里填写 Base URL、API Key 和模型名');
  }
  const url = agentCfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = { model: agentCfg.model, messages: messages, temperature: 0.1, max_tokens: 2000 };
  if (useTools) { body.tools = CU_TOOLS; body.tool_choice = 'auto'; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + agentCfg.key,
        'User-Agent': 'nailong-assistant/1.0',
        'x-opencode-session': agentSessionId
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error('连接失败：' + String(e.message || e));
  }
  clearTimeout(timer);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = String(t);
    try {
      const j = JSON.parse(t);
      msg = (j && j.error && j.error.message) || j.message || String(t);
    } catch (e) { }
    throw new Error('接口返回 ' + res.status + '：' + msg.slice(0, 300));
  }
  const data = await res.json();
  return (data && data.choices && data.choices[0] && data.choices[0].message) || {};
}

function pickModel(list) {
  const ids = (Array.isArray(list) ? list : []).map((m) => m && (m.id || m.name)).filter((s) => typeof s === 'string' && s);
  if (!ids.length) { return ''; }
  const prefer = [/vl/i, /vision/i, /gpt-4o/i, /gpt-4\.1/i, /omni/i, /claude/i, /gemini/i, /flash/i, /qwen/i, /deepseek/i];
  for (let i = 0; i < prefer.length; i++) {
    const hit = ids.find((id) => prefer[i].test(id));
    if (hit) { return hit; }
  }
  return ids[0];
}

async function fetchModels() {
  if (!agentCfg.baseUrl || !agentCfg.key) { throw new Error('请先填写 Base URL 和 API Key'); }
  const url = agentCfg.baseUrl.replace(/\/+$/, '') + '/models';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + agentCfg.key,
        'User-Agent': 'nailong-assistant/1.0',
        'x-opencode-session': agentSessionId
      }
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error('连接失败：' + String(e.message || e));
  }
  clearTimeout(timer);
  if (!res.ok) { throw new Error('模型列表接口返回 ' + res.status); }
  const data = await res.json();
  const list = (data && (data.data || data.models)) || [];
  const model = pickModel(list);
  if (!model) { throw new Error('没能从 /models 取到模型，请手动填写模型名'); }
  return model;
}

function parseArgs(tc) {
  try { return JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (e) { return {}; }
}

function parseAction(text) {
  const m = /```(?:action|json)?\s*([\s\S]*?)```/.exec(String(text || ''));
  if (!m) { return null; }
  try {
    const obj = JSON.parse(m[1].trim());
    if (obj && obj.type) { return obj; }
  } catch (e) { }
  return null;
}

function stripAction(text) {
  return String(text || '').replace(/```[a-z]*[\s\S]*?```/g, '').trim();
}

async function doAction(a) {
  const sc = lastShot ? (lastShot.physW / Math.max(1, lastShot.sentW)) : 1;
  const cx = (v) => Math.round(Number(v) * sc);
  const cy = (v) => Math.round(Number(v) * sc);
  switch (a.type) {
    case 'click': inputCmd('click ' + cx(a.x) + ' ' + cy(a.y)); return { desc: '点击 (' + cx(a.x) + ',' + cy(a.y) + ')' };
    case 'dblclick': inputCmd('dblclick ' + cx(a.x) + ' ' + cy(a.y)); return { desc: '双击 (' + cx(a.x) + ',' + cy(a.y) + ')' };
    case 'rightclick': inputCmd('rightclick ' + cx(a.x) + ' ' + cy(a.y)); return { desc: '右键 (' + cx(a.x) + ',' + cy(a.y) + ')' };
    case 'move': inputCmd('move ' + cx(a.x) + ' ' + cy(a.y)); return { desc: '移动鼠标到 (' + cx(a.x) + ',' + cy(a.y) + ')' };
    case 'type': inputCmd('type ' + Buffer.from(String(a.text || ''), 'utf8').toString('base64')); return { desc: '输入「' + String(a.text || '').slice(0, 40) + '」' };
    case 'key': inputCmd('key ' + String(a.key || '')); return { desc: '按键 ' + String(a.key || '') };
    case 'scroll': inputCmd('scroll ' + String(a.dy === undefined ? -1 : a.dy)); return { desc: '滚动 ' + String(a.dy === undefined ? -1 : a.dy) };
    case 'wait': {
      const ms = Math.min(5000, Math.max(100, Number(a.ms) || 800));
      await new Promise((r) => setTimeout(r, ms));
      return { desc: '等待 ' + ms + 'ms' };
    }
    case 'launch': {
      const t = String(a.target || '').trim();
      if (!t) { return { desc: '打开（空目标，已忽略）' }; }
      execFile('cmd', ['/c', 'start', '', t], { windowsHide: true }, () => { });
      return { desc: '打开 ' + t };
    }
    default: return { desc: '未知操作（已忽略）' };
  }
}

function describeAction(a) {
  switch (a.type) {
    case 'click': return '点击 (' + a.x + ', ' + a.y + ')';
    case 'dblclick': return '双击 (' + a.x + ', ' + a.y + ')';
    case 'rightclick': return '右键 (' + a.x + ', ' + a.y + ')';
    case 'type': return '输入「' + String(a.text || '').slice(0, 60) + '」';
    case 'key': return '按键 ' + a.key;
    case 'scroll': return '滚动 ' + a.dy;
    case 'launch': return '打开 ' + a.target;
    case 'wait': return '等待 ' + a.ms + 'ms';
    default: return String(a.type);
  }
}

async function runActionAndScreenshot(name, args) {
  const conv = await doAction(Object.assign({ type: name }, args));
  logLine('[agent] ' + JSON.stringify(conv));
  await new Promise((r) => setTimeout(r, 650));
  const s = await captureShot().catch(() => null);
  return { conv: conv, shot: s };
}

async function agentTurn() {
  agentAbort = false;
  for (let i = 0; i < 25; i++) {
    if (agentAbort) { return { reply: '（已停止）' }; }
    const msg = await callChat(agentMsgs, true);
    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length) {
      agentMsgs.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });
      for (const tc of toolCalls) {
        if (agentAbort) { return { reply: '（已停止）' }; }
        const name = tc.function ? tc.function.name : '';
        const args = parseArgs(tc);
        if (name === 'screenshot') {
          const s = await captureShot().catch(() => null);
          if (s) {
            agentMsgs.push({ role: 'tool', tool_call_id: tc.id, content: shotContent('当前屏幕截图 ' + s.sentW + 'x' + s.sentH, s) });
            broadcast('agent-step', { kind: 'shot', text: '📷 看屏幕', shot: s.dataUrl });
          } else {
            agentMsgs.push({ role: 'tool', tool_call_id: tc.id, content: '截图失败' });
          }
          continue;
        }
        if (name === 'wait') {
          const ms = Math.min(6000, Math.max(100, Number(args.ms) || 800));
          await new Promise((r) => setTimeout(r, ms));
          agentMsgs.push({ role: 'tool', tool_call_id: tc.id, content: '已等待 ' + ms + 'ms' });
          broadcast('agent-step', { kind: 'sys', text: '⏳ 等待 ' + ms + 'ms' });
          continue;
        }
        const action = Object.assign({ type: name }, args);
        if (!agentAuto) {
          agentPending = { tcId: tc.id, action: action };
          return { pending: true, desc: describeAction(action) };
        }
        const r = await runActionAndScreenshot(name, args);
        agentMsgs.push({
          role: 'tool', tool_call_id: tc.id,
          content: r.shot ? shotContent('已执行：' + r.conv.desc + '（以下是执行后的最新截图）', r.shot) : '已执行：' + r.conv.desc
        });
        broadcast('agent-step', { kind: 'sys', text: '▶ ' + r.conv.desc, shot: r.shot ? r.shot.dataUrl : null });
      }
      continue;
    }
    const legacy = parseAction(msg.content || '');
    agentMsgs.push({ role: 'assistant', content: msg.content || '' });
    if (legacy) {
      if (!agentAuto) {
        agentPending = { tcId: null, action: legacy };
        return { pending: true, desc: describeAction(legacy) };
      }
      const r = await runActionAndScreenshot(legacy.type, legacy);
      agentMsgs.push({ role: 'user', content: r.shot ? shotContent('（已执行：' + r.conv.desc + '，这是新截图）', r.shot) : '（已执行：' + r.conv.desc + '）' });
      broadcast('agent-step', { kind: 'sys', text: '▶ ' + r.conv.desc, shot: r.shot ? r.shot.dataUrl : null });
      continue;
    }
    return { reply: stripAction(msg.content || '') || '（没有回复内容）' };
  }
  return { reply: '（步骤过多已暂停，可继续下达指令）' };
}

function refreshAsstBackdrop() {
  if (!asstWin || asstWin.isDestroyed() || !asstWin.isVisible()) { return; }
  const r = physRectOf(asstWin);
  execFile('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(ROOT, 'native', 'blur.ps1'),
    '-X', String(r.x), '-Y', String(r.y), '-W', String(r.w), '-H', String(r.h),
    '-Out', ASST_BACKDROP
  ], { windowsHide: true }, (err) => {
    if (err) { return; }
    const url = 'file:///' + ASST_BACKDROP.replace(/\\/g, '/') + '?t=' + Date.now();
    if (asstWin && !asstWin.isDestroyed()) { asstWin.webContents.send('asst-backdrop', url); }
  });
}

function placeAssistant() {
  const wa = screen.getPrimaryDisplay().workArea;
  let pb = { x: wa.x + wa.width - 260, y: wa.y + wa.height - 300, width: 190, height: 230 };
  if (petWin && !petWin.isDestroyed()) { pb = petWin.getBounds(); }
  let x = Math.round(pb.x + pb.width / 2 - ASST_W / 2);
  let y = pb.y - ASST_H - 10;
  if (y < wa.y + 8) { y = pb.y + pb.height + 10; }
  if (y + ASST_H > wa.y + wa.height - 8) { y = wa.y + wa.height - ASST_H - 8; }
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - ASST_W - 8));
  asstWin.setBounds({ x: x, y: y, width: ASST_W, height: ASST_H });
}

function placeNearPet(win, w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  let pb = { x: wa.x + wa.width - 260, y: wa.y + wa.height - 300, width: 190, height: 230 };
  if (petWin && !petWin.isDestroyed()) { pb = petWin.getBounds(); }
  let x = Math.round(pb.x + pb.width / 2 - w / 2);
  let y = pb.y - h - 10;
  if (y < wa.y + 8) { y = pb.y + pb.height + 10; }
  if (y + h > wa.y + wa.height - 8) { y = wa.y + wa.height - h - 8; }
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  win.setBounds({ x: x, y: y, width: w, height: h });
}

function createMenuWindow() {
  menuWin = new BrowserWindow({
    width: MENU_W, height: MENU_H, show: false,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, thickFrame: false,
    title: MENU_TITLE,
    icon: ICON,
    minWidth: MENU_W, minHeight: MENU_H, maxWidth: MENU_W, maxHeight: MENU_H,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  menuWin.loadFile(path.join(ROOT, 'renderer', 'menu.html'));
  forwardLogs(menuWin, 'menu');
  menuWin.on('blur', () => { if (menuWin && menuWin.isVisible()) { menuWin.hide(); } });
  menuWin.on('closed', () => { menuWin = null; });
}

function createToolWindow() {
  toolWin = new BrowserWindow({
    width: TOOL_W, height: TOOL_H, show: false,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, thickFrame: false,
    title: TOOL_TITLE,
    icon: ICON,
    minWidth: TOOL_W, minHeight: TOOL_H, maxWidth: TOOL_W, maxHeight: TOOL_H,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  toolWin.loadFile(path.join(ROOT, 'renderer', 'tool.html'));
  forwardLogs(toolWin, 'tool');
  toolWin.on('closed', () => { toolWin = null; });
}

// ---------- 抓奶蛙小游戏 ----------
const CATCH_SPEED = 520;      // px/s 基准速度
const CATCH_LAUGH_MS = 900;   // 开局先大笑静立
const CATCH_MAX_MS = 30000;   // 单局最长时长（防止无人抓时无限乱跑）
const CATCH_TICK_MS = 16;     // 物理步进
const CATCH_MAXVY = 0.62;     // 垂直分速度上限（相对总速度）
const CATCH_DODGE_R = 96;     // 鼠标离身体多近（DIP）触发躲避
const CATCH_DODGE_MIN = 1.25; // 躲避时速度下限（相对基准）
const CATCH_DODGE_MAX = 1.7;  // 躲避时速度上限（相对基准）
const CATCH_OX = 47, CATCH_OY = 126;  // 精灵在窗口内的偏移（对应 pet.html 的 #pet 定位）
const PET_SIZE_TOL = 24;      // 宠物窗尺寸容差：超出才强纠（避免 1-2px 抖动反复 setBounds）

let catchGame = null;

function catchSend(payload) {
  if (petWin && !petWin.isDestroyed()) { petWin.webContents.send('pet-ping', payload || {}); }
}

function catchDirOf(vx) { return vx >= 0 ? 'running-right' : 'running-left'; }

function catchTune(g, want) {
  const sp = Math.hypot(g.vx, g.vy) || 1;
  let vx = g.vx / sp * want;
  let vy = g.vy / sp * want;
  const maxVy = want * CATCH_MAXVY;
  if (Math.abs(vy) > maxVy) {
    const sgn = vy < 0 ? -1 : 1;
    vy = sgn * maxVy;
    vx = (vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, want * want - vy * vy));
  }
  g.vx = vx;
  g.vy = vy;
}

function startCatchGame() {
  if (!petWin || petWin.isDestroyed()) { return; }
  if (catchGame) { stopCatchGame(false); }
  const b = petWin.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const g = {
    homeX: b.x, homeY: b.y,
    minX: wa.x - CATCH_OX, minY: wa.y - CATCH_OY,
    maxX: wa.x + wa.width - PET_W + CATCH_OX, maxY: wa.y + wa.height - PET_H,
    x: Math.min(Math.max(b.x, wa.x - CATCH_OX), wa.x + wa.width - PET_W + CATCH_OX),
    y: Math.min(Math.max(b.y, wa.y - CATCH_OY), wa.y + wa.height - PET_H),
    vx: 0, vy: 0, dir: '', startAt: Date.now(), last: 0, timer: null, auto: null
  };
  const side = Math.random() < 0.5 ? -1 : 1;
  const ang = (0.22 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1);
  g.vx = side * Math.cos(ang);
  g.vy = Math.sin(ang);
  catchTune(g, CATCH_SPEED * (0.85 + Math.random() * 0.35));
  g.dir = catchDirOf(g.vx);
  catchGame = g;
  catchSend({ action: 'catch-start' });
  g.auto = setTimeout(() => {
    if (catchGame === g) { stopCatchGame(false); }
  }, CATCH_MAX_MS);
  g.timer = setTimeout(() => {
    if (catchGame !== g) { return; }
    g.last = Date.now();
    g.timer = setInterval(catchStep, CATCH_TICK_MS);
  }, CATCH_LAUGH_MS);
}

function catchStep() {
  const g = catchGame;
  if (!g || !petWin || petWin.isDestroyed()) { return; }
  const now = Date.now();
  let dt = (now - g.last) / 1000;
  g.last = now;
  if (!(dt > 0)) { dt = 0; }
  if (dt > 0.08) { dt = 0.08; }
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  let hit = false;
  if (g.x <= g.minX) { g.x = g.minX; g.vx = Math.abs(g.vx); hit = true; }
  else if (g.x >= g.maxX) { g.x = g.maxX; g.vx = -Math.abs(g.vx); hit = true; }
  if (g.y <= g.minY) { g.y = g.minY; g.vy = Math.abs(g.vy); hit = true; }
  else if (g.y >= g.maxY) { g.y = g.maxY; g.vy = -Math.abs(g.vy); hit = true; }
  if (hit) {
    g.vx += (Math.random() - 0.5) * 140;
    g.vy += (Math.random() - 0.5) * 140;
    catchTune(g, CATCH_SPEED * (0.85 + Math.random() * 0.4));
  }
  // 鼠标贴到身上 → 自己转向逃跑
  const cp = screen.getCursorScreenPoint();
  let dx = (g.x + CATCH_OX + 48) - cp.x;
  let dy = (g.y + CATCH_OY + 52) - cp.y;
  let dist = Math.hypot(dx, dy);
  if (dist < CATCH_DODGE_R) {
    if (dist < 6) { dx = -g.vx; dy = -g.vy; dist = Math.hypot(dx, dy); }
    if (dist < 6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = Math.hypot(dx, dy) || 1; }
    const sp = Math.hypot(g.vx, g.vy) || CATCH_SPEED;
    const want = Math.min(CATCH_SPEED * CATCH_DODGE_MAX, Math.max(sp, CATCH_SPEED * CATCH_DODGE_MIN));
    const nx = dx / dist, ny = dy / dist;
    g.vx = g.vx * 0.2 + nx * want * 0.8;
    g.vy = g.vy * 0.2 + ny * want * 0.8;
    catchTune(g, want);
    g.dodges = (g.dodges || 0) + 1;
    if (g.dodges === 1) {
      const sp2 = Math.hypot(g.vx, g.vy) || 1;
      logLine('[dodge] dist=' + dist.toFixed(0) + ' dot=' + ((g.vx * nx + g.vy * ny) / sp2).toFixed(2) + ' speed=' + want.toFixed(0));
    }
  }
  const d = catchDirOf(g.vx);
  if (d !== g.dir) { g.dir = d; catchSend({ action: 'catch-dir', dir: d }); }
  // 必须用 setBounds（带尺寸）：setPosition 在透明无边框窗上每调一次会把窗口撑大约 1px
  petWin.setBounds({ x: Math.round(g.x), y: Math.round(g.y), width: PET_W, height: PET_H });
}

function stopCatchGame(caught) {
  const g = catchGame;
  catchGame = null;
  if (!g) { return 0; }
  if (g.timer) { clearTimeout(g.timer); clearInterval(g.timer); g.timer = null; }
  if (g.auto) { clearTimeout(g.auto); g.auto = null; }
  const ms = Math.max(0, Date.now() - g.startAt - CATCH_LAUGH_MS);
  catchSend({ action: 'catch-end', caught: !!caught, ms: ms });
  const back = () => {
    if (petWin && !petWin.isDestroyed()) { petWin.setBounds({ x: g.homeX, y: g.homeY, width: PET_W, height: PET_H }); }
  };
  if (caught) { setTimeout(back, 2600); } else { back(); }
  return ms;
}
// ---------- 抓奶蛙小游戏 end ----------

// ---------- 拖文件：奶蛙跑到桌面图标旁再确认 ----------
let petWalking = false;
let dropHome = null;

function desktopIconPos(p) {
  return new Promise((resolve) => {
    let name = '';
    try { name = path.basename(p); } catch (e) { }
    if (!name) { resolve(null); return; }
    const b64 = Buffer.from(name, 'utf8').toString('base64');
    execFile('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(ROOT, 'native', 'deskpos.ps1'), '-B64', b64
    ], { windowsHide: true, timeout: 9000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const m = /x=(-?\d+);y=(-?\d+)/.exec(String(stdout || ''));
      if (!m) { resolve(null); return; }
      resolve({ x: parseInt(m[1], 10), y: parseInt(m[2], 10) });
    });
  });
}

function walkPet(tx, ty) {
  return new Promise((resolve) => {
    if (!petWin || petWin.isDestroyed()) { resolve(); return; }
    const b = petWin.getBounds();
    const sx = b.x, sy = b.y;
    const dist = Math.hypot(tx - sx, ty - sy);
    if (dist < 24) { resolve(); return; }
    const dur = Math.min(2800, Math.max(420, (dist / 1150) * 1000));
    const t0 = Date.now();
    let dirLast = '';
    petWalking = true;
    const step = () => {
      if (!petWin || petWin.isDestroyed()) { petWalking = false; resolve(); return; }
      const p = Math.min(1, (Date.now() - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const x = Math.round(sx + (tx - sx) * e);
      const y = Math.round(sy + (ty - sy) * e);
      const dir = (tx >= sx) ? 'running-right' : 'running-left';
      if (dir !== dirLast) { dirLast = dir; catchSend({ action: 'walk', dir: dir }); }
      petWin.setBounds({ x: x, y: y, width: PET_W, height: PET_H });
      if (p >= 1) {
        petWalking = false;
        catchSend({ action: 'walk', dir: '' });
        resolve();
        return;
      }
      setTimeout(step, 16);
    };
    step();
  });
}

async function handleDropFiles(paths) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p.trim() !== '');
  if (!list.length) { return { ok: false }; }
  if (!dropHome && petWin && !petWin.isDestroyed()) {
    const b = petWin.getBounds();
    dropHome = { x: b.x, y: b.y };
  }
  let walked = false;
  const ip = await desktopIconPos(list[0]);
  if (process.env.WIDGET_DEBUG === '1') {
    logLine('[drop] file=' + list[0] + ' icon=' + (ip ? ip.x + ',' + ip.y : 'none'));
  }
  if (ip) {
    const disp = screen.getPrimaryDisplay();
    const s = disp.scaleFactor || 1;
    const icx = ip.x / s, icy = ip.y / s;
    const wa = disp.workArea;
    let wx = Math.round(icx - 100 - 95);
    let wy = Math.round(icy - 178);
    wx = Math.max(wa.x, Math.min(wx, wa.x + wa.width - PET_W));
    wy = Math.max(wa.y, Math.min(wy, wa.y + wa.height - PET_H));
    await walkPet(wx, wy);
    walked = true;
    if (process.env.WIDGET_DEBUG === '1') { logLine('[drop] walked to ' + wx + ',' + wy + ' (dip)'); }
  }
  catchSend({ action: 'drop-ask', paths: list });
  return { ok: true, walked: walked };
}
// ---------- 拖文件 end ----------

function setMode(mode) {
  petMode = mode || 'normal';
  broadcast('mode-changed', petMode);
  if (menuWin && menuWin.isVisible()) { menuWin.hide(); }
  if (petMode === 'assistant') {
    if (toolWin && toolWin.isVisible()) { toolWin.hide(); }
    if (!asstWin || asstWin.isDestroyed()) { createAssistantWindow(); }
    setTimeout(() => {
      if (!asstWin || asstWin.isDestroyed()) { return; }
      placeAssistant();
      asstWin.show();
      asstWin.focus();
      applyAsstPin();
      refreshAsstBackdrop();
    }, asstWin.isVisible() ? 0 : 300);
    broadcast('assistant-state', true);
  } else {
    if (asstWin && !asstWin.isDestroyed() && asstWin.isVisible()) { asstWin.hide(); }
    broadcast('assistant-state', false);
    if (petMode === 'normal' || petMode === 'catch') {
      if (toolWin && toolWin.isVisible()) { toolWin.hide(); }
    } else {
      if (!toolWin || toolWin.isDestroyed()) { createToolWindow(); }
      setTimeout(() => {
        if (!toolWin || toolWin.isDestroyed()) { return; }
        placeNearPet(toolWin, TOOL_W, TOOL_H);
        toolWin.show();
        toolWin.focus();
        toolWin.webContents.send('tool-view', petMode);
      }, toolWin.isVisible() ? 0 : 300);
    }
  }
  if (petMode === 'catch') {
    startCatchGame();
  } else if (catchGame) {
    stopCatchGame(false);
  }
  return petMode;
}

function applyAsstPin() {
  if (!asstWin || asstWin.isDestroyed()) { return; }
  if (asstPinned) {
    try { asstWin.setAlwaysOnTop(true, 'screen-saver'); } catch (e) { try { asstWin.setAlwaysOnTop(true); } catch (e2) { } }
    try { asstWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { }
  } else {
    try { asstWin.setAlwaysOnTop(true, 'floating'); } catch (e) { try { asstWin.setAlwaysOnTop(true); } catch (e2) { } }
    try { asstWin.setVisibleOnAllWorkspaces(false); } catch (e) { }
  }
}

function createAssistantWindow() {
  const debugQuery = process.env.WIDGET_DEBUG === '1' ? { query: { debug: '1' } } : undefined;
  asstWin = new BrowserWindow({
    width: ASST_W, height: ASST_H, show: false,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, thickFrame: false,
    title: ASST_TITLE,
    icon: ICON,
    minWidth: ASST_W, minHeight: ASST_H, maxWidth: ASST_W, maxHeight: ASST_H,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  asstWin.loadFile(path.join(ROOT, 'renderer', 'assistant.html'), debugQuery);
  forwardLogs(asstWin, 'asst');
  asstWin.on('closed', () => { asstWin = null; });
  asstWin.on('move', () => {
    if (!asstWin || asstWin.isDestroyed() || !asstWin.isVisible()) { return; }
    if (asstMoveTimer) { clearTimeout(asstMoveTimer); }
    asstMoveTimer = setTimeout(refreshAsstBackdrop, 600);
  });
}
let saveTimer = null;
let popSaveTimer = null;
let asstMoveTimer = null;
let popupHideTime = 0;
let popupShowTime = 0;

function defaultPetPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - PET_W - 36, y: wa.y + wa.height - PET_H - 36 };
}

function readTheme() {
  try {
    const s = fs.readFileSync(WIDGET_CFG, 'utf8').split(',');
    const t = s.length >= 3 ? parseInt(s[2], 10) : parseInt(s[0], 10);
    if (!isNaN(t) && t >= 0 && t <= 4) { theme = t; }
  } catch (e) { }
}

function readPetPos() {
  try {
    const s = fs.readFileSync(PET_CFG, 'utf8').split(',');
    const x = parseInt(s[0], 10), y = parseInt(s[1], 10);
    if (!isNaN(x) && !isNaN(y)) { return { x, y }; }
  } catch (e) { }
  return defaultPetPos();
}

function writePetPos() {
  try { fs.writeFileSync(PET_CFG, petPos.x + ',' + petPos.y, 'utf8'); } catch (e) { }
}

function writeTheme() {
  try { fs.writeFileSync(WIDGET_CFG, String(theme), 'utf8'); } catch (e) { }
}

function loadScheduleText() {
  try {
    const buf = fs.readFileSync(SCHEDULE);
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      return buf.toString('utf16le').replace(/^\uFEFF/, '');
    }
    return buf.toString('utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    return null;
  }
}

function saveScheduleText(text) {
  try { fs.writeFileSync(SCHEDULE, String(text), 'utf8'); } catch (e) { }
}

function loadCountdownText() {
  try {
    return fs.readFileSync(COUNTDOWN, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    return '';
  }
}

function saveCountdownText(text) {
  try { fs.writeFileSync(COUNTDOWN, String(text), 'utf8'); } catch (e) { }
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (!s.done || typeof s.done !== 'object') { s.done = {}; }
    if (!Array.isArray(s.completedDays)) { s.completedDays = []; }
    if (!s.settings || typeof s.settings !== 'object') { s.settings = { sound: true }; }
    if (typeof s.settings.sound !== 'boolean') { s.settings.sound = true; }
    return s;
  } catch (e) {
    return { done: {}, completedDays: [], settings: { sound: true } };
  }
}

function saveState() {
  try { fs.writeFileSync(STATE, JSON.stringify(state), 'utf8'); } catch (e) { }
}

function computeStreak() {
  const days = {};
  (state.completedDays || []).forEach((d) => { days[d] = true; });
  let d = L.todayStr();
  let streak = 0;
  if (!days[d]) {
    d = L.dateAdd(d, -1);
    if (!days[d]) { return 0; }
  }
  while (days[d]) {
    streak++;
    d = L.dateAdd(d, -1);
  }
  return streak;
}

function statePayload() {
  return {
    done: state.done,
    completedDays: state.completedDays,
    streak: computeStreak(),
    settings: state.settings
  };
}

function scheduleItems() {
  return L.parseSchedule(loadScheduleText() || '');
}

function readPopupPos() {
  try {
    const s = fs.readFileSync(POPUP_CFG, 'utf8').split(',');
    const x = parseInt(s[0], 10), y = parseInt(s[1], 10);
    if (!isNaN(x) && !isNaN(y)) { return { x: x, y: y }; }
  } catch (e) { }
  return null;
}

function dumpPetDbg(tag) {
  if (!petWin || petWin.isDestroyed()) { return; }
  petWin.webContents.executeJavaScript(
    "(function(){var c=document.getElementById('chip');var b=document.getElementById('bubble');" +
    "return JSON.stringify({chip:c?c.className+'::'+c.textContent:'-',bub:b?b.className+'::'+b.textContent.slice(0,40):'-'});})()"
  ).then((r) => { logLine('[petdbg ' + tag + '] ' + r); }).catch((e) => { logLine('[petdbg ' + tag + '] err ' + e.message); });
}

function broadcast(channel, payload) {
  [petWin, popWin].forEach((w) => {
    if (w && !w.isDestroyed()) { w.webContents.send(channel, payload); }
  });
}

function physRectOf(win) {
  const s = screen.getPrimaryDisplay().scaleFactor;
  const b = win.getBounds();
  return {
    x: Math.round(b.x * s), y: Math.round(b.y * s),
    w: Math.round(b.width * s), h: Math.round(b.height * s)
  };
}

function refreshPopupBackdrop() {
  if (!popWin || popWin.isDestroyed() || !popWin.isVisible()) { return; }
  const r = physRectOf(popWin);
  execFile('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(ROOT, 'native', 'blur.ps1'),
    '-X', String(r.x), '-Y', String(r.y), '-W', String(r.w), '-H', String(r.h),
    '-Out', POP_BACKDROP
  ], { windowsHide: true }, (err) => {
    if (err) { console.error('[popup-backdrop]', err.message); return; }
    const url = 'file:///' + POP_BACKDROP.replace(/\\/g, '/') + '?t=' + Date.now();
    if (popWin && !popWin.isDestroyed()) { popWin.webContents.send('popup-backdrop', url); }
  });
}

function pinOnce() {
  execFile('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(ROOT, 'native', 'pin.ps1'),
    '-ProcessId', String(process.pid),
    '-Title', PET_TITLE
  ], { windowsHide: true }, (err) => {
    if (err) { console.error('[pin]', err.message); }
  });
}

function startWatcher() {
  watcher = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', path.join(ROOT, 'native', 'watch.ps1'),
    '-ProcessId', String(process.pid),
    '-Title', PET_TITLE
  ], { windowsHide: true, stdio: 'ignore' });
  watcher.on('error', (e) => console.error('[watch]', e.message));
}

function placePopup() {
  if (!petWin || petWin.isDestroyed()) { return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const stored = readPopupPos();
  if (stored) {
    const x = Math.max(wa.x + 8, Math.min(stored.x, wa.x + wa.width - POP_W - 8));
    const y = Math.max(wa.y + 8, Math.min(stored.y, wa.y + wa.height - POP_H - 8));
    popWin.setBounds({ x: x, y: y, width: POP_W, height: POP_H });
    return;
  }
  const pb = petWin.getBounds();
  let x = Math.round(pb.x + pb.width / 2 - POP_W / 2);
  let y = pb.y - POP_H - 10;
  if (y < wa.y + 8) { y = pb.y + pb.height + 10; }
  if (y + POP_H > wa.y + wa.height - 8) { y = wa.y + wa.height - POP_H - 8; }
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - POP_W - 8));
  popWin.setBounds({ x, y, width: POP_W, height: POP_H });
}

function logLine(s) {
  try { fs.appendFileSync(path.join(ROOT, '.cache', 'log.txt'), s + '\n'); } catch (e) { }
}

function forwardLogs(win, tag) {
  win.webContents.on('console-message', (e, level, message) => {
    logLine('[' + tag + '] ' + message);
  });
  win.webContents.on('render-process-gone', (e, d) => {
    logLine('[' + tag + '] gone: ' + JSON.stringify(d));
  });
}

function createPetWindow() {
  petPos = readPetPos();
  const debugQuery = process.env.WIDGET_DEBUG === '1'
    ? { query: { debug: '1', anim: process.env.WIDGET_PET_ANIM || '', remind: process.env.WIDGET_PET_REMIND || '' } }
    : undefined;
  petWin = new BrowserWindow({
    x: petPos.x, y: petPos.y, width: PET_W, height: PET_H,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, show: false, thickFrame: false,
    title: PET_TITLE,
    icon: ICON,
    minWidth: PET_W, minHeight: PET_H, maxWidth: PET_W, maxHeight: PET_H,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  petWin.setMinimumSize(PET_W, PET_H);
  petWin.setMaximumSize(PET_W, PET_H);
  startWatcher();
  petWin.loadFile(path.join(ROOT, 'renderer', 'pet.html'), debugQuery);
  forwardLogs(petWin, 'pet');
  petWin.once('ready-to-show', () => {
    petWin.setAlwaysOnTop(true);
    petWin.showInactive();
  });
  petWin.on('move', () => {
    if (!petWin || petWin.isDestroyed()) { return; }
    const b = petWin.getBounds();
    petPos = { x: b.x, y: b.y };
    if (b.width > PET_W + PET_SIZE_TOL || b.height > PET_H + PET_SIZE_TOL) {
      petWin.setBounds({ x: b.x, y: b.y, width: PET_W, height: PET_H });
    }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!catchGame && !petWalking) { saveTimer = setTimeout(writePetPos, 600); }
    if (!catchGame && popWin && popWin.isVisible()) { placePopup(); }
  });
  petWin.on('resize', () => {
    if (!petWin || petWin.isDestroyed()) { return; }
    const b = petWin.getBounds();
    if (b.width > PET_W + PET_SIZE_TOL || b.height > PET_H + PET_SIZE_TOL) {
      petWin.setBounds({ x: b.x, y: b.y, width: PET_W, height: PET_H });
    }
  });
  petWin.on('closed', () => app.quit());
}

function createPopupWindow() {
  const debugQuery = process.env.WIDGET_DEBUG === '1' ? { query: { debug: '1' } } : undefined;
  popWin = new BrowserWindow({
    width: POP_W, height: POP_H, show: false,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, thickFrame: false,
    title: POP_TITLE,
    icon: ICON,
    minWidth: POP_W, minHeight: POP_H, maxWidth: POP_W, maxHeight: POP_H,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  popWin.setMinimumSize(POP_W, POP_H);
  popWin.setMaximumSize(POP_W, POP_H);
  popWin.loadFile(path.join(ROOT, 'renderer', 'popup.html'), debugQuery);
  forwardLogs(popWin, 'popup');
  popWin.on('blur', () => {
    if (popWin.isVisible()) {
      popWin.hide();
      popupHideTime = Date.now();
      broadcast('popup-state', false);
    }
  });
  popWin.on('move', () => {
    if (!popWin || popWin.isDestroyed() || !popWin.isVisible()) { return; }
    if (popSaveTimer) { clearTimeout(popSaveTimer); }
    popSaveTimer = setTimeout(() => {
      if (!popWin || popWin.isDestroyed()) { return; }
      const b = popWin.getBounds();
      try { fs.writeFileSync(POPUP_CFG, b.x + ',' + b.y, 'utf8'); } catch (e) { }
    }, 500);
  });
  popWin.on('closed', () => { popWin = null; });
}

ipcMain.handle('pet-init', () => {
  return {
    schedule: DEMO ? DEMO_SCHEDULE : loadScheduleText(),
    countdown: DEMO ? DEMO_COUNTDOWN : loadCountdownText(),
    state: DEMO ? demoState() : statePayload(),
    theme: theme,
    pet: petPos
  };
});

ipcMain.handle('popup-init', () => {
  return {
    schedule: DEMO ? DEMO_SCHEDULE : loadScheduleText(),
    countdown: DEMO ? DEMO_COUNTDOWN : loadCountdownText(),
    state: DEMO ? demoState() : statePayload(),
    theme: theme
  };
});

ipcMain.handle('save-schedule', (e, text) => {
  saveScheduleText(text);
  broadcast('schedule-changed', String(text));
  return true;
});

ipcMain.handle('save-countdown', (e, text) => {
  saveCountdownText(text);
  broadcast('countdown-changed', String(text));
  return true;
});

ipcMain.handle('toggle-done', (e, p) => {
  if (!p || !p.date || !p.key) { return statePayload(); }
  const day = state.done[p.date] || (state.done[p.date] = []);
  const i = day.indexOf(p.key);
  if (i >= 0) { day.splice(i, 1); } else { day.push(p.key); }
  if (day.length === 0) { delete state.done[p.date]; }
  const items = L.itemsOn(scheduleItems(), p.date);
  const keys = items.map(L.keyOf);
  const doneNow = state.done[p.date] || [];
  let complete = keys.length > 0;
  for (let k = 0; k < keys.length; k++) {
    if (doneNow.indexOf(keys[k]) < 0) { complete = false; break; }
  }
  const cd = {};
  (state.completedDays || []).forEach((d) => { cd[d] = true; });
  let becameComplete = false;
  if (complete) {
    if (!cd[p.date]) { becameComplete = true; }
    cd[p.date] = true;
  } else {
    delete cd[p.date];
  }
  state.completedDays = Object.keys(cd).sort();
  saveState();
  const payload = statePayload();
  broadcast('state-changed', payload);
  if (becameComplete && p.date === L.todayStr()) {
    broadcast('celebrate', true);
  }
  return payload;
});

ipcMain.handle('save-settings', (e, partial) => {
  if (partial && typeof partial.sound === 'boolean') {
    state.settings.sound = partial.sound;
  }
  saveState();
  broadcast('settings-changed', state.settings);
  return state.settings;
});

ipcMain.handle('save-popup-pos', (e, p) => {
  if (p) {
    try { fs.writeFileSync(POPUP_CFG, Math.round(p.x) + ',' + Math.round(p.y), 'utf8'); } catch (err) { }
  }
  return true;
});

ipcMain.handle('reset-popup-pos', () => {
  try { fs.unlinkSync(POPUP_CFG); } catch (err) { }
  placePopup();
  return true;
});

ipcMain.handle('open-assistant', () => {
  setMode('assistant');
  return true;
});

ipcMain.handle('assistant-hide', () => {
  if (asstWin && !asstWin.isDestroyed() && asstWin.isVisible()) { asstWin.hide(); }
  broadcast('assistant-state', false);
  if (petMode === 'assistant') { setMode('normal'); }
  return true;
});

ipcMain.handle('open-mode-menu', () => {
  if (!menuWin || menuWin.isDestroyed()) { createMenuWindow(); }
  setTimeout(() => {
    if (!menuWin || menuWin.isDestroyed()) { return; }
    placeNearPet(menuWin, MENU_W, MENU_H);
    menuWin.show();
    menuWin.focus();
    menuWin.webContents.send('mode-current', petMode);
  }, menuWin.isVisible() ? 0 : 200);
  return true;
});

ipcMain.handle('set-mode', (e, mode) => {
  const m = String(mode || 'normal');
  const ok = ['normal', 'assistant', 'countdown', 'alarm', 'coin', 'catch'];
  return setMode(ok.indexOf(m) >= 0 ? m : 'normal');
});

ipcMain.handle('mode-get', () => petMode);

ipcMain.handle('asst-pin-get', () => ({ pinned: asstPinned }));

ipcMain.handle('asst-pin-set', (e, v) => {
  asstPinned = !!v;
  applyAsstPin();
  return { pinned: asstPinned };
});

ipcMain.handle('tool-hide', () => {
  if (toolWin && !toolWin.isDestroyed() && toolWin.isVisible()) { toolWin.hide(); }
  if (petMode !== 'normal' && petMode !== 'assistant') { setMode('normal'); }
  return true;
});

ipcMain.handle('pet-ping', (e, payload) => {
  if (petWin && !petWin.isDestroyed()) { petWin.webContents.send('pet-ping', payload || {}); }
  return true;
});

ipcMain.handle('drop-submit', (e, paths) => handleDropFiles(paths));

ipcMain.handle('pet-event', (e, payload) => {
  const p = payload || {};
  if (p.type === 'catch-hit') {
    if (catchGame) {
      stopCatchGame(true);
      setTimeout(() => {
        if (!catchGame && petMode === 'catch') { setMode('normal'); }
      }, 2600);
    }
    return true;
  }
  if (toolWin && !toolWin.isDestroyed()) { toolWin.webContents.send('pet-event', p); }
  return true;
});

ipcMain.handle('ask-done-event', () => {
  if (dropHome && !petWalking) {
    const h = dropHome;
    dropHome = null;
    walkPet(h.x, h.y);
  }
  return true;
});

function isProtectedPath(p) {
  try {
    const rp = path.resolve(p);
    const rr = path.resolve(ROOT);
    if (rp === rr) { return true; }
    if (rp.toLowerCase().indexOf(rr.toLowerCase() + path.sep) === 0) { return true; }
    if (path.parse(rp).root === rp) { return true; }
  } catch (e) { return true; }
  return false;
}

ipcMain.handle('recycle-paths', (e, paths) => {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p.trim() !== '');
  if (!list.length) { return { ok: 0, fail: 0, err: 'no-path' }; }
  const blocked = [];
  const allowed = [];
  list.forEach((p) => { if (isProtectedPath(p)) { blocked.push(p); } else { allowed.push(p); } });
  if (!allowed.length) { return { ok: 0, fail: list.length, err: '受保护，不能回收' }; }
  const b64 = allowed.map((p) => Buffer.from(p, 'utf8').toString('base64')).join(',');
  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(ROOT, 'native', 'recycle.ps1'), '-B64', b64
    ], { windowsHide: true }, (err, stdout) => {
      if (err) { resolve({ ok: 0, fail: allowed.length + blocked.length, err: String(err.message || err).slice(0, 120) }); return; }
      const out = String(stdout || '');
      const m = /ok=(\d+);fail=(\d+);err=(.*)/.exec(out);
      resolve({
        ok: m ? parseInt(m[1], 10) : 0,
        fail: (m ? parseInt(m[2], 10) : allowed.length) + blocked.length,
        err: m ? m[3].trim() : out.slice(0, 120)
      });
    });
  });
});

ipcMain.handle('agent-cfg-get', () => {
  return { baseUrl: agentCfg.baseUrl, model: agentCfg.model, hasKey: !!agentCfg.key };
});

ipcMain.handle('agent-cfg-save', (e, c) => {
  if (c) {
    if (typeof c.baseUrl === 'string') { agentCfg.baseUrl = c.baseUrl.trim(); }
    if (typeof c.model === 'string') { agentCfg.model = c.model.trim(); }
    if (typeof c.key === 'string' && c.key.trim() !== '' && c.key.indexOf('\u2022') < 0) { agentCfg.key = c.key.trim(); }
    saveAgentCfg();
  }
  return { baseUrl: agentCfg.baseUrl, model: agentCfg.model, hasKey: !!agentCfg.key };
});

ipcMain.handle('agent-test', async () => {
  try {
    const msg = await callChat([{ role: 'user', content: '请只回复两个字：在线' }], false);
    return { ok: true, reply: String(msg.content || '').slice(0, 60) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('agent-detect-model', async () => {
  try {
    const model = await fetchModels();
    return { ok: true, model: model };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('agent-shot', async () => {
  try {
    const s = await captureShot();
    if (!s) { return null; }
    logLine('[agent] shot ' + s.sentW + 'x' + s.sentH + ' phys=' + s.physW + 'x' + s.physH + ' bytes=' + s.dataUrl.length);
    return { dataUrl: s.dataUrl, sentW: s.sentW, sentH: s.sentH, physW: s.physW, physH: s.physH };
  } catch (err) { return null; }
});

ipcMain.handle('agent-send', async (e, p) => {
  const text = String((p && p.text) || '').trim();
  if (!text) { return { error: '请输入内容' }; }
  agentAuto = !!(p && p.auto);
  agentPending = null;
  agentAbort = false;
  let content = text;
  if (p && p.withShot) {
    const s = await captureShot().catch(() => null);
    if (s) { content = shotContent(text + '（这是当前屏幕截图，像素 ' + s.sentW + 'x' + s.sentH + '）', s); }
  }
  agentMsgs.push({ role: 'user', content: content });
  try {
    return await agentTurn();
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

ipcMain.handle('agent-confirm', async (e, p) => {
  const choice = (p && p.choice) || 'exec';
  const pend = agentPending;
  agentPending = null;
  if (!pend) { return { error: '没有待确认的操作' }; }
  const action = pend.action;
  if (choice === 'skip') {
    if (pend.tcId) { agentMsgs.push({ role: 'tool', tool_call_id: pend.tcId, content: '用户跳过了该操作' }); }
    else { agentMsgs.push({ role: 'user', content: '（用户跳过了该操作，请换一种方式或直接结论）' }); }
    broadcast('agent-step', { kind: 'sys', text: '⏭ 已跳过：' + describeAction(action) });
    return await agentTurn().catch((err) => ({ error: String(err.message || err) }));
  }
  if (choice === 'auto') { agentAuto = true; }
  try {
    const r = await runActionAndScreenshot(action.type, action);
    if (pend.tcId) {
      agentMsgs.push({
        role: 'tool', tool_call_id: pend.tcId,
        content: r.shot ? shotContent('已执行：' + r.conv.desc + '（以下是执行后的最新截图）', r.shot) : '已执行：' + r.conv.desc
      });
    } else {
      agentMsgs.push({ role: 'user', content: r.shot ? shotContent('（已执行：' + r.conv.desc + '，这是新截图）', r.shot) : '（已执行：' + r.conv.desc + '）' });
    }
    broadcast('agent-step', { kind: 'sys', text: '▶ ' + r.conv.desc, shot: r.shot ? r.shot.dataUrl : null });
    return await agentTurn();
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

ipcMain.handle('agent-stop', () => {
  agentAbort = true;
  agentPending = null;
  agentSteps = 0;
  return true;
});

ipcMain.handle('agent-clear', () => {
  resetAgentMsgs();
  agentSteps = 0;
  agentPending = null;
  agentAuto = false;
  lastShot = null;
  agentSessionId = newAgentSession();
  return true;
});

ipcMain.handle('save-theme', (e, t) => {
  if (typeof t === 'number' && t >= 0 && t <= 4) {
    theme = t;
    writeTheme();
    broadcast('theme-changed', t);
  }
  return theme;
});

ipcMain.handle('pet-move', (e, p) => {
  if (petWin && !petWin.isDestroyed() && p) {
    petWin.setBounds({ x: Math.round(p.x), y: Math.round(p.y), width: PET_W, height: PET_H });
  }
  return true;
});

ipcMain.handle('pet-move-by', (e, d) => {
  if (petWin && !petWin.isDestroyed() && d) {
    const b = petWin.getBounds();
    petWin.setBounds({
      x: b.x + Math.round(d.dx || 0),
      y: b.y + Math.round(d.dy || 0),
      width: PET_W,
      height: PET_H
    });
  }
  return true;
});

ipcMain.handle('toggle-popup', () => {
  if (!popWin || popWin.isDestroyed()) { return false; }
  if (popWin.isVisible()) {
    popWin.hide();
    popupHideTime = Date.now();
    broadcast('popup-state', false);
    return false;
  }
  if (Date.now() - popupHideTime < 400) { return false; }
  placePopup();
  popupShowTime = Date.now();
  if (fs.existsSync(POP_BACKDROP)) {
    const cached = 'file:///' + POP_BACKDROP.replace(/\\/g, '/') + '?t=' + Date.now();
    popWin.webContents.send('popup-backdrop', cached);
  }
  popWin.show();
  popWin.focus();
  refreshPopupBackdrop();
  broadcast('popup-state', true);
  return true;
});

ipcMain.handle('hide-popup', () => {
  if (popWin && !popWin.isDestroyed() && popWin.isVisible()) {
    popWin.hide();
    popupHideTime = Date.now();
    broadcast('popup-state', false);
  }
  return true;
});

ipcMain.handle('refresh-popup-backdrop', () => {
  refreshPopupBackdrop();
  return true;
});

ipcMain.handle('debug-dump', (e, data) => {
  try { fs.writeFileSync(path.join(ROOT, 'debug_points.json'), JSON.stringify(data, null, 2), 'utf8'); } catch (err) { }
  return true;
});

ipcMain.handle('debug-dump-asst', (e, data) => {
  try { fs.writeFileSync(path.join(ROOT, 'debug_asst.json'), JSON.stringify(data, null, 2), 'utf8'); } catch (err) { }
  return true;
});

ipcMain.handle('close-app', () => {
  app.quit();
  return true;
});

ipcMain.on('set-ignore', (e, ignore) => {
  if (petWin && !petWin.isDestroyed()) {
    petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  }
});

app.whenReady().then(() => {
  state = loadState();
  readTheme();
  loadAgentCfg();
  resetAgentMsgs();
  createPetWindow();
  createPopupWindow();
  createAssistantWindow();
  if (process.env.WIDGET_DEBUG === '1') {
    if (process.env.WIDGET_AGENT_DETECT === '1') {
      setTimeout(async () => {
        try {
          const m = await fetchModels();
          logLine('[detect] model=' + m);
        } catch (e) {
          logLine('[detect] err ' + String(e.message || e));
        }
      }, 4000);
    }
    if (process.env.WIDGET_PET_POPUP === '1') {
      setTimeout(() => {
        if (!popWin || popWin.isDestroyed()) { return; }
        placePopup();
        popWin.show();
        popWin.focus();
        broadcast('popup-state', true);
        refreshPopupBackdrop();
        const pb = popWin.getBounds();
        logLine('[popupdbg] ' + pb.x + ',' + pb.y + ' ' + pb.width + 'x' + pb.height + ' scale=' + screen.getPrimaryDisplay().scaleFactor);
      }, 3500);
    }
    if (process.env.WIDGET_PET_MENU === '1') {
      setTimeout(() => {
        if (!menuWin || menuWin.isDestroyed()) { createMenuWindow(); }
        setTimeout(() => {
          if (!menuWin || menuWin.isDestroyed()) { return; }
          placeNearPet(menuWin, MENU_W, MENU_H);
          menuWin.show();
          menuWin.focus();
          menuWin.webContents.send('mode-current', petMode);
          const mb = menuWin.getBounds();
          logLine('[menudbg] bounds=' + mb.x + ',' + mb.y + ' ' + mb.width + 'x' + mb.height);
          menuWin.webContents.executeJavaScript(
            "(function(){var c=document.getElementById('card');var last=document.querySelectorAll('.item');" +
            "var l=last[last.length-1];var r=l.getBoundingClientRect();var cr=c.getBoundingClientRect();" +
            "return JSON.stringify({cardH:Math.round(cr.height),lastBottom:Math.round(r.bottom),lastText:l.textContent,winH:window.innerHeight});})()"
          ).then((r) => { logLine('[menudbg] dom=' + r); }).catch((e) => { logLine('[menudbg] err ' + e.message); });
        }, 500);
      }, 3500);
    }
    if (process.env.WIDGET_PET_MODE) {      setTimeout(() => {
        setMode(process.env.WIDGET_PET_MODE);
        if (['countdown', 'alarm', 'coin'].indexOf(process.env.WIDGET_PET_MODE) >= 0) {
          setTimeout(() => {
            if (!toolWin || toolWin.isDestroyed()) { return; }
            toolWin.webContents.executeJavaScript(
              "(function(){var c=document.getElementById('card');var v=document.querySelector('.view.on');" +
              "var rows=[].map.call(document.querySelectorAll('.view.on .row'),function(r){return r.clientWidth+'/'+r.scrollWidth;});" +
              "var ins=[].map.call(document.querySelectorAll('.view.on input'),function(i){return i.clientWidth+'/'+i.scrollWidth;});" +
              "return JSON.stringify({winW:window.innerWidth,bodyW:document.body.scrollWidth,cardW:c.clientWidth,cardSW:c.scrollWidth," +
              "viewW:v?v.clientWidth:0,viewSW:v?v.scrollWidth:0,rows:rows,inputs:ins});})()"
            ).then((r) => { logLine('[tooldbg] ' + r); }).catch((e) => { logLine('[tooldbg] err ' + e.message); });
          }, 1500);
          setTimeout(() => {
            if (toolWin && !toolWin.isDestroyed()) {
              const tb = toolWin.getBounds();
              logLine('[tooldbg2] ' + tb.x + ',' + tb.y + ' ' + tb.width + 'x' + tb.height + ' scale=' + screen.getPrimaryDisplay().scaleFactor);
              if (DEMO) {
                toolWin.webContents.executeJavaScript(
                  "(function(){try{localStorage.removeItem('naifrog.tool.coinA');localStorage.removeItem('naifrog.tool.coinB');localStorage.removeItem('naifrog.tool.cdMin');}catch(e){}" +
                  "['coinA','coinB','cdMin'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});return 'cleared';})()"
                ).then((r) => { logLine('[tooldbg2] ' + r); }).catch(() => { });
              }
            }
          }, 1800);
        }
      }, 3500);
    }
    if (process.env.WIDGET_PET_DROP) {
      const target = process.env.WIDGET_PET_DROP;
      setTimeout(() => {
        if (petWin && !petWin.isDestroyed()) { petWin.webContents.send('drop-files', [target]); }
        const bd = (tag) => {
          if (!petWin || petWin.isDestroyed()) { return; }
          const bb = petWin.getBounds();
          logLine('[dropdbg ' + tag + '] bounds=' + bb.x + ',' + bb.y + ' walking=' + petWalking);
        };
        setTimeout(() => { bd('+1.2 移动中'); }, 1200);
        setTimeout(() => { bd('+3.6 应已到达'); dumpPetDbg('drop+3.6'); }, 3600);
        setTimeout(() => {
          if (!petWin || petWin.isDestroyed()) { return; }
          petWin.webContents.executeJavaScript(
            "(function(){var b=document.querySelector('[data-act=recycle]'); if(!b){return 'no-btn';} b.click(); return 'clicked';})()"
          ).then((r) => { logLine('[dropdbg] click=' + r); }).catch((e) => { logLine('[dropdbg] err ' + e.message); });
        }, Math.max(500, parseInt(process.env.WIDGET_PET_DROP_DELAY || '7000', 10) || 7000));
        setTimeout(() => {
          logLine('[dropdbg] fileExists=' + fs.existsSync(target));
          bd('+10.5 应已跑回');
          dumpPetDbg('drop+10.5');
        }, 10500);
      }, 3500);
    }
    if (process.env.WIDGET_PET_CATCH === '1') {      setTimeout(() => {
        setMode('catch');
        const dump = (tag) => {
          dumpPetDbg(tag);
          if (petWin && !petWin.isDestroyed()) {
            const b = petWin.getBounds();
            const cp = screen.getCursorScreenPoint();
            logLine('[catchdbg ' + tag + '] bounds=' + b.x + ',' + b.y + ' game=' + (catchGame ? 'on' : 'off')
              + ' dodges=' + (catchGame ? (catchGame.dodges || 0) : 0)
              + ' cursor=' + cp.x + ',' + cp.y);
          }
        };
        setTimeout(() => { dump('t+2.0'); }, 2000);
        setTimeout(() => { dump('t+4.0'); }, 4000);
        setTimeout(() => { dump('t+6.0'); }, 6000);
        if (process.env.WIDGET_PET_CATCH_CURSOR === '1') {
          const sc = screen.getPrimaryDisplay().scaleFactor;
          const chase = setInterval(() => {
            if (!catchGame) { clearInterval(chase); return; }
            inputCmd('move ' + Math.round((catchGame.x + 95) * sc) + ' ' + Math.round((catchGame.y + 178) * sc));
          }, 120);
        }
      }, 3000);
    }
    if (process.env.WIDGET_PET_SHOT === '1') {
      setTimeout(() => {
        setMode('assistant');
        setTimeout(async () => {
          logLine('[shotdbg] before visible=' + (asstWin && asstWin.isVisible()));
          const s = await captureShot().catch(() => null);
          logLine('[shotdbg] shot=' + (s ? s.sentW + 'x' + s.sentH : 'null'));
          if (s) { try { fs.writeFileSync(path.join(ROOT, 'debug_shot.jpg'), Buffer.from(s.dataUrl.split(',')[1], 'base64')); } catch (e) { } }
          setTimeout(() => {
            logLine('[shotdbg] after visible=' + (asstWin && !asstWin.isDestroyed() && asstWin.isVisible()) + ' minimized=' + (asstWin && asstWin.isMinimized()));
          }, 700);
        }, 1200);
      }, 3000);
    }
    if (process.env.WIDGET_PET_COIN === '1') {
      const ca = process.env.WIDGET_PET_COIN_A || '吃面条';
      const cb = process.env.WIDGET_PET_COIN_B || '吃炒饭';
      setTimeout(() => {
        setMode('coin');
        setTimeout(() => {
          if (petWin && !petWin.isDestroyed()) {
            petWin.webContents.send('pet-ping', { action: 'coin-set', a: ca, b: cb });
            petWin.webContents.send('pet-ping', { action: 'coin-flip', a: ca, b: cb });
          }
          setTimeout(() => { dumpPetDbg('coin+1.2'); }, 1200);
          setTimeout(() => { dumpPetDbg('coin+2.6'); }, 2600);
        }, 800);
      }, 3000);
    }
    if (process.env.WIDGET_PET_CDSEC) {
      const sec = Math.max(2, parseInt(process.env.WIDGET_PET_CDSEC, 10) || 6);
      setTimeout(() => {
        setMode('countdown');
        setTimeout(() => {
          if (petWin && !petWin.isDestroyed()) {
            petWin.webContents.send('pet-ping', { action: 'countdown-start', endAt: Date.now() + sec * 1000, min: sec / 60 });
          }
          setTimeout(() => { dumpPetDbg('t+1.6'); }, 1600);
          setTimeout(() => { dumpPetDbg('t+end'); }, (sec + 2) * 1000);
        }, 800);
      }, 3000);
    }
  }

  setInterval(() => {
    if (!asstPinned || petMode !== 'assistant') { return; }
    if (!asstWin || asstWin.isDestroyed() || !asstWin.isVisible()) { return; }
    if (asstWin.isMinimized()) { asstWin.restore(); asstWin.showInactive(); }
    applyAsstPin();
  }, 1500);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (watcher) { try { watcher.kill(); } catch (e) { } }
});
