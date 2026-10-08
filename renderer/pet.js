const L = window.WidgetLogic;
const $ = (id) => document.getElementById(id);
const THEMES = ['奶黄玻璃', '浅色玻璃', '琥珀玻璃', '科技青', '午夜紫'];

const ANIM = {
  idle: { row: 0, frames: 6, fps: 5 },
  waving: { row: 3, frames: 4, fps: 8 },
  jumping: { row: 4, frames: 5, fps: 7 },
  waiting: { row: 6, frames: 6, fps: 5 },
  failed: { row: 5, frames: 8, fps: 8 },
  'running-left': { row: 2, frames: 8, fps: 10 },
  'running-right': { row: 1, frames: 8, fps: 10 },
  work: { work: true, frames: 8, fps: 6 }
};

const WORK_IMG = "../assets/naifrog/work/coding-strip.png";
const WORK_COLS = 4;

const state = {
  allItems: [],
  items: [],
  countdown: [],
  theme: 0,
  settings: { sound: true },
  popupOpen: false,
  assistantOpen: false,
  actionLaugh: 0,
  mode: 'normal',
  cd: null,
  alarm: null,
  coin: { a: '', b: '' },
  coinSpin: 0,
  ping: null,
  alarmLoop: null,
  reminder: null,
  pre: null,
  celebrate: null,
  fired: {},
  preFired: {},
  cycleIdx: 0,
  hover: false,
  dragging: false,
  dragDir: 'running-right',
  lastBubbleKey: null,
  forceAnim: null,
  catchOn: false,
  catchDir: 'running-right',
  catchStartAt: 0,
  ask: null,
  dragHint: false,
  walkDir: null
};

let animName = 'idle';
let catchTick = null;
let frameIdx = 0;
let lastFrameAt = 0;
let audioCtx = null;
var workPreload = new Image();
workPreload.src = WORK_IMG;

function setAnim(name) {
  if (!ANIM[name] || name === animName) { return; }
  animName = name;
  frameIdx = 0;
}

function drawFrame() {
  const pet = $('pet');
  const a = ANIM[animName];
  if (a && a.work) {
    pet.style.backgroundImage = 'url("' + WORK_IMG + '")';
    pet.style.backgroundSize = '384px 208px';
    const col = frameIdx % WORK_COLS;
    const row = Math.floor(frameIdx / WORK_COLS);
    pet.style.backgroundPosition = (-col * 96) + 'px ' + (-row * 104) + 'px';
  } else if (a) {
    if (pet.style.backgroundImage && pet.style.backgroundImage.indexOf('coding-strip') >= 0) {
      pet.style.backgroundImage = '';
    }
    pet.style.backgroundSize = '768px 936px';
    pet.style.backgroundPosition = (-frameIdx * 96) + 'px ' + (-a.row * 104) + 'px';
  }
}

function animLoop(t) {
  const a = ANIM[animName];
  if (!a) { return; }
  if (t - lastFrameAt > 1000 / a.fps) {
    lastFrameAt = t;
    frameIdx = (frameIdx + 1) % a.frames;
    drawFrame();
  }
}

function currentAnim() {
  if (state.forceAnim) { return state.forceAnim; }
  if (state.catchOn) {
    if (Date.now() - state.catchStartAt < 900) { return 'jumping'; }
    return state.catchDir === 'running-left' ? 'running-left' : 'running-right';
  }
  if (state.walkDir) { return state.walkDir; }
  if (state.reminder || state.celebrate) { return 'jumping'; }
  if (state.mode === 'coin' && Date.now() < state.coinSpin) { return 'jumping'; }
  if (state.ping && state.ping.anim && Date.now() < state.ping.until) { return state.ping.anim; }
  if (state.mode === 'assistant' && Date.now() < state.actionLaugh) { return 'jumping'; }
  if (state.mode === 'assistant') { return 'work'; }
  if (state.alarm && state.alarm.ringing) { return 'jumping'; }
  if (state.cd) { return 'waiting'; }
  if (state.pre) { return 'waving'; }
  if (state.dragging) { return state.dragDir; }
  if (state.popupOpen) { return 'waiting'; }
  if (state.hover) { return 'waving'; }
  return 'idle';
}

function beep(freq, dur, delay, vol) {
  try {
    if (!state.settings.sound) { return; }
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = vol || 0.07;
    o.connect(g);
    g.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime + (delay || 0);
    o.start(t0);
    o.stop(t0 + dur);
  } catch (e) { }
}

function playFire() { beep(880, 0.12, 0); beep(1250, 0.16, 0.16); }
function synthHappy() { beep(660, 0.1, 0); beep(880, 0.1, 0.12); beep(1100, 0.2, 0.24); }
function coinDing() { beep(1250, 0.08, 0); beep(1750, 0.12, 0.09); }
function timerEnd() { if (!state.settings.sound) { return; } beep(880, 0.16, 0); beep(880, 0.16, 0.26); beep(1180, 0.32, 0.54); }

function alarmRingStart() {
  if (!state.settings.sound || state.alarmLoop) { return; }
  beep(1000, 0.34, 0);
  beep(760, 0.34, 0.38);
  state.alarmLoop = setInterval(() => {
    if (!state.settings.sound) { return; }
    beep(1000, 0.34, 0);
    beep(760, 0.34, 0.38);
  }, 900);
}

function alarmRingStop() {
  if (state.alarmLoop) { clearInterval(state.alarmLoop); state.alarmLoop = null; }
}

let laughAudio = null;

function playHappy(vol) {
  if (!state.settings.sound) { return; }
  try {
    if (!laughAudio) {
      laughAudio = new Audio('../assets/sounds/laugh.wav');
    }
    laughAudio.volume = (typeof vol === 'number') ? vol : 0.9;
    if (!laughAudio.error) {
      laughAudio.currentTime = 0;
      const p = laughAudio.play();
      if (p && p.catch) { p.catch(() => { synthHappy(); }); }
      return;
    }
  } catch (e) { }
  synthHappy();
}

function bounce() {
  const pet = $('pet');
  pet.classList.add('bounce');
  setTimeout(() => pet.classList.remove('bounce'), 1100);
}

function coinResultText() {
  const a = (state.coin.a || '').trim();
  const b = (state.coin.b || '').trim();
  const head = Math.random() < 0.5;
  if (a && b) { return head ? a : b; }
  return head ? '正面' : '反面';
}

function spinPet(ms) {
  const pet = $('pet');
  pet.classList.remove('spin');
  void pet.offsetWidth;
  pet.classList.add('spin');
  setTimeout(() => pet.classList.remove('spin'), ms || 950);
}

function baseName(p) {
  const s = String(p).split(/[\\/]/);
  return s[s.length - 1] || String(p);
}

function askRecycle(paths) {
  if (!paths || !paths.length) { return; }
  state.ask = { paths: paths.slice(), until: Date.now() + 45000, result: '' };
  state.lastBubbleKey = null;
  renderBubble();
}

async function confirmRecycle() {
  const ask = state.ask;
  if (!ask || ask.result === 'busy') { return; }
  ask.result = 'busy';
  state.lastBubbleKey = null;
  renderBubble();
  let res = null;
  try { res = await window.widget.recyclePaths(ask.paths); } catch (e) { res = null; }
  const ok = (res && res.ok) || 0;
  const fail = (res && typeof res.fail === 'number') ? res.fail : (ask.paths.length - ok);
  state.ask = null;
  if (ok > 0) {
    spinPet(1100);
    playHappy(0.95);
  }
  if (ok > 0 && fail === 0) {
    state.ping = { text: '🗑️ 回收成功 · ' + ok + ' 个，嘿嘿', anim: 'jumping', until: Date.now() + 8000 };
  } else if (ok > 0) {
    state.ping = { text: '🗑️ 回收 ' + ok + ' 个，' + fail + ' 个失败', anim: 'jumping', until: Date.now() + 8000 };
  } else {
    state.ping = { text: '⚠ 没回收成功' + (res && res.err ? '：' + res.err : ''), until: Date.now() + 8000 };
  }
  state.lastBubbleKey = null;
  renderBubble();
  window.widget.askDone();
}

function doCoinFlip() {
  state.coinSpin = Date.now() + 900;
  spinPet(950);
  const res = coinResultText();
  setTimeout(() => {
    coinDing();
    state.ping = { text: '🪙 ' + res, anim: 'jumping', until: Date.now() + 9000 };
    state.lastBubbleKey = null;
    bounce();
    window.widget.petEvent({ type: 'coin-result', result: res });
    renderBubble();
    renderChip();
  }, 860);
}

function dismissCountdown() {
  if (state.cd && state.cd.done) {
    state.cd = null;
    state.ping = null;
    state.lastBubbleKey = null;
    renderBubble();
    renderChip();
  }
}

function dismissAlarm() {
  if (state.alarm && state.alarm.ringing) {
    alarmRingStop();
    state.alarm = null;
    state.ping = null;
    state.lastBubbleKey = null;
    window.widget.petEvent({ type: 'alarm-stopped' });
    renderBubble();
    renderChip();
  }
}

function refreshToday() {
  const today = L.todayStr();
  state.items = L.itemsOn(state.allItems, today);
  if (state.cycleIdx >= Math.max(1, state.items.length)) { state.cycleIdx = 0; }
  state.lastBubbleKey = null;
}

function renderBubble() {
  const bubble = $('bubble');
  if (state.catchOn || state.walkDir) {
    if (bubble.className !== '') { bubble.className = ''; bubble.innerHTML = ''; }
    state.lastBubbleKey = null;
    return;
  }
  let key = '';
  let html = '';
  if (state.ask) {
    const ps = state.ask.paths;
    const raw = baseName(ps[0]);
    const nm = raw.length > 12 ? raw.slice(0, 11) + '…' : raw;
    const label = ps.length === 1 ? nm : (nm + ' 等 ' + ps.length + ' 个');
    key = 'ask:' + ps.join('|') + ':' + state.ask.result;
    if (state.ask.result === 'busy') {
      html = '<div class="bi"><span class="x">🗑️ 正在回收…</span></div>';
    } else {
      html = '<div class="bi"><span class="x">回收「' + L.esc(label) + '」？</span></div>'
        + '<div class="askbtns"><div class="ab yes" data-act="recycle">回收</div><div class="ab no" data-act="cancel">取消</div></div>';
    }
  } else if (state.dragHint) {
    key = 'draghint';
    html = '<div class="bi"><span class="x">松手放进回收站 🗑</span></div>';
  } else if (state.celebrate) {
    key = 'celeb';
    html = '<div class="bi"><span class="x">全部完成，好棒！</span></div>';
  } else if (state.reminder) {
    key = 'r:' + state.reminder.key;
    const it = state.items.find((x) => L.keyOf(x) === state.reminder.key);
    html = '<div class="bi now"><span class="t">' + L.esc(state.reminder.time) + '</span>'
      + '<span class="x">该做：' + L.esc(it ? it.text : state.reminder.text) + '</span></div>';
  } else if (state.ping && Date.now() < state.ping.until) {
    key = 'ping:' + state.ping.text;
    html = '<div class="bi"><span class="x">' + L.esc(state.ping.text) + '</span></div>';
  } else if (state.pre) {
    key = 'p:' + state.pre.key;
    html = '<div class="bi"><span class="x">5 分钟后：' + L.esc(state.pre.text) + '</span></div>';
  } else if (state.mode === 'countdown' && state.cd) {
    key = 'cdn:' + Math.ceil(Math.max(0, state.cd.endAt - Date.now()) / 1000);
    html = '<div class="bi now"><span class="t">⏳</span><span class="x">倒计时 ' + fmtMs(state.cd.endAt - Date.now()) + '</span></div>';
  } else if (state.mode === 'alarm' && state.alarm) {
    key = 'alm:' + state.alarm.hm + (state.alarm.ringing ? ':on' : '');
    html = '<div class="bi' + (state.alarm.ringing ? ' now' : '') + '"><span class="t">⏰</span><span class="x">'
      + (state.alarm.ringing ? '闹钟响啦！点我停止' : '闹钟 ' + state.alarm.hm) + '</span></div>';
  } else if (state.hover) {
    key = 'h:' + state.items.map(L.keyOf).join(';');
    if (!state.items.length) {
      html = '<div class="bi"><span class="x">今天没有日程，点我添加</span></div>';
    } else {
      const max = 6;
      html = state.items.slice(0, max).map((it) => {
        return '<div class="bi"><span class="t">' + L.esc(it.time) + '</span><span class="x">' + L.esc(it.text) + '</span></div>';
      }).join('');
      if (state.items.length > max) { html += '<div class="more">…共 ' + state.items.length + ' 条</div>'; }
    }
  } else {
    const cds = L.nextCountdowns(state.countdown, null, 5);
    const showCd = cds.length > 0 && (state.cycleIdx % 5 === 4 || state.items.length === 0);
    if (state.assistantOpen && state.cycleIdx % 3 === 0) {
      key = 'asst';
      html = '<div class="bi"><span class="x">助手已开启 · 随时待命</span></div>';
    } else if (showCd) {
      const cd = cds[0];
      key = 'cd:' + cd.date + ':' + cd.text;
      html = '<div class="bi"><span class="t">' + (cd.days === 0 ? '今天' : cd.days + ' 天') + '</span>'
        + '<span class="x">' + L.esc(cd.text) + '</span></div>';
    } else if (state.items.length) {
      const it = state.items[state.cycleIdx % state.items.length];
      key = 'c:' + L.keyOf(it);
      html = '<div class="bi"><span class="t">' + L.esc(it.time) + '</span><span class="x">' + L.esc(it.text) + '</span></div>';
    } else {
      key = 'empty';
      html = '<div class="bi"><span class="x">今天没有日程，点我添加</span></div>';
    }
  }
  if (key === state.lastBubbleKey) { return; }
  state.lastBubbleKey = key;
  bubble.className = (state.reminder || state.celebrate) ? 'flash show' : 'show';
  if (state.celebrate) { bubble.className = 'show'; }
  if (state.dragHint && !state.ask) { bubble.className = 'show drop-hint'; }
  bubble.innerHTML = html;
}

function clockHM() {
  const d = new Date();
  return L.pad2(d.getHours()) + ':' + L.pad2(d.getMinutes());
}

function fmtMs(ms) {
  if (ms < 0) { ms = 0; }
  const t = Math.ceil(ms / 1000);
  return L.pad2(Math.floor(t / 60)) + ':' + L.pad2(t % 60);
}

function renderChip() {
  const chip = $('chip');
  let txt = '';
  let hot = false;
  if (state.catchOn) {
    const sec = (Math.max(0, Date.now() - state.catchStartAt - 900) / 1000).toFixed(1);
    chip.className = 'show hot';
    chip.innerHTML = '<span class="m">🏃 抓奶蛙 ' + sec + 's</span>';
    return;
  }
  if (state.mode === 'countdown' && state.cd) {
    const left = state.cd.endAt - Date.now();
    txt = '⏳ ' + fmtMs(left);
    if (left <= 0) { hot = true; }
  } else if (state.mode === 'alarm' && state.alarm) {
    txt = '⏰ ' + state.alarm.hm + (state.alarm.ringing ? ' 响铃！' : '');
    hot = !!state.alarm.ringing;
  } else if (state.mode === 'coin') {
    txt = '🪙 ' + (state.coin.a && state.coin.b ? '在做决定' : '抛硬币');
  } else if (state.mode === 'assistant') {
    txt = '🤖 助手';
  }
  if (!txt) {
    chip.className = '';
    chip.innerHTML = '';
    return;
  }
  chip.className = hot ? 'show hot' : 'show';
  chip.innerHTML = '<span class="m">' + txt + '</span>';
}

function tick() {
  const now = new Date();
  const hm = L.pad2(now.getHours()) + ':' + L.pad2(now.getMinutes());
  const today = L.todayStr();
  const in5 = new Date(now.getTime() + 5 * 60000);
  const hm5 = L.pad2(in5.getHours()) + ':' + L.pad2(in5.getMinutes());

  for (const it of state.items) {
    const k = L.keyOf(it);
    if (it.time === hm && state.fired[k] !== today) {
      state.fired[k] = today;
      state.reminder = { key: k, time: it.time, text: it.text, until: Date.now() + 30000 };
      state.lastBubbleKey = null;
      playFire();
      break;
    }
  }
  if (!state.reminder) {
    for (const it of state.items) {
      const k = L.keyOf(it);
      if (it.time === hm5 && state.preFired[k] !== today && state.fired[k] !== today) {
        state.preFired[k] = today;
        state.pre = { key: k, text: it.text, until: Date.now() + 8000 };
        state.lastBubbleKey = null;
        bounce();
        break;
      }
    }
  }
  if (state.reminder && Date.now() > state.reminder.until) { state.reminder = null; state.lastBubbleKey = null; }
  if (state.pre && Date.now() > state.pre.until) { state.pre = null; state.lastBubbleKey = null; }
  if (state.celebrate && Date.now() > state.celebrate.until) { state.celebrate = null; state.lastBubbleKey = null; }
  if (state.ping && Date.now() > state.ping.until) { state.ping = null; state.lastBubbleKey = null; }
  if (state.ask && !state.ask.result && Date.now() > state.ask.until) { state.ask = null; state.lastBubbleKey = null; window.widget.askDone(); }

  if (state.cd && !state.cd.done && Date.now() >= state.cd.endAt) {
    state.cd.done = true;
    timerEnd();
    state.ping = { text: '⏳ 时间到！', anim: 'jumping', until: Date.now() + 20000 };
    state.lastBubbleKey = null;
    bounce();
    window.widget.petEvent({ type: 'countdown-done' });
  }

  if (state.alarm && state.alarm.hm === hm && !state.alarm.fired) {
    state.alarm.fired = true;
    state.alarm.ringing = true;
    alarmRingStart();
    state.ping = { text: '⏰ 闹钟 ' + state.alarm.hm + '，点我停止', anim: 'jumping', until: Date.now() + 60000 };
    state.lastBubbleKey = null;
    bounce();
    window.widget.petEvent({ type: 'alarm-ring' });
  }

  renderBubble();
  renderChip();
}

function setSchedule(text) {
  state.allItems = L.parseSchedule(text || '');
  refreshToday();
  renderBubble();
}

function setCountdown(text) {
  state.countdown = L.parseCountdown(text || '');
  state.lastBubbleKey = null;
  renderBubble();
}

function applyTheme(t) {
  state.theme = t;
  document.body.className = 't' + t;
}

function hitTest(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) { return false; }
  return $('pet').contains(el) || $('bubble').contains(el);
}

window.addEventListener('mousemove', (e) => {
  state.hover = hitTest(e);
  renderBubble();
});
window.addEventListener('mouseleave', () => {
  state.hover = false;
  renderBubble();
});

const drag = { active: false, moved: false, lastX: 0, lastY: 0, acc: 0 };

$('pet').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) { return; }
  if (state.catchOn) { window.widget.petEvent({ type: 'catch-hit' }); return; }
  drag.active = true;
  drag.moved = false;
  drag.acc = 0;
  drag.lastX = e.screenX;
  drag.lastY = e.screenY;
  state.dragging = false;
  try { $('pet').setPointerCapture(e.pointerId); } catch (err) { }
});

$('pet').addEventListener('pointermove', (e) => {
  if (!drag.active) { return; }
  const dx = e.screenX - drag.lastX;
  const dy = e.screenY - drag.lastY;
  if (!drag.moved && (Math.abs(dx) + Math.abs(dy) > 3)) {
    drag.moved = true;
    state.dragging = true;
  }
  if (drag.moved) {
    drag.lastX = e.screenX;
    drag.lastY = e.screenY;
    drag.acc = drag.acc * 0.7 + dx;
    if (drag.acc > 3) { state.dragDir = 'running-right'; }
    else if (drag.acc < -3) { state.dragDir = 'running-left'; }
    window.widget.petMoveBy({ dx: dx, dy: dy });
  }
});

$('pet').addEventListener('pointerup', (e) => {
  if (!drag.active) { return; }
  drag.active = false;
  state.dragging = false;
  try { $('pet').releasePointerCapture(e.pointerId); } catch (err) { }
  if (!drag.moved) {
    if (state.ask) { return; }
    if (state.mode === 'coin') { doCoinFlip(); }
    else if (state.mode === 'countdown') { dismissCountdown(); }
    else if (state.mode === 'alarm') { dismissAlarm(); }
    else if (state.mode === 'assistant') { window.widget.openAssistant(); }
    else if (state.mode !== 'catch') { window.widget.togglePopup(); }
  }
  state.lastBubbleKey = null;
});

$('bubble').addEventListener('click', (e) => {
  const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (el) {
    const act = el.getAttribute('data-act');
    if (act === 'recycle') { confirmRecycle(); return; }
    if (act === 'cancel') { state.ask = null; state.lastBubbleKey = null; renderBubble(); window.widget.askDone(); return; }
  }
  if (state.ask) { return; }
  if (state.mode === 'coin') { doCoinFlip(); return; }
  if (state.mode === 'countdown') { dismissCountdown(); return; }
  if (state.mode === 'alarm') { dismissAlarm(); return; }
  if (state.mode === 'catch') { return; }
  window.widget.togglePopup();
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.widget.openModeMenu();
  return false;
});

setInterval(() => {
  state.cycleIdx++;
  if (!state.hover && !state.reminder && !state.pre && !state.celebrate && !state.ping && !state.cd && !state.alarm
    && !state.ask && !state.dragHint) {
    state.lastBubbleKey = null;
    renderBubble();
  }
}, 4500);

setInterval(tick, 1000);

(function animLoopTick() {
  requestAnimationFrame((t) => {
    setAnim(currentAnim());
    animLoop(t);
    animLoopTick();
  });
})();

(async function init() {
  const qs = new URLSearchParams(location.search);
  const forced = qs.get('anim');
  const data = await window.widget.petInit();
  state.settings = data.state.settings || { sound: true };
  setSchedule(data.schedule === null ? '09:00|晨会\r\n12:00|午餐\r\n18:00|下班回家' : data.schedule);
  if (data.schedule === null) {
    await window.widget.saveSchedule(L.serializeSchedule(state.allItems));
  }
  setCountdown(data.countdown || '');
  applyTheme(data.theme);
  window.widget.onScheduleChanged((text) => setSchedule(text));
  window.widget.onCountdownChanged((text) => setCountdown(text));
  window.widget.onThemeChanged((t) => applyTheme(t));
  window.widget.onSettingsChanged((s) => { state.settings = s || state.settings; });
  window.widget.onPopupState((open) => { state.popupOpen = open; state.lastBubbleKey = null; });
  window.widget.onAssistantState((open) => {
    state.assistantOpen = !!open;
    $('ring').className = state.assistantOpen ? 'on' : '';
    state.lastBubbleKey = null;
    renderBubble();
  });
  window.widget.onAgentStep((s) => {
    if (s && s.kind === 'sys' && /^\u25b6/.test(s.text || '')) {
      state.actionLaugh = Date.now() + 2000;
      state.lastBubbleKey = null;
      playHappy(0.5);
      bounce();
    }
  });
  window.widget.onCelebrate(() => {
    state.celebrate = { until: Date.now() + 8000 };
    state.lastBubbleKey = null;
    playHappy();
    bounce();
  });
  window.widget.onModeChanged((m) => {
    const nm = m || 'normal';
    if (nm !== 'countdown' && state.cd) { state.cd = null; }
    if (nm !== 'alarm' && state.alarm) { alarmRingStop(); state.alarm = null; }
    state.mode = nm;
    state.assistantOpen = (nm === 'assistant');
    $('ring').className = state.assistantOpen ? 'on' : '';
    state.lastBubbleKey = null;
    renderBubble();
    renderChip();
  });
  window.widget.onPetPing((p) => {
    const act = p.action;
    if (act === 'catch-start') {
      state.catchOn = true;
      state.catchStartAt = Date.now();
      state.catchDir = 'running-right';
      state.hover = false;
      state.dragging = false;
      state.cd = null;
      state.ping = null;
      state.lastBubbleKey = null;
      playHappy(0.95);
      bounce();
      renderBubble();
      renderChip();
      if (catchTick) { clearInterval(catchTick); }
      catchTick = setInterval(() => {
        if (!state.catchOn) { clearInterval(catchTick); catchTick = null; return; }
        renderChip();
      }, 100);
      return;
    }
    if (act === 'catch-dir') {
      state.catchDir = p.dir === 'running-left' ? 'running-left' : 'running-right';
      return;
    }
    if (act === 'catch-end') {
      state.catchOn = false;
      if (catchTick) { clearInterval(catchTick); catchTick = null; }
      if (p.caught) {
        const sec = (Math.max(0, Number(p.ms) || 0) / 1000).toFixed(1);
        playHappy(1);
        bounce();
        state.ping = { text: '🎉 抓到啦！用时 ' + sec + ' 秒', anim: 'jumping', until: Date.now() + 4500 };
      }
      state.lastBubbleKey = null;
      renderBubble();
      renderChip();
      return;
    }
    if (act === 'countdown-start') {
      state.cd = { endAt: Number(p.endAt) || 0, done: false };
      state.ping = null;
      bounce();
    } else if (act === 'countdown-cancel') {
      state.cd = null;
      state.ping = null;
    } else if (act === 'alarm-set') {
      alarmRingStop();
      state.alarm = { hm: String(p.hm || ''), ringing: false, fired: false };
      state.ping = null;
      bounce();
    } else if (act === 'alarm-cancel') {
      alarmRingStop();
      state.alarm = null;
      state.ping = null;
    } else if (act === 'coin-set') {
      state.coin = { a: String(p.a || ''), b: String(p.b || '') };
    } else if (act === 'coin-flip') {
      state.coin = { a: String(p.a || ''), b: String(p.b || '') };
      doCoinFlip();
      return;
    } else if (act === 'drop-ask') {
      askRecycle(p.paths || []);
      return;
    } else if (act === 'walk') {
      state.walkDir = p.dir ? String(p.dir) : null;
      state.lastBubbleKey = null;
      renderBubble();
      return;
    }
    state.lastBubbleKey = null;
    renderBubble();
    renderChip();
  });
  window.widget.onFilesDropped((paths) => {
    state.dragHint = false;
    state.lastBubbleKey = null;
    renderBubble();
    if (paths && paths.length) { window.widget.dropSubmit(paths); }
  });
  window.widget.onFilesDrag((on) => {
    state.dragHint = !!on;
    state.lastBubbleKey = null;
    renderBubble();
  });
  if (forced && ANIM[forced]) { state.forceAnim = forced; }
  if (qs.get('remind') === '1') {
    state.reminder = { key: 'debug|喝水提醒', time: clockHM(), text: '喝水提醒', until: Date.now() + 60000 };
    state.lastBubbleKey = null;
  }
  tick();
})();
