/* 工具窗：番茄钟 / 倒计时 / 闹钟 / 抛硬币（v3） */
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.widget;
  api.onThemeChanged(t => { document.body.className = 't' + (Number(t) || 0); });
  const I = window.WidgetI18n || { t: (k) => k, setLocale() {}, applyDom() {} };
  const LS = window.localStorage;
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  const state = {
    cd: null,
    al: null,
    coin: { a: '', b: '' },
    focusMin: 25,
    pomo: null
  };

  function setStatus(s) { $('status').textContent = s || ''; }

  function showView(mode) {
    const tab = ['normal', 'assistant'].indexOf(mode) >= 0 ? 'focus' : mode;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), (el) => {
      el.className = el.getAttribute('data-tab') === tab ? 'tab on' : 'tab';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), (el) => {
      el.className = el.id === 'v-' + tab ? 'view on' : 'view';
    });
    if (state.pomo) renderPomo(state.pomo);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), (el) => {
    el.addEventListener('click', () => showView(el.getAttribute('data-tab')));
  });

  function fmtMs(ms) {
    if (ms < 0) ms = 0;
    const t = Math.ceil(ms / 1000);
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }

  // ---------------------------------------------------------------- 番茄钟
  const CIRC = 2 * Math.PI * 66;
  const PHASE_KEY = { '专注中': 'tool.focusing', '短休息': 'tool.shortBreak', '长休息': 'tool.longBreak', '已暂停': 'tool.paused' };
  const PHASE_BY_ID = { focus: 'tool.focusing', short: 'tool.shortBreak', long: 'tool.longBreak', paused: 'tool.paused', idle: 'tool.idle' };

  /** 优先用中文阶段名对，实在对不上就按 phase 字段判——两种形状都能显示对 */
  function phaseText(st) {
    return I.t(PHASE_KEY[st.label] || PHASE_BY_ID[st.phase] || 'tool.idle');
  }

  function renderPomo(st) {
    state.pomo = st;
    if (!st) return;
    const left = st.remainMs;
    $('pomoTime').textContent = fmtMs(left);
    $('pomoPhase').textContent = phaseText(st)
      + (st.cycle > 1 ? ' · ' + I.t('tool.cycle', { n: st.cycle }) : '');

    const total = Math.max(1, (st.phase === 'short' ? st.config.shortMin
      : st.phase === 'long' ? st.config.longMin
        : st.config.focusMin) * 60000);
    const p = st.phase === 'idle' ? 0 : Math.max(0, Math.min(1, 1 - left / total));
    $('ringFg').setAttribute('stroke-dashoffset', String(CIRC * (1 - p)));

    $('pomoStart').textContent = st.phase === 'idle' ? I.t('tool.start')
      : (st.phase === 'paused' ? I.t('tool.resume') : I.t('tool.restart'));
    $('pomoStat').textContent = I.t('tool.todayStat', { count: st.todayCount, min: st.todayMinutes });

    Array.prototype.forEach.call(document.querySelectorAll('#v-focus .chip'), (c) => {
      c.className = 'chip' + (parseInt(c.getAttribute('data-min'), 10) === st.config.focusMin ? ' on' : '');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('#v-focus .chip'), (el) => {
    el.addEventListener('click', async () => {
      state.focusMin = parseInt(el.getAttribute('data-min'), 10);
      await api.focusConfig({ focusMin: state.focusMin });
      LS.setItem('nailong.focusMin', String(state.focusMin));
      renderPomo(await api.focusStatus());
    });
  });

  $('pomoStart').addEventListener('click', async () => {
    const st = state.pomo;
    if (st && st.phase === 'paused') { renderPomo(await api.focusResume()); setStatus(I.t('tool.focusBegun')); return; }
    renderPomo(await api.focusStart({ minutes: state.focusMin, label: '' }));
    setStatus(I.t('tool.focusBegun'));
  });
  $('pomoPause').addEventListener('click', async () => {
    const st = state.pomo;
    if (!st) return;
    renderPomo(st.phase === 'paused' ? await api.focusResume() : await api.focusPause());
  });
  $('pomoSkip').addEventListener('click', async () => { renderPomo(await api.focusSkip()); setStatus(I.t('tool.jumped')); });
  $('pomoStop').addEventListener('click', async () => { renderPomo(await api.focusStop()); setStatus(I.t('tool.stopped')); });

  // ---------------------------------------------------------------- 倒计时
  function refreshCd() {
    if (!state.cd) { $('disp').textContent = '00:00'; $('cdSub').textContent = ''; return; }
    const left = state.cd.endAt - Date.now();
    $('disp').textContent = fmtMs(left);
    $('cdSub').textContent = left > 0 ? '→ ' + new Date(state.cd.endAt).toTimeString().slice(0, 5) : I.t('tool.timeUp');
    if (left <= 0 && !state.cd.done) { state.cd.done = true; state.cd = null; setStatus('⏳ ' + I.t('tool.timeUp')); }
  }

  function startCd(min) {
    min = Math.max(1, Math.min(600, Math.round(Number(min) || 0)));
    if (!min) { setStatus(I.t('tool.minutes')); return; }
    state.cd = { endAt: Date.now() + min * 60000, done: false };
    api.petPing({ action: 'countdown-start', endAt: state.cd.endAt, min: min });
    setStatus(I.t('tool.cdStarted', { n: min }));
    refreshCd();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-cd]'), (el) => {
    el.addEventListener('click', () => {
      Array.prototype.forEach.call(document.querySelectorAll('.chip[data-cd]'), (c) => { c.className = 'chip'; });
      el.className = 'chip on';
      $('cdMin').value = el.getAttribute('data-cd');
      LS.setItem('nailong.cdMin', el.getAttribute('data-cd'));
    });
  });
  $('cdGo').addEventListener('click', () => startCd($('cdMin').value));
  $('cdCancel').addEventListener('click', () => {
    state.cd = null;
    api.petPing({ action: 'countdown-cancel' });
    refreshCd();
    setStatus(I.t('tool.cdCanceled'));
  });

  // ---------------------------------------------------------------- 闹钟
  (function fillSelects() {
    const alH = $('alH'), alM = $('alM');
    for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = h; o.textContent = pad2(h) + ' 时'; alH.appendChild(o); }
    for (let m = 0; m < 60; m += 5) { const o = document.createElement('option'); o.value = m; o.textContent = pad2(m) + ' 分'; alM.appendChild(o); }
    alH.value = LS.getItem('nailong.alH') || String(new Date().getHours());
    alM.value = LS.getItem('nailong.alM') || '30';
  })();

  function alarmTarget(hm) {
    const p = hm.split(':');
    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(parseInt(p[0], 10), parseInt(p[1], 10));
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function refreshAl() {
    if (!state.al) { $('dispAlarm').textContent = '--:--'; $('alSub').textContent = ''; return; }
    $('dispAlarm').textContent = state.al.hm;
    const left = state.al.at - Date.now();
    if (left <= 0) $('alSub').textContent = I.t('tool.ringing');
    else {
      const t = Math.ceil(left / 1000);
      $('alSub').textContent = Math.floor(t / 3600) + ' h ' + Math.floor((t % 3600) / 60) + ' min';
    }
  }

  $('alGo').addEventListener('click', () => {
    const hm = pad2(parseInt($('alH').value, 10)) + ':' + pad2(parseInt($('alM').value, 10));
    LS.setItem('nailong.alH', $('alH').value);
    LS.setItem('nailong.alM', $('alM').value);
    state.al = { hm: hm, at: alarmTarget(hm) };
    api.petPing({ action: 'alarm-set', hm: hm });
    setStatus(I.t('tool.alarmSet2', { hm: hm }));
    refreshAl();
  });
  $('alCancel').addEventListener('click', () => {
    state.al = null;
    api.petPing({ action: 'alarm-cancel' });
    refreshAl();
    setStatus(I.t('tool.alarmCanceled'));
  });

  // ---------------------------------------------------------------- 硬币
  function setCoinDisp(text) {
    const el = $('dispCoin');
    el.textContent = text;
    const wide = String(text).replace(/[\x00-\xff]/g, 'x').length;
    el.style.fontSize = wide > 24 ? '15px' : wide > 16 ? '18px' : wide > 10 ? '23px' : wide > 6 ? '27px' : '30px';
  }

  function pushCoinOpts() {
    state.coin.a = $('coinA').value.trim();
    state.coin.b = $('coinB').value.trim();
    LS.setItem('nailong.coinA', state.coin.a);
    LS.setItem('nailong.coinB', state.coin.b);
    api.petPing({ action: 'coin-set', a: state.coin.a, b: state.coin.b });
  }

  $('coinA').value = LS.getItem('nailong.coinA') || '';
  $('coinB').value = LS.getItem('nailong.coinB') || '';
  $('coinA').addEventListener('input', pushCoinOpts);
  $('coinB').addEventListener('input', pushCoinOpts);
  $('coinGo').addEventListener('click', () => {
    pushCoinOpts();
    setCoinDisp('🪙 …');
    api.petPing({ action: 'coin-flip', a: state.coin.a, b: state.coin.b });
  });

  // ---------------------------------------------------------------- 事件
  api.onToolView((m) => { showView(m); setStatus(''); });
  api.onPetEvent((p) => {
    if (!p || !p.type) return;
    if (p.type === 'countdown-done') { state.cd = null; refreshCd(); setStatus('⏳ ' + I.t('tool.timeUpPet')); }
    else if (p.type === 'alarm-ring') setStatus('⏰ ' + I.t('tool.ringing'));
    else if (p.type === 'alarm-stopped') { state.al = null; refreshAl(); setStatus(I.t('tool.alarmStopped')); }
    else if (p.type === 'coin-result') { setCoinDisp('🎉 ' + p.result); setStatus(I.t('tool.coinResult', { r: p.result })); }
  });
  api.onFocusChanged((s) => renderPomo(s));

  function tick() {
    refreshCd();
    if (state.al) refreshAl();
  }

  $('close').addEventListener('click', () => api.toolHide());
  $('settingsbtn').addEventListener('click', () => api.openSettings());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.toolHide(); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  (async function init() {
    const boot = await api.appInit();
    document.body.className = 't' + (Number(boot && boot.theme) || 0);
    I.setLocale(boot && boot.locale);
    I.applyDom();

    const st = await api.focusStatus();
    state.focusMin = parseInt(LS.getItem('nailong.focusMin'), 10) || st.config.focusMin || 25;
    renderPomo(st);

    const saved = LS.getItem('nailong.cdMin');
    if (saved) {
      $('cdMin').value = saved;
      Array.prototype.forEach.call(document.querySelectorAll('.chip[data-cd]'), (c) => {
        c.className = 'chip' + (c.getAttribute('data-cd') === saved ? ' on' : '');
      });
    }
    pushCoinOpts();
    showView('focus');
    setInterval(tick, 250);
  })();
})();
