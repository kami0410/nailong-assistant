/* 自然语言快速添加：把「明天下午3点半和design组评审 #工作 提前10分钟」解析成任务字段
 * 纯函数，无依赖。中英混合都认。
 *
 * 返回：{ text, date, time, repeat, alarm, prio, tag, dur, hits:[...] }
 *  - date 为空表示「今天/未指定」，time 为 null 表示原文里没有时间
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var L = isNode ? require('./logic.js') : (typeof window !== 'undefined' ? window.WidgetLogic : null);
  var R = isNode ? require('./repeat.js') : (typeof window !== 'undefined' ? window.WidgetRepeat : null);
  var api = factory(L, R);
  if (isNode) { module.exports = api; }
  if (typeof window !== 'undefined') { window.WidgetNl = api; }
})(typeof window !== 'undefined' ? window : this, function (L, R) {
  var CN_NUM = { '零': 0, '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  function cnNum(s) {
    s = L.trim(s);
    if (s === '') { return null; }
    if (/^\d+$/.test(s)) { return parseInt(s, 10); }
    if (CN_NUM[s] !== undefined) { return CN_NUM[s]; }
    var m = /^十([一二三四五六七八九])?$/.exec(s);
    if (m) { return 10 + (m[1] ? CN_NUM[m[1]] : 0); }
    var m2 = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(s);
    if (m2) { return CN_NUM[m2[1]] * 10 + (m2[2] ? CN_NUM[m2[2]] : 0); }
    return null;
  }

  var PERIOD = [
    { re: /^(凌晨)/, shift: 0, twentyFour: true },
    { re: /^(清晨|早晨|早上|早间|上午|早上)/, shift: 0 },
    { re: /^(中午|正午)/, shift: 0, noon: true },
    { re: /^(下午|午后)/, shift: 12 },
    { re: /^(傍晚|晚上|夜里|夜间|晚间|今晚|明晚)/, shift: 12 }
  ];

  function periodShift(word) {
    for (var i = 0; i < PERIOD.length; i++) {
      if (PERIOD[i].re.test(word)) { return PERIOD[i]; }
    }
    return null;
  }

  function applyHour(h, word) {
    var p = periodShift(word || '');
    if (!p) { return h; }
    if (p.twentyFour) { return h >= 12 ? h - 12 : h; }
    if (p.noon) { return h < 12 ? h + 12 : h; }
    if (p.shift) { return h < 12 ? h + p.shift : h; }
    return h;
  }

  function isoWeekdayOf(word) {
    var t = String(word || '');
    if (/末|周末/.test(t)) { return [6, 7]; }
    var m = /([一二三四五六日天七])/.exec(t);
    if (!m) { return null; }
    return [L.CN_DOW[m[1]]];
  }

  /**
   * @param {string} input 原始输入
   * @param {Date|string} [now] 基准时刻；传 Date 保留时分（生产环境传 new Date()）
   */
  function parseQuickAdd(input, now) {
    if (now === undefined || now === null) { now = new Date(); }
    else if (!(now instanceof Date)) { now = L.dateObj(now) || new Date(); }
    var baseDate = L.fmtDateObj(now);
    var out = { text: '', date: '', time: null, repeat: null, alarm: 0, prio: 'mid', tag: '', dur: 0, hits: [] };
    var s = ' ' + String(input || '') + ' ';
    var used = false;

    function cut(re, fn) {
      s = s.replace(re, function () {
        var args = Array.prototype.slice.call(arguments);
        var whole = args[0];
        var caps = args.slice(1, -2);
        used = true;
        out.hits.push(whole);
        if (fn) { fn.apply(null, caps); }
        return ' ';
      });
    }

    // ---- 标签 ----
    cut(/(?:^|\s)[#@]([^\s#@|]{1,24})/g, function (tag) {
      out.tag = out.tag ? out.tag + ',' + tag : tag;
    });

    // ---- 优先级 ----
    cut(/(?:^|\s)(!!!|!!|!)(?=\s|$)/g, function (mark) {
      out.prio = mark.length >= 2 ? 'high' : 'mid';
      if (mark === '!') { out.prio = 'high'; }
    });
    cut(/(紧急|重要|很急|加急|高优(?:先)?)/g, function () { out.prio = 'high'; });
    cut(/(不急|低优(?:先)?|次要|随便)/g, function () { out.prio = 'low'; });

    // ---- 提前提醒 ----
    cut(/提前\s*([0-9]+|半)\s*(?:分钟|分|min)/g, function (n) {
      out.alarm = n === '半' ? 30 : parseInt(n, 10);
    });
    cut(/remind\s*me\s*([0-9]+)\s*min(?:ute)?s?\s*(?:before|early)/gi, function (n) { out.alarm = parseInt(n, 10); });

    // ---- 持续时长 ----
    cut(/(?:持续|时长|耗时)\s*([0-9]+|半|[一二两三四五六七八九十]+)\s*(小时|个小时|h|分钟|分|min)/g, function (n, unit) {
      var v = n === '半' ? 0.5 : (cnNum(n) || 0);
      out.dur = /^(小时|个小时|h)$/.test(unit) ? Math.round(v * 60) : Math.round(v);
    });

    // ---- 重复规则 ----
    cut(/(每天|每日|天天|每晚|每早|daily)/g, function () { out.repeat = { kind: 'daily' }; });
    cut(/(每个?工作日|weekdays?)/g, function () { out.repeat = { kind: 'weekly', dow: [1, 2, 3, 4, 5] }; });
    cut(/(每个?周末|weekends?)/g, function () { out.repeat = { kind: 'weekly', dow: [6, 7] }; });
    cut(/每(?:个)?(?:周|星期|礼拜)\s*([一二三四五六日天七]{1,7})/g, function (w) {
      var d = [];
      String(w).split('').forEach(function (ch) { if (L.CN_DOW[ch] && d.indexOf(L.CN_DOW[ch]) < 0) { d.push(L.CN_DOW[ch]); } });
      if (d.length) { out.repeat = { kind: 'weekly', dow: d.sort() }; }
    });
    cut(/每(?:个)?(?:周|星期|礼拜)(?=\s|$)/g, function () { out.repeat = { kind: 'weekly' }; });
    cut(/每(?:个)?月\s*([0-9]{1,2}|[一二三四五六七八九十]+)\s*[日号]/g, function (w) {
      var n = cnNum(w);
      if (n) { out.repeat = { kind: 'monthly', dom: [n] }; }
    });
    cut(/每(?:个)?月(?=\s|$)/g, function () { out.repeat = { kind: 'monthly' }; });
    cut(/每(?:个)?年(?=\s|$)/g, function () { out.repeat = { kind: 'yearly' }; });
    cut(/每(?:隔)?\s*([0-9]+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年)/g, function (n, unit) {
      var v = cnNum(n);
      if (!v) { return; }
      var u = /^(天|日)$/.test(unit) ? 'd' : /^(周|星期)$/.test(unit) ? 'w' : /^(个月|月)$/.test(unit) ? 'm' : 'y';
      out.repeat = { kind: 'interval', every: v, unit: u };
    });
    cut(/\bevery\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)\b/gi, function (n, unit) {
      var u = /^day/.test(unit) ? 'd' : /^week/.test(unit) ? 'w' : /^month/.test(unit) ? 'm' : 'y';
      out.repeat = { kind: 'interval', every: parseInt(n, 10), unit: u };
    });
    cut(/\bevery\s+(day|week|month|year)\b/gi, function (unit) {
      out.repeat = /^day/.test(unit) ? { kind: 'daily' } : /^week/.test(unit) ? { kind: 'weekly' } : /^month/.test(unit) ? { kind: 'monthly' } : { kind: 'yearly' };
    });

    // ---- 相对时间：N 分钟后 / N 小时后 / N 天后 ----
    cut(/([0-9]+|[一二两三四五六七八九十]+|半|一)\s*个?\s*(小时|钟头|分钟|分|天)\s*(?:之?后|later)/g, function (n, unit) {
      var v = n === '半' ? 0.5 : cnNum(n);
      if (v == null) { return; }
      var d = L.dateObj(baseDate);
      if (/^(小时|钟头)$/.test(unit)) {
        d = new Date(now.getTime() + v * 3600000);
      } else if (/^(分钟|分)$/.test(unit)) {
        d = new Date(now.getTime() + v * 60000);
      } else {
        d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + v, now.getHours(), now.getMinutes());
      }
      out.date = L.fmtDateObj(d);
      out.time = L.pad2(d.getHours()) + ':' + L.pad2(d.getMinutes());
    });
    cut(/\bin\s+(\d+)\s*(hour|hours|hr|hrs|minute|minutes|min|mins)\b/gi, function (n, unit) {
      var v = parseInt(n, 10);
      var d = /^h/i.test(unit) ? new Date(now.getTime() + v * 3600000) : new Date(now.getTime() + v * 60000);
      out.date = L.fmtDateObj(d);
      out.time = L.pad2(d.getHours()) + ':' + L.pad2(d.getMinutes());
    });

    // ---- 绝对日期 ----
    cut(/(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*[日号]?/g, function (y, mo, d) {
      var pd = L.parseDate(y + '-' + mo + '-' + d);
      if (pd) { out.date = pd; }
    });
    cut(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g, function (mo, d) {
      var y = now.getFullYear();
      var pd = L.parseDate(y + '-' + mo + '-' + d);
      if (pd && pd < baseDate) { pd = L.parseDate((y + 1) + '-' + mo + '-' + d); }
      if (pd) { out.date = pd; }
    });
    cut(/(?:^|\s)(\d{1,2})\s*[\/]\s*(\d{1,2})(?=\s|$)/g, function (mo, d) {
      var y = now.getFullYear();
      var pd = L.parseDate(y + '-' + mo + '-' + d);
      if (pd && pd < baseDate) { pd = L.parseDate((y + 1) + '-' + mo + '-' + d); }
      if (pd) { out.date = pd; }
    });

    // ---- 相对日 ----
    cut(/(下下|下|本|这|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天七])/g, function (prefix, w) {
      var dow = L.CN_DOW[w];
      if (!dow) { return; }
      var cur = L.isoDow(baseDate);
      var delta = dow - cur;
      if (prefix === '下' || prefix === '下下') { delta += 7 * (prefix === '下下' ? 2 : 1); }
      else if (prefix === '上') { delta -= 7; }
      else if (delta < 0) { delta += 7; }
      out.date = L.dateAdd(baseDate, delta);
    });
    cut(/(下下|下|本|这)?\s*(?:个)?月\s*(\d{1,2})\s*[日号]/g, function (prefix, d) {
      var y = now.getFullYear(), mo = now.getMonth() + (prefix === '下' || prefix === '下下' ? (prefix === '下下' ? 2 : 1) : 0);
      var dt = new Date(y, mo, parseInt(d, 10));
      out.date = L.fmtDateObj(dt);
    });
    cut(/(今天|今日|今晚|今早|今天早上)/g, function () { out.date = baseDate; });
    cut(/(明天|明日|明早|明晚|明儿)/g, function () { out.date = L.dateAdd(baseDate, 1); });
    cut(/(后天)/g, function () { out.date = L.dateAdd(baseDate, 2); });
    cut(/(大后天)/g, function () { out.date = L.dateAdd(baseDate, 3); });
    cut(/\btomorrow\b/gi, function () { out.date = L.dateAdd(baseDate, 1); });
    cut(/\btoday\b/gi, function () { out.date = baseDate; });

    // ---- 时间点 ----
    cut(/(凌晨|清晨|早晨|早上|早间|上午|中午|正午|下午|午后|傍晚|晚上|夜里|夜间|晚间)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3}|半)\s*[点时]\s*(半|[0-9]{1,2}|一刻|三刻|[一二三四五六七八九十]{1,3})?\s*分?/g, function (period, h, m) {
      var hh = h === '半' ? null : cnNum(h);
      if (hh === null || hh === undefined) { return; }
      var mm = 0;
      if (m === '半') { mm = 30; }
      else if (m === '一刻') { mm = 15; }
      else if (m === '三刻') { mm = 45; }
      else if (m) { var mv = cnNum(m); mm = (mv == null ? 0 : mv); }
      if (hh > 23 || mm > 59) { return; }
      out.time = L.pad2(applyHour(hh, period)) + ':' + L.pad2(mm);
    });
    cut(/(凌晨|清晨|早晨|早上|早间|上午|中午|正午|下午|午后|傍晚|晚上|夜里|夜间|晚间)?\s*([0-9]{1,2})\s*[:：]\s*([0-9]{2})\s*(?:分)?/g, function (period, h, m) {
      var hh = parseInt(h, 10), mm = parseInt(m, 10);
      if (hh > 23 || mm > 59) { return; }
      out.time = L.pad2(applyHour(hh, period)) + ':' + L.pad2(mm);
    });
    cut(/\b(?:at\s+)?([0-9]{1,2})\s*(am|pm)\b/gi, function (h, ap) {
      var hh = parseInt(h, 10) % 12 + (/pm/i.test(ap) ? 12 : 0);
      out.time = L.pad2(hh) + ':00';
    });

    out.text = L.trim(s.replace(/\s{2,}/g, ' '));
    if (out.repeat && !out.date) { out.date = baseDate; }
    out.matched = used;
    return out;
  }

  /** 给人类看的一句话摘要，用于回显确认 */
  function describeQuickAdd(parsed, today) {
    var bits = [];
    if (parsed.date) {
      var diff = L.daysBetween(today || L.todayStr(), parsed.date);
      if (diff === 0) { bits.push('今天'); }
      else if (diff === 1) { bits.push('明天'); }
      else if (diff === 2) { bits.push('后天'); }
      else { bits.push(parsed.date); }
    }
    if (parsed.time) { bits.push(parsed.time); }
    if (parsed.repeat) { bits.push(R.describeRepeat(parsed.repeat)); }
    if (parsed.alarm) { bits.push('提前 ' + parsed.alarm + ' 分钟提醒'); }
    if (parsed.prio === 'high') { bits.push('高优先级'); }
    if (parsed.tag) { bits.push('#' + parsed.tag); }
    return bits.join(' · ');
  }

  return { parseQuickAdd: parseQuickAdd, describeQuickAdd: describeQuickAdd, cnNum: cnNum };
});
