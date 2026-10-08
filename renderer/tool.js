(function () {
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const LS = window.localStorage;

  const state = {
    cd: null,
    al: null,
    coin: { a: '', b: '' }
  };

  function setStatus(s) { $('status').textContent = s || ''; }

  function showView(mode) {
    const tab = (mode === 'assistant' || mode === 'normal') ? 'countdown' : mode;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), (el) => {
      el.className = el.getAttribute('data-tab') === tab ? 'tab on' : 'tab';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), (el) => {
      el.className = el.id === 'v-' + tab ? 'view on' : 'view';
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), (el) => {
    el.addEventListener('click', () => showView(el.getAttribute('data-tab')));
  });

  /* ---------- 倒计时 ---------- */
  function fmtMs(ms) {
    if (ms < 0) { ms = 0; }
    const t = Math.ceil(ms / 1000);
    const m = Math.floor(t / 60), s = t % 60;
    return pad2(m) + ':' + pad2(s);
  }

  function refreshCd() {
    if (!state.cd) { $('disp').textContent = '00:00'; return; }
    const left = state.cd.endAt - Date.now();
    $('disp').textContent = fmtMs(left);
    if (left <= 0) {
      state.cd = null;
      setStatus('⏳ 时间到！');
    }
  }

  function startCd(min) {
    min = Math.max(1, Math.min(600, Math.round(Number(min) || 0)));
    if (!min) { setStatus('请输入分钟数'); return; }
    state.cd = { endAt: Date.now() + min * 60000 };
    window.widget.petPing({ action: 'countdown-start', endAt: state.cd.endAt, min: min });
    setStatus('倒计时 ' + min + ' 分钟已开始');
    refreshCd();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), (el) => {
    el.addEventListener('click', () => {
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), (c) => { c.className = 'chip'; });
      el.className = 'chip on';
      $('cdMin').value = el.getAttribute('data-min');
      LS.setItem('naifrog.tool.cdMin', el.getAttribute('data-min'));
    });
  });

  $('cdGo').addEventListener('click', () => startCd($('cdMin').value));
  $('cdCancel').addEventListener('click', () => {
    state.cd = null;
    window.widget.petPing({ action: 'countdown-cancel' });
    refreshCd();
    setStatus('倒计时已取消');
  });

  /* ---------- 闹钟 ---------- */
  (function fillSelects() {
    const alH = $('alH'), alM = $('alM');
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option'); o.value = h; o.textContent = pad2(h) + ' 时'; alH.appendChild(o);
    }
    for (let m = 0; m < 60; m += 1) {
      const o = document.createElement('option'); o.value = m; o.textContent = pad2(m) + ' 分'; alM.appendChild(o);
    }
    alH.value = LS.getItem('naifrog.tool.alH') || '7';
    alM.value = LS.getItem('naifrog.tool.alM') || '30';
  })();

  function alarmTarget(hm) {
    const p = hm.split(':');
    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(parseInt(p[0], 10), parseInt(p[1], 10));
    if (d.getTime() <= Date.now()) { d.setDate(d.getDate() + 1); }
    return d.getTime();
  }

  function refreshAl() {
    if (!state.al) { $('dispAlarm').textContent = '--:--'; return; }
    $('dispAlarm').textContent = state.al.hm;
    const left = state.al.at - Date.now();
    if (left <= 0) {
      setStatus('⏰ 闹钟响铃中…');
    } else {
      const t = Math.ceil(left / 1000);
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
      setStatus('还有 ' + (h > 0 ? h + ' 小时 ' : '') + m + ' 分钟');
    }
  }

  $('alGo').addEventListener('click', () => {
    const hm = pad2(parseInt($('alH').value, 10)) + ':' + pad2(parseInt($('alM').value, 10));
    LS.setItem('naifrog.tool.alH', $('alH').value);
    LS.setItem('naifrog.tool.alM', $('alM').value);
    state.al = { hm: hm, at: alarmTarget(hm) };
    window.widget.petPing({ action: 'alarm-set', hm: hm });
    setStatus('闹钟已设定 ' + hm);
    refreshAl();
  });

  $('alCancel').addEventListener('click', () => {
    state.al = null;
    window.widget.petPing({ action: 'alarm-cancel' });
    refreshAl();
    setStatus('闹钟已取消');
  });

  /* ---------- 抛硬币 ---------- */
  function setCoinDisp(text) {
    const el = $('dispCoin');
    el.textContent = text;
    const wide = String(text).replace(/[\x00-\xff]/g, 'x').length;
    let fs = 34;
    if (wide > 6) { fs = 28; }
    if (wide > 10) { fs = 23; }
    if (wide > 16) { fs = 18; }
    if (wide > 24) { fs = 15; }
    el.style.fontSize = fs + 'px';
  }

  function pushCoinOpts() {
    state.coin.a = $('coinA').value.trim();
    state.coin.b = $('coinB').value.trim();
    LS.setItem('naifrog.tool.coinA', state.coin.a);
    LS.setItem('naifrog.tool.coinB', state.coin.b);
    window.widget.petPing({ action: 'coin-set', a: state.coin.a, b: state.coin.b });
  }

  $('coinA').value = LS.getItem('naifrog.tool.coinA') || '';
  $('coinB').value = LS.getItem('naifrog.tool.coinB') || '';
  $('coinA').addEventListener('input', pushCoinOpts);
  $('coinB').addEventListener('input', pushCoinOpts);

  $('coinGo').addEventListener('click', () => {
    pushCoinOpts();
    setCoinDisp('🪙 抛掷中…');
    window.widget.petPing({ action: 'coin-flip', a: state.coin.a, b: state.coin.b });
  });

  /* ---------- 与奶蛙同步 ---------- */
  window.widget.onToolView((m) => { showView(m); setStatus(''); });

  window.widget.onPetEvent((p) => {
    if (!p || !p.type) { return; }
    if (p.type === 'countdown-done') {
      state.cd = null; refreshCd();
      setStatus('⏳ 时间到！奶蛙叫你啦');
    } else if (p.type === 'alarm-ring') {
      setStatus('⏰ 闹钟响铃中…点奶蛙停止');
    } else if (p.type === 'coin-result') {
      setCoinDisp('🎉 ' + p.result);
      setStatus('抛硬币结果：' + p.result);
    }
  });

  function tick() {
    refreshCd();
    if (state.al) { refreshAl(); }
  }

  $('close').addEventListener('click', () => window.widget.toolHide());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { window.widget.toolHide(); } });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  (function restore() {
    const saved = LS.getItem('naifrog.tool.cdMin');
    if (saved) {
      $('cdMin').value = saved;
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), (c) => {
        if (c.getAttribute('data-min') === saved) { c.className = 'chip on'; }
      });
    }
    pushCoinOpts();
  })();

  showView('countdown');
  setInterval(tick, 250);
})();
