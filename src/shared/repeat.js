/* 重复规则（RRULE-lite）：纯函数，无依赖
 *
 * 规格字符串（可读、可手写）：
 *   daily | 每天 | 每日
 *   weekdays | 工作日            → 周一~周五
 *   weekends | 周末
 *   weekly | 每周                → 与起始日同一个星期几
 *   weekly:1,3,5 | 每周一,周三    → ISO 周几（1=周一…7=周日）
 *   monthly | 每月               → 与起始日同一个日
 *   monthly:1,15 | 每月1,15号
 *   yearly | 每年                → 与起始日同月同日
 *   every:2d | every 2 days | 每2天 | 每隔2天 | 每2周 | 每3个月
 *
 * 规则对象：{ kind:'daily'|'weekly'|'monthly'|'yearly'|'interval',
 *            dow:[1..7], dom:[1..31], every:Number, unit:'d'|'w'|'m'|'y' }
 */
(function () {
var L = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./logic.js') : (typeof window !== 'undefined' ? window.WidgetLogic : null);

var DOW_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '七': 7 };
var DOW_EN = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

function parseDowList(s) {
  var out = [];
  String(s || '').split(/[,，、\s]+/).forEach(function (raw) {
    var t = String(raw).trim().toLowerCase();
    if (t === '') { return; }
    if (DOW_EN[t]) { out.push(DOW_EN[t]); return; }
    var cn = /^周?([一二三四五六日天七])$/.exec(t);
    if (cn) { out.push(DOW_CN[cn[1]]); return; }
    var cn2 = /^(?:星期|礼拜)([一二三四五六日天七])$/.exec(t);
    if (cn2) { out.push(DOW_CN[cn2[1]]); return; }
    var n = parseInt(t, 10);
    if (n >= 1 && n <= 7) { out.push(n); }
  });
  var uniq = [];
  out.forEach(function (n) { if (uniq.indexOf(n) < 0) { uniq.push(n); } });
  return uniq.sort(function (a, b) { return a - b; });
}

function parseDomList(s) {
  var out = [];
  String(s || '').split(/[,，、\s]+/).forEach(function (raw) {
    var n = parseInt(String(raw).replace(/[日号]/g, ''), 10);
    if (n >= 1 && n <= 31) { out.push(n); }
  });
  return out.sort(function (a, b) { return a - b; });
}

function parseEvery(s) {
  var t = String(s || '').trim().toLowerCase().replace(/^(every[:\s]*|每(?:隔)?\s*)/, '').replace(/\s+/g, '');
  var m = /^(\d+)(days|day|weeks|week|months|month|years|year|d|w|m|y|天|日|周|星期|个月|月|年)/.exec(t);
  if (!m) { return null; }
  var n = parseInt(m[1], 10);
  if (!(n > 0)) { return null; }
  var u = m[2];
  if (/^(d|day|days|天|日)$/.test(u)) { return { kind: 'interval', every: n, unit: 'd' }; }
  if (/^(w|week|weeks|周|星期)$/.test(u)) { return { kind: 'interval', every: n, unit: 'w' }; }
  if (/^(m|month|months|个月|月)$/.test(u)) { return { kind: 'interval', every: n, unit: 'm' }; }
  if (/^(y|year|years|年)$/.test(u)) { return { kind: 'interval', every: n, unit: 'y' }; }
  return null;
}

/** 把用户写的规格字符串解析成规则对象；无规则返回 null */
function parseRepeat(spec) {
  var s = L.trim(spec).toLowerCase().replace(/[：]/g, ':');
  if (s === '' || s === 'no' || s === 'none' || s === '无' || s === '不重复') { return null; }
  if (/^(每 ?天|每日|每天|daily|day|天)$/.test(s)) { return { kind: 'daily' }; }
  if (/^(工作日|每个工作日|weekday|weekdays)$/.test(s)) { return { kind: 'weekly', dow: [1, 2, 3, 4, 5] }; }
  if (/^(周末|每个周末|weekend|weekends)$/.test(s)) { return { kind: 'weekly', dow: [6, 7] }; }
  if (/^(每周|每星期|weekly|week)$/.test(s)) { return { kind: 'weekly' }; }
  if (/^(每月|monthly|month)$/.test(s)) { return { kind: 'monthly' }; }
  if (/^(每年|yearly|annually|year)$/.test(s)) { return { kind: 'yearly' }; }
  if (/^(every|每|每隔)/.test(s)) {
    var ev0 = parseEvery(s);
    if (ev0) { return ev0; }
  }

  var wk = /^(?:每?周|每周|每?星期|每?礼拜|weekly:)([一二三四五六日天七].*)$/.exec(s);
  if (wk) { var d1 = parseDowList(wk[1]); if (d1.length) { return { kind: 'weekly', dow: d1 }; } }
  var wkEn = /^weekly:(.*)$/.exec(s);
  if (wkEn) { var d2 = parseDowList(wkEn[1]); if (d2.length) { return { kind: 'weekly', dow: d2 }; } }
  var mo = /^(?:每?月|monthly:)(\d.*)$/.exec(s);
  if (mo) { var m1 = parseDomList(mo[1]); if (m1.length) { return { kind: 'monthly', dom: m1 }; } }
  var ev = parseEvery(s);
  if (ev) { return ev; }
  return null;
}

function serializeRepeat(r) {
  if (!r) { return ''; }
  if (r.kind === 'daily') { return 'daily'; }
  if (r.kind === 'weekly') {
    if (!r.dow || !r.dow.length) { return 'weekly'; }
    if (r.dow.length === 5 && r.dow.join(',') === '1,2,3,4,5') { return 'weekdays'; }
    if (r.dow.length === 2 && r.dow.join(',') === '6,7') { return 'weekends'; }
    return 'weekly:' + r.dow.join(',');
  }
  if (r.kind === 'monthly') { return 'monthly' + (r.dom && r.dom.length ? ':' + r.dom.join(',') : ''); }
  if (r.kind === 'yearly') { return 'yearly'; }
  if (r.kind === 'interval') { return 'every:' + r.every + r.unit; }
  return '';
}

function describeRepeat(r) {
  if (!r) { return ''; }
  if (r.kind === 'daily') { return '每天'; }
  if (r.kind === 'weekly') {
    if (!r.dow || !r.dow.length) { return '每周'; }
    if (r.dow.join(',') === '1,2,3,4,5') { return '每个工作日'; }
    if (r.dow.join(',') === '6,7') { return '每周末'; }
    return '每周 ' + r.dow.map(function (d) { return '周' + '一二三四五六日'.charAt(d - 1); }).join('、');
  }
  if (r.kind === 'monthly') { return '每月' + (r.dom && r.dom.length ? ' ' + r.dom.join('、') + ' 号' : ''); }
  if (r.kind === 'yearly') { return '每年'; }
  if (r.kind === 'interval') {
    var u = r.unit === 'd' ? '天' : r.unit === 'w' ? '周' : r.unit === 'm' ? '个月' : '年';
    return '每 ' + r.every + ' ' + u;
  }
  return '';
}

/** 规则锚点：没有起始日期时用 anchor 兜底（interval 必须有锚点才不会漂移） */
function anchorDate(task, baseline) {
  return (task && task.date) ? task.date : (baseline || L.todayStr());
}

function intervalHit(task, dateStr) {
  var r = task.repeat;
  var a = anchorDate(task, dateStr);
  var diff = L.daysBetween(a, dateStr);
  if (diff === null || diff < 0) { return false; }
  if (r.unit === 'd') { return diff % r.every === 0; }
  if (r.unit === 'w') { return diff % (r.every * 7) === 0; }
  if (r.unit === 'm') {
    var A = L.dateObj(a), B = L.dateObj(dateStr);
    var months = (B.getFullYear() - A.getFullYear()) * 12 + (B.getMonth() - A.getMonth());
    if (months < 0 || months % r.every !== 0) { return false; }
    return B.getDate() === A.getDate();
  }
  if (r.unit === 'y') {
    var A2 = L.dateObj(a), B2 = L.dateObj(dateStr);
    var years = B2.getFullYear() - A2.getFullYear();
    return years >= 0 && years % r.every === 0 && B2.getMonth() === A2.getMonth() && B2.getDate() === A2.getDate();
  }
  return false;
}

/** 该任务在 dateStr 这天是否出现 */
function occursOn(task, dateStr) {
  if (!task || !dateStr) { return false; }
  var r = task.repeat;
  if (!r) {
    // 无重复：指定日期只在那天出现；不指定日期 = 每天都出现（v2 兼容语义）
    return task.date ? task.date === dateStr : true;
  }
  if (task.date && dateStr < task.date) { return false; }
  if (task.until && dateStr > task.until) { return false; }
  if (r.kind === 'daily') { return true; }
  if (r.kind === 'interval') { return intervalHit(task, dateStr); }
  if (r.kind === 'weekly') {
    var dow = (r.dow && r.dow.length) ? r.dow : [L.isoDow(anchorDate(task, dateStr))];
    return dow.indexOf(L.isoDow(dateStr)) >= 0;
  }
  if (r.kind === 'monthly') {
    var dom = (r.dom && r.dom.length) ? r.dom : [L.dateObj(anchorDate(task, dateStr)).getDate()];
    return dom.indexOf(L.dateObj(dateStr).getDate()) >= 0;
  }
  if (r.kind === 'yearly') {
    var a = L.dateObj(anchorDate(task, dateStr));
    var b = L.dateObj(dateStr);
    return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  return false;
}

/** 从 fromDate（含）开始找下一次出现；maxDays 内没找到返回 null */
function nextOccurrence(task, fromDate, maxDays) {
  var from = fromDate || L.todayStr();
  var limit = maxDays || 400;
  if (!task.repeat) {
    if (!task.date) { return from; }
    return task.date >= from ? task.date : null;
  }
  var d = from;
  if (task.date && task.date > d) { d = task.date; }
  for (var i = 0; i <= limit; i++) {
    if (occursOn(task, d)) { return d; }
    d = L.dateAdd(d, 1);
    if (!d) { return null; }
    if (task.until && d > task.until) { return null; }
  }
  return null;
}

var API = {
  parseRepeat: parseRepeat,
  serializeRepeat: serializeRepeat,
  describeRepeat: describeRepeat,
  occursOn: occursOn,
  nextOccurrence: nextOccurrence,
  parseDowList: parseDowList,
  parseDomList: parseDomList
};

if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
if (typeof window !== 'undefined') { window.WidgetRepeat = API; }
})();
