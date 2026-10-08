const L = window.WidgetLogic;
const $ = (id) => document.getElementById(id);
const THEMES = ['奶黄玻璃', '浅色玻璃', '琥珀玻璃', '科技青', '午夜紫'];

const state = {
  allItems: [],
  countdown: [],
  done: {},
  completedDays: [],
  streak: 0,
  settings: { sound: true },
  theme: 0,
  view: 'list',
  selectedDate: L.todayStr(),
  calY: 0,
  calM: 0,
  addMode: 'item',
  pickMode: null,
  selH: 0,
  selM: 0,
  repeatDaily: true
};

function saveSchedule() { return window.widget.saveSchedule(L.serializeSchedule(state.allItems)); }
function saveCountdown() { return window.widget.saveCountdown(L.serializeCountdown(state.countdown)); }
function keyDone(date, key) { return (state.done[date] || []).indexOf(key) >= 0; }

function applyState(s) {
  if (!s) { return; }
  state.done = s.done || {};
  state.completedDays = s.completedDays || [];
  state.streak = s.streak || 0;
  if (s.settings) { state.settings = s.settings; }
  renderSound();
}

function applyTheme(t) {
  state.theme = t;
  document.body.className = 't' + t;
  $('themebtn').title = '主题：' + THEMES[t] + '（点击切换）';
}

function renderSound() {
  $('soundbtn').className = 'icobtn' + (state.settings.sound ? '' : ' off');
  $('soundbtn').title = state.settings.sound ? '提醒音效：开（点击关闭）' : '提醒音效：关（点击开启）';
}

function dateLabel(dateStr) {
  const d = L.dateObj(dateStr);
  if (!d) { return dateStr; }
  const today = L.todayStr();
  let s = (dateStr === today ? '今天 · ' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + L.weekdayCn(d);
  const hol = L.holiday(dateStr);
  return { text: s, hol: hol };
}

function renderList() {
  const info = dateLabel(state.selectedDate);
  $('listTitle').innerHTML = L.esc(info.text) + (info.hol ? '<span class="hol">' + L.esc(info.hol) + '</span>' : '');
  const items = L.itemsOn(state.allItems, state.selectedDate);
  const list = $('list');
  if (!items.length) {
    list.innerHTML = '<div class="empty">这一天还没有日程<br>点下面添加</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const k = L.keyOf(it);
    const done = keyDone(state.selectedDate, k);
    const past = state.selectedDate < L.todayStr() || (state.selectedDate === L.todayStr() && it.time < clockHM());
    let cls = 'row' + (done ? ' done' : '') + (past && !done ? ' past' : '');
    html += '<div class="' + cls + '" id="row_' + i + '">'
      + '<span class="chk" id="chk_' + i + '">✓</span>'
      + '<span class="time">' + L.esc(it.time) + '</span>'
      + '<span class="txt">' + L.esc(it.text) + '</span>'
      + (it.date === '' ? '<span class="tag">每天</span>' : '')
      + '<span class="del" id="del_' + i + '" title="删除">✕</span></div>';
  }
  list.innerHTML = html;
  for (let j = 0; j < items.length; j++) {
    (function (idx) {
      const c = $('chk_' + idx);
      if (c) { c.onclick = () => toggleDone(L.keyOf(items[idx])); }
      const d = $('del_' + idx);
      if (d) { d.onclick = () => delAt(items[idx]); }
    })(j);
  }
}

async function toggleDone(key) {
  const s = await window.widget.toggleDone({ date: state.selectedDate, key: key });
  applyState(s);
  renderList();
  renderProgress();
}

async function delAt(it) {
  const i = state.allItems.indexOf(it);
  if (i >= 0) { state.allItems.splice(i, 1); }
  await saveSchedule();
  renderList();
  renderProgress();
}

function renderProgress() {
  const today = L.todayStr();
  const items = L.itemsOn(state.allItems, today);
  const doneCount = items.filter((it) => keyDone(today, L.keyOf(it))).length;
  const pct = items.length ? Math.round(doneCount / items.length * 100) : 0;
  $('progFill').style.width = pct + '%';
  $('progText').textContent = items.length ? ('今日 ' + doneCount + '/' + items.length) : '今天还没有日程';
  $('streakText').textContent = state.streak > 0 ? ('连签 ' + state.streak + ' 天') : '';
}

function renderCdStrip() {
  const strip = $('cdstrip');
  const cds = L.nextCountdowns(state.countdown, null, 6);
  let html = '';
  for (let i = 0; i < cds.length; i++) {
    const cd = cds[i];
    const d = L.dateObj(cd.date);
    html += '<span class="cdchip' + (cd.days === 0 ? ' today' : '') + '" title="' + L.esc(cd.date) + '">'
      + L.esc(cd.text) + '<b>' + (cd.days === 0 ? '今天' : cd.days + ' 天') + '</b>'
      + '<span class="cdx" data-date="' + L.esc(cd.date) + '" data-text="' + L.esc(cd.text) + '">✕</span></span>';
  }
  html += '<span class="cdchip add" id="addCdChip">＋ 倒数日</span>';
  strip.innerHTML = html;
  const xs = strip.getElementsByTagName('span');
  for (let j = 0; j < xs.length; j++) {
    if (xs[j].className === 'cdx') {
      xs[j].onclick = async function () {
        const dt = this.getAttribute('data-date');
        const tx = this.getAttribute('data-text');
        state.countdown = state.countdown.filter((c) => !(c.date === dt && c.text === tx));
        await saveCountdown();
        renderCdStrip();
      };
    }
  }
  $('addCdChip').onclick = () => openAdd('cd');
}

function renderCal() {
  const y = state.calY, m = state.calM;
  $('calTitle').textContent = y + '年' + (m + 1) + '月';
  const first = new Date(y, m, 1);
  let lead = first.getDay() - 1;
  if (lead < 0) { lead = 6; }
  const start = new Date(y, m, 1 - lead);
  const today = L.todayStr();
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = L.fmtDateObj(d);
    const other = d.getMonth() !== m;
    const hasItem = L.datedOn(state.allItems, ds).length > 0;
    const hasCd = state.countdown.some((c) => c.date === ds);
    const hol = L.holiday(ds);
    let cls = 'calcell' + (other ? ' other' : '') + (ds === today ? ' today' : '') + (ds === state.selectedDate ? ' sel' : '');
    html += '<div class="' + cls + '" data-date="' + ds + '">'
      + '<div class="d">' + d.getDate() + '</div>'
      + '<div class="dots">' + (hasItem ? '<span class="dot"></span>' : '') + (hasCd ? '<span class="dot cd"></span>' : '') + '</div>'
      + (hol ? '<div class="hol">' + L.esc(hol) + '</div>' : '')
      + '</div>';
  }
  const grid = $('calGrid');
  grid.innerHTML = html;
  const cells = grid.getElementsByClassName('calcell');
  for (let j = 0; j < cells.length; j++) {
    cells[j].onclick = function () {
      const ds = this.getAttribute('data-date');
      state.selectedDate = ds;
      if (state.pickMode) {
        const mode = state.pickMode;
        state.pickMode = null;
        openAdd(mode);
      } else {
        showView('list');
        renderList();
      }
    };
  }
}

function showView(v) {
  state.view = v;
  $('viewList').className = 'view' + (v === 'list' ? '' : ' hidden');
  $('viewCal').className = 'view' + (v === 'cal' ? '' : ' hidden');
  $('viewAdd').className = 'view' + (v === 'add' ? '' : ' hidden');
  $('cdstrip').style.display = (v === 'list') ? '' : 'none';
}

function buildWheel(el, count, pad) {
  let html = '<div class="wsp"></div>';
  for (let i = 0; i < count; i++) {
    html += '<div class="wi">' + (pad ? L.pad2(i) : i) + '</div>';
  }
  html += '<div class="wsp"></div>';
  el.innerHTML = html;
}

function setWheel(el, value, smooth) {
  const items = el.querySelectorAll('.wi');
  const idx = Math.max(0, Math.min(parseInt(value, 10), items.length - 1));
  el.scrollTo({ top: idx * 30, behavior: smooth ? 'smooth' : 'auto' });
}

function readWheel(el) {
  const items = el.querySelectorAll('.wi');
  return Math.max(0, Math.min(Math.round(el.scrollTop / 30), items.length - 1));
}

function updateWheelClasses(el, idx) {
  const items = el.querySelectorAll('.wi');
  for (let i = 0; i < items.length; i++) {
    items[i].className = 'wi' + (i === idx ? ' on' : '');
  }
}

function bindWheel(el, onPick) {
  let t = null;
  el.addEventListener('scroll', () => {
    if (t) { clearTimeout(t); }
    t = setTimeout(() => {
      const idx = readWheel(el);
      updateWheelClasses(el, idx);
      onPick(idx);
    }, 120);
  });
  el.addEventListener('click', (e) => {
    const item = e.target.closest('.wi');
    if (!item) { return; }
    const items = Array.prototype.slice.call(el.querySelectorAll('.wi'));
    const idx = items.indexOf(item);
    if (idx >= 0) { setWheel(el, idx, true); }
  });
}

function updatePreview() {
  $('preview').textContent = L.pad2(state.selH) + ':' + L.pad2(state.selM);
}

function updateDateChip() {
  const d = L.dateObj(state.selectedDate);
  $('datechip').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ▾';
}

function updateRepeatRow() {
  const show = state.addMode === 'item' && state.selectedDate === L.todayStr();
  $('repeatRow').style.display = show ? '' : 'none';
  $('repToday').className = 'repchip' + (state.repeatDaily ? '' : ' on');
  $('repDaily').className = 'repchip' + (state.repeatDaily ? ' on' : '');
}

function openAdd(mode) {
  state.addMode = mode;
  if (mode === 'item') {
    const d = new Date();
    let h = d.getHours(), m = d.getMinutes() + 5;
    if (m >= 60) { m -= 60; h = (h + 1) % 24; }
    m = Math.floor(m / 5) * 5;
    state.selH = h;
    state.selM = m;
    setWheel($('wHour'), h, false);
    setWheel($('wMin'), m, false);
    updateWheelClasses($('wHour'), h);
    updateWheelClasses($('wMin'), m);
    updatePreview();
    $('addTitle').textContent = '添加日程';
    $('txtin').value = '';
    $('txtin').placeholder = '事项内容';
    $('wheelRow').style.display = '';
    $('preview').style.display = '';
  } else {
    $('addTitle').textContent = '添加倒数日';
    $('txtin').value = '';
    $('txtin').placeholder = '倒数日名称（如：春节）';
    $('wheelRow').style.display = 'none';
    $('preview').style.display = 'none';
  }
  updateDateChip();
  updateRepeatRow();
  showView('add');
  setTimeout(() => $('txtin').focus(), 100);
}

async function confirmAdd() {
  const text = L.trim($('txtin').value);
  if (text === '') {
    $('txtin').classList.add('err');
    setTimeout(() => $('txtin').classList.remove('err'), 900);
    $('txtin').focus();
    return;
  }
  if (state.addMode === 'cd') {
    state.countdown.push({ date: state.selectedDate, text: text });
    state.countdown.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    await saveCountdown();
    renderCdStrip();
  } else {
    const daily = state.repeatDaily && state.selectedDate === L.todayStr();
    state.allItems.push({
      date: daily ? '' : state.selectedDate,
      time: L.pad2(state.selH) + ':' + L.pad2(state.selM),
      text: text
    });
    state.allItems.sort(L.byWhen);
    await saveSchedule();
    renderList();
    renderProgress();
  }
  $('txtin').value = '';
  showView('list');
}

function clockHM() {
  const d = new Date();
  return L.pad2(d.getHours()) + ':' + L.pad2(d.getMinutes());
}

function tick() {
  const d = new Date();
  $('clock').textContent = L.pad2(d.getHours()) + ':' + L.pad2(d.getMinutes()) + ':' + L.pad2(d.getSeconds());
  $('date').textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + L.weekdayCn(d);
}

function setSchedule(text) {
  state.allItems = L.parseSchedule(text || '');
  if (state.view === 'list') { renderList(); }
  renderProgress();
  if (state.view === 'cal') { renderCal(); }
}

function setCountdown(text) {
  state.countdown = L.parseCountdown(text || '');
  renderCdStrip();
  if (state.view === 'cal') { renderCal(); }
}

window.addEventListener('error', (e) => console.error('ERR: ' + e.message + ' @ ' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('REJ: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

(async function init() {
  const data = await window.widget.popupInit();
  applyState(data.state);
  setSchedule(data.schedule === null ? '' : data.schedule);
  setCountdown(data.countdown || '');
  applyTheme(data.theme);

  buildWheel($('wHour'), 24, true);
  buildWheel($('wMin'), 60, true);
  bindWheel($('wHour'), (idx) => { state.selH = idx; updatePreview(); });
  bindWheel($('wMin'), (idx) => { state.selM = idx; updatePreview(); });

  const now = new Date();
  state.calY = now.getFullYear();
  state.calM = now.getMonth();

  tick();
  setInterval(tick, 1000);

  $('addbtn').onclick = () => openAdd('item');
  $('cancelbtn').onclick = () => { state.pickMode = null; showView('list'); };
  $('okbtn').onclick = confirmAdd;
  $('openCalBtn').onclick = () => { state.calY = L.dateObj(state.selectedDate).getFullYear(); state.calM = L.dateObj(state.selectedDate).getMonth(); renderCal(); showView('cal'); };
  $('backListBtn').onclick = () => { state.pickMode = null; showView('list'); };
  $('prevMonth').onclick = () => { state.calM--; if (state.calM < 0) { state.calM = 11; state.calY--; } renderCal(); };
  $('nextMonth').onclick = () => { state.calM++; if (state.calM > 11) { state.calM = 0; state.calY++; } renderCal(); };
  $('datechip').onclick = () => { state.pickMode = state.addMode; renderCal(); showView('cal'); };
  $('repToday').onclick = () => { state.repeatDaily = false; updateRepeatRow(); };
  $('repDaily').onclick = () => { state.repeatDaily = true; updateRepeatRow(); };

  $('themebtn').onclick = () => {
    state.theme = (state.theme + 1) % THEMES.length;
    applyTheme(state.theme);
    window.widget.saveTheme(state.theme);
  };
  $('soundbtn').onclick = async () => {
    state.settings.sound = !state.settings.sound;
    renderSound();
    await window.widget.saveSettings({ sound: state.settings.sound });
  };
  $('close').onclick = () => window.widget.close();
  $('avatar').onclick = () => window.widget.resetPopupPos();

  $('txtin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { confirmAdd(); }
    if (e.key === 'Escape') { state.pickMode = null; showView('list'); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.view === 'list') { window.widget.hidePopup(); }
  });

  window.widget.onScheduleChanged((text) => setSchedule(text));
  window.widget.onCountdownChanged((text) => setCountdown(text));
  window.widget.onStateChanged((s) => { applyState(s); renderList(); renderProgress(); });
  window.widget.onThemeChanged((t) => applyTheme(t));
  window.widget.onPopupBackdrop((url) => { $('backdrop').src = url; });

  renderCdStrip();
  renderList();
  renderProgress();

  if (location.search.indexOf('debug=1') !== -1) {
    setInterval(() => {
      const rect = (id) => {
        const el = $(id);
        if (!el) { return null; }
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height };
      };
      const hw = $('wHour').getBoundingClientRect();
      window.widget.debugDump({
        view: state.view,
        selectedDate: state.selectedDate,
        selH: state.selH,
        selM: state.selM,
        streak: state.streak,
        wheelH: { centerX: hw.left + hw.width / 2, centerY: hw.top + 60 },
        rects: {
          addbtn: rect('addbtn'), okbtn: rect('okbtn'), cancelbtn: rect('cancelbtn'),
          txtin: rect('txtin'), datechip: rect('datechip'),
          openCalBtn: rect('openCalBtn'), backListBtn: rect('backListBtn'),
          prevMonth: rect('prevMonth'), nextMonth: rect('nextMonth'),
          themebtn: rect('themebtn'), close: rect('close'), avatar: rect('avatar'),
          soundbtn: rect('soundbtn'), list: rect('list'), calGrid: rect('calGrid'),
          addCdChip: rect('addCdChip'), chk0: rect('chk_0')
        }
      });
    }, 800);
  }
})();
