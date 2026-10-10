/* 番茄钟 / 专注计时状态机（纯函数，方便单测）
 * 状态：idle → focus → short|long → focus … → idle
 * 所有函数都接收 now（毫秒），不读系统时钟。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var L = isNode ? require('./logic.js') : (typeof window !== 'undefined' ? window.WidgetLogic : null);
  var api = factory(L);
  if (isNode) { module.exports = api; }
  if (typeof window !== 'undefined') { window.WidgetPomodoro = api; }
})(typeof window !== 'undefined' ? window : this, function (L) {
  var DEFAULTS = {
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    cyclesBeforeLong: 4,
    autoStartBreak: true,
    autoStartFocus: false,
    strict: false,
    sound: true,
    goalPerDay: 8
  };

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) { return dflt; }
    return Math.max(lo, Math.min(hi, n));
  }

  function normalizeConfig(c) {
    c = c || {};
    return {
      focusMin: clampInt(c.focusMin, 1, 600, DEFAULTS.focusMin),
      shortMin: clampInt(c.shortMin, 1, 120, DEFAULTS.shortMin),
      longMin: clampInt(c.longMin, 1, 240, DEFAULTS.longMin),
      cyclesBeforeLong: clampInt(c.cyclesBeforeLong, 1, 12, DEFAULTS.cyclesBeforeLong),
      autoStartBreak: c.autoStartBreak === undefined ? DEFAULTS.autoStartBreak : !!c.autoStartBreak,
      autoStartFocus: !!c.autoStartFocus,
      strict: !!c.strict,
      sound: c.sound === undefined ? DEFAULTS.sound : !!c.sound,
      goalPerDay: clampInt(c.goalPerDay, 1, 24, DEFAULTS.goalPerDay)
    };
  }

  function createState(config) {
    return {
      phase: 'idle',          // idle | focus | short | long | paused
      pausedFrom: '',
      startedAt: 0,
      endsAt: 0,
      remainMs: 0,
      cycle: 1,               // 第几个番茄（1-based）
      completedFocus: 0,      // 本次会话累计完成的番茄数
      label: '',
      config: normalizeConfig(config)
    };
  }

  function phaseMinutes(s, phase) {
    var c = s.config;
    if (phase === 'focus') { return c.focusMin; }
    if (phase === 'short') { return c.shortMin; }
    if (phase === 'long') { return c.longMin; }
    return 0;
  }

  function begin(s, phase, now) {
    var out = Object.assign({}, s);
    out.phase = phase;
    out.pausedFrom = '';
    out.startedAt = now;
    out.endsAt = now + phaseMinutes(s, phase) * 60000;
    out.remainMs = 0;
    return out;
  }

  function start(s, now, label) {
    var out = Object.assign({}, s);
    if (label !== undefined) { out.label = String(label || ''); }
    return begin(out, 'focus', now);
  }

  function pause(s, now) {
    if (s.phase !== 'focus' && s.phase !== 'short' && s.phase !== 'long') { return { state: s, event: null }; }
    var out = Object.assign({}, s);
    out.pausedFrom = s.phase;
    out.remainMs = Math.max(0, s.endsAt - now);
    out.phase = 'paused';
    return { state: out, event: null };
  }

  function resume(s, now) {
    if (s.phase !== 'paused') { return { state: s, event: null }; }
    var out = Object.assign({}, s);
    out.phase = s.pausedFrom;
    out.startedAt = now;
    out.endsAt = now + s.remainMs;
    out.remainMs = 0;
    out.pausedFrom = '';
    return { state: out, event: null };
  }

  function stop(s) {
    var out = createState(s.config);
    out.completedFocus = s.completedFocus;
    out.cycle = s.cycle;
    out.label = '';
    return out;
  }

  /** 推进时间：返回 { state, event } —— event 为 'focus-done' | 'break-done' | null */
  function tick(s, now) {
    if (s.phase === 'idle' || s.phase === 'paused') { return { state: s, event: null }; }
    if (now < s.endsAt) { return { state: s, event: null }; }
    var out = Object.assign({}, s);
    if (s.phase === 'focus') {
      out.completedFocus = s.completedFocus + 1;
      var isLong = out.completedFocus % s.config.cyclesBeforeLong === 0;
      var next = isLong ? 'long' : 'short';
      if (s.config.autoStartBreak) {
        return { state: begin(out, next, now), event: 'focus-done' };
      }
      out.phase = 'idle';
      out.endsAt = 0;
      out.startedAt = 0;
      out._next = next;
      return { state: out, event: 'focus-done' };
    }
    // 休息结束
    out.cycle = s.cycle + 1;
    if (s.config.autoStartFocus) {
      return { state: begin(out, 'focus', now), event: 'break-done' };
    }
    out.phase = 'idle';
    out.endsAt = 0;
    out.startedAt = 0;
    return { state: out, event: 'break-done' };
  }

  /** 手动跳到下一个阶段（休息结束→专注 / 专注→休息） */
  function skip(s, now) {
    if (s.phase === 'focus') {
      var out = Object.assign({}, s);
      out.completedFocus = s.completedFocus + 1;
      var isLong = out.completedFocus % s.config.cyclesBeforeLong === 0;
      return begin(out, isLong ? 'long' : 'short', now);
    }
    if (s.phase === 'short' || s.phase === 'long') {
      var o2 = Object.assign({}, s);
      o2.cycle = s.cycle + 1;
      return begin(o2, 'focus', now);
    }
    return begin(s, 'focus', now);
  }

  function remainMs(s, now) {
    if (s.phase === 'paused') { return s.remainMs; }
    if (s.phase === 'idle') { return phaseMinutes(s, s._next || 'focus') * 60000; }
    return Math.max(0, s.endsAt - now);
  }

  function progress(s, now) {
    if (s.phase === 'idle') { return 0; }
    var total = phaseMinutes(s, s.phase === 'paused' ? s.pausedFrom : s.phase) * 60000;
    if (!total) { return 0; }
    return Math.max(0, Math.min(1, 1 - remainMs(s, now) / total));
  }

  function phaseLabel(s) {
    if (s.phase === 'focus') { return '专注中'; }
    if (s.phase === 'short') { return '短休息'; }
    if (s.phase === 'long') { return '长休息'; }
    if (s.phase === 'paused') { return '已暂停'; }
    return '待开始';
  }

  /** 汇总一段时间内的专注记录 → 今日/本周统计 */
  function summarize(sessions, dayStr) {
    var list = sessions || [];
    var todayMin = 0, todayCount = 0, totalMin = 0, totalCount = 0;
    var byDay = {};
    list.forEach(function (x) {
      var min = Math.round((x.ms || 0) / 60000);
      totalMin += min;
      totalCount += 1;
      var d = x.day || '';
      if (!byDay[d]) { byDay[d] = { min: 0, count: 0 }; }
      byDay[d].min += min;
      byDay[d].count += 1;
      if (d === dayStr) { todayMin += min; todayCount += 1; }
    });
    return { todayMin: todayMin, todayCount: todayCount, totalMin: totalMin, totalCount: totalCount, byDay: byDay };
  }

  return {
    DEFAULTS: DEFAULTS,
    normalizeConfig: normalizeConfig,
    createState: createState,
    start: start,
    pause: pause,
    resume: resume,
    stop: stop,
    skip: skip,
    tick: tick,
    remainMs: remainMs,
    progress: progress,
    phaseLabel: phaseLabel,
    summarize: summarize
  };
});
