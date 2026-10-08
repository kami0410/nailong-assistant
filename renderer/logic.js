(function (root) {
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function trim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }
  function fmtDateObj(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr(d) { return fmtDateObj(d || new Date()); }
  function keyOf(it) { return (it.date ? it.date + ' ' : '') + it.time + '|' + it.text; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function parseTime(t) {
    t = trim(t).replace(/\uFF1A/g, ':');
    var m = /^([01]?[0-9]|2[0-3])(?::?([0-5][0-9]))$/.exec(t);
    if (!m) { return null; }
    return pad2(parseInt(m[1], 10)) + ':' + pad2(parseInt(m[2], 10));
  }
  function parseDate(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trim(s));
    if (!m) { return null; }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) { return null; }
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) { return null; }
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }
  function dateObj(s) {
    var n = parseDate(s);
    if (!n) { return null; }
    var p = n.split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  function byWhen(a, b) {
    var ka = (a.date || '9999-99-99') + ' ' + a.time;
    var kb = (b.date || '9999-99-99') + ' ' + b.time;
    if (ka < kb) { return -1; }
    if (ka > kb) { return 1; }
    return 0;
  }
  function parseSchedule(text) {
    var items = [];
    var lines = String(text || '').split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var ln = trim(lines[i]);
      if (ln === '') { continue; }
      var date = '';
      var rest = ln;
      var dm = /^(\d{4}-\d{1,2}-\d{1,2})\s+(.+)$/.exec(ln);
      if (dm) {
        var pd = parseDate(dm[1]);
        if (!pd) { continue; }
        date = pd;
        rest = trim(dm[2]);
      }
      var idx = rest.indexOf('|');
      if (idx < 0) { continue; }
      var t = parseTime(rest.substring(0, idx));
      var x = trim(rest.substring(idx + 1));
      if (!t || x === '') { continue; }
      items.push({ date: date, time: t, text: x });
    }
    items.sort(byWhen);
    return items;
  }
  function serializeSchedule(items) {
    if (!items.length) { return ''; }
    return items.map(function (it) {
      return (it.date ? it.date + ' ' : '') + it.time + '|' + it.text;
    }).join('\r\n') + '\r\n';
  }
  function itemsOn(items, dateStr) {
    return items.filter(function (it) { return it.date === dateStr || it.date === ''; });
  }
  function datedOn(items, dateStr) {
    return items.filter(function (it) { return it.date === dateStr; });
  }
  function daysBetween(aStr, bStr) {
    var a = dateObj(aStr), b = dateObj(bStr);
    if (!a || !b) { return null; }
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function daysUntil(dateStr, from) { return daysBetween(from || todayStr(), dateStr); }
  function dateAdd(dateStr, n) {
    var d = dateObj(dateStr);
    if (!d) { return null; }
    d.setDate(d.getDate() + n);
    return fmtDateObj(d);
  }
  var HOLIDAYS = {
    '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '04-01': '愚人节',
    '05-01': '劳动节', '05-04': '青年节', '06-01': '儿童节', '07-01': '建党节',
    '08-01': '建军节', '09-10': '教师节', '10-01': '国庆节', '11-11': '双十一',
    '12-24': '平安夜', '12-25': '圣诞节'
  };
  function holiday(dateStr) {
    var n = parseDate(dateStr);
    if (!n) { return ''; }
    return HOLIDAYS[n.substring(5)] || '';
  }
  function parseCountdown(text) {
    var list = [];
    var lines = String(text || '').split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var ln = trim(lines[i]);
      if (ln === '') { continue; }
      var idx = ln.indexOf('|');
      if (idx < 0) { continue; }
      var d = parseDate(ln.substring(0, idx));
      var x = trim(ln.substring(idx + 1));
      if (!d || x === '') { continue; }
      list.push({ date: d, text: x });
    }
    list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return list;
  }
  function serializeCountdown(list) {
    if (!list.length) { return ''; }
    return list.map(function (it) { return it.date + '|' + it.text; }).join('\r\n') + '\r\n';
  }
  function nextCountdowns(list, from, max) {
    var fromStr = from || todayStr();
    return list
      .map(function (it) {
        return { date: it.date, text: it.text, days: daysUntil(it.date, fromStr) };
      })
      .filter(function (it) { return it.days !== null && it.days >= 0; })
      .sort(function (a, b) { return a.days - b.days; })
      .slice(0, max || 5);
  }
  function weekdayCn(d) {
    return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  }
  var api = {
    pad2: pad2,
    trim: trim,
    todayStr: todayStr,
    fmtDateObj: fmtDateObj,
    keyOf: keyOf,
    esc: esc,
    parseTime: parseTime,
    parseDate: parseDate,
    dateObj: dateObj,
    byWhen: byWhen,
    parseSchedule: parseSchedule,
    serializeSchedule: serializeSchedule,
    itemsOn: itemsOn,
    datedOn: datedOn,
    daysBetween: daysBetween,
    daysUntil: daysUntil,
    dateAdd: dateAdd,
    holiday: holiday,
    parseCountdown: parseCountdown,
    serializeCountdown: serializeCountdown,
    nextCountdowns: nextCountdowns,
    weekdayCn: weekdayCn
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.WidgetLogic = api; }
})(typeof window !== 'undefined' ? window : this);
