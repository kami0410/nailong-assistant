/* 任务模型 + 可手写的纯文本格式（v3）
 *
 * 一行一条，`#` 开头是注释：
 *   09:00|晨会
 *   2026-10-08 09:00|组会
 *   09:00|晨会|repeat=weekdays
 *   09:00|喝水|repeat=every:2d;alarm=5
 *   2026-10-08 09:00|交报告|repeat=monthly:1,15;prio=high;tag=工作;dur=60
 *
 * 修饰符都用 `键=值`，分号分隔。文本里出现 `|` 也没关系（只有「最后一段全是 键=值」时才当修饰符）。
 * 字段：repeat 重复 / alarm 提前N分钟提醒 / prio high|mid|low / tag 标签 / dur 持续分钟
 *       until 重复截止日 / note 备注 / silent 1=静音提醒
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var L = isNode ? require('./logic.js') : (typeof window !== 'undefined' ? window.WidgetLogic : null);
  var R = isNode ? require('./repeat.js') : (typeof window !== 'undefined' ? window.WidgetRepeat : null);
  var api = factory(L, R);
  if (isNode) { module.exports = api; }
  if (typeof window !== 'undefined') { window.WidgetTask = api; }
})(typeof window !== 'undefined' ? window : this, function (L, R) {
  var MOD_RE = /^\s*[a-z_]+\s*=[^;|]*(\s*;\s*[a-z_]+\s*=[^;|]*)*\s*;?\s*$/i;

  function parseMods(s) {
    var out = {};
    String(s || '').split(';').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) { return; }
      var k = L.trim(kv.substring(0, i)).toLowerCase();
      var v = L.trim(kv.substring(i + 1));
      if (k !== '' && v !== '') { out[k] = v; }
    });
    return out;
  }

  function taskFromLine(line) {
    var ln = L.trim(line);
    if (ln === '' || ln.charAt(0) === '#') { return null; }
    var idx = ln.indexOf('|');
    if (idx < 0) { return null; }

    var head = L.trim(ln.substring(0, idx));
    var rest = ln.substring(idx + 1);

    // 末段如果长得像「全是 键=值」则当作修饰符，否则整个 rest 都是内容
    var modsStr = '';
    var lastPipe = rest.lastIndexOf('|');
    if (lastPipe >= 0) {
      var tail = rest.substring(lastPipe + 1);
      if (MOD_RE.test(tail) && tail.indexOf('=') >= 0) {
        modsStr = tail;
        rest = rest.substring(0, lastPipe);
      }
    }
    var text = L.trim(rest);
    if (text === '') { return null; }

    var date = '';
    var dm = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s+(.+)$/.exec(head);
    if (dm) {
      var pd = L.parseDate(dm[1]);
      if (!pd) { return null; }
      date = pd;
      head = L.trim(dm[2]);
    }
    var time = L.parseTime(head);
    if (!time) { return null; }

    var m = parseMods(modsStr);
    var task = { date: date, time: time, text: text };
    if (m.repeat) { task.repeat = R.parseRepeat(m.repeat); }
    if (m.alarm !== undefined) {
      var a = parseInt(m.alarm, 10);
      if (a > 0) { task.alarm = Math.min(1440, a); }
    }
    if (m.prio) {
      var p = m.prio.toLowerCase();
      task.prio = /^(high|h|高|重要|1)$/.test(p) ? 'high' : /^(low|l|低|3)$/.test(p) ? 'low' : 'mid';
    }
    if (m.tag) { task.tag = m.tag; }
    if (m.dur !== undefined) {
      var d = parseInt(m.dur, 10);
      if (d > 0) { task.dur = Math.min(1440, d); }
    }
    if (m.until) { var u = L.parseDate(m.until); if (u) { task.until = u; } }
    if (m.note) { task.note = m.note; }
    if (m.silent === '1' || m.silent === 'true') { task.silent = true; }
    return task;
  }

  function taskToLine(t) {
    var head = (t.date ? t.date + ' ' : '') + t.time;
    var mods = [];
    if (t.repeat) { var rs = R.serializeRepeat(t.repeat); if (rs) { mods.push('repeat=' + rs); } }
    if (t.alarm) { mods.push('alarm=' + t.alarm); }
    if (t.prio && t.prio !== 'mid') { mods.push('prio=' + t.prio); }
    if (t.tag) { mods.push('tag=' + t.tag); }
    if (t.dur) { mods.push('dur=' + t.dur); }
    if (t.until) { mods.push('until=' + t.until); }
    if (t.note) { mods.push('note=' + t.note); }
    if (t.silent) { mods.push('silent=1'); }
    var line = head + '|' + t.text;
    if (mods.length) { line += '|' + mods.join(';'); }
    return line;
  }

  function byWhen(a, b) {
    var ka = (a.date || '0000-00-00') + ' ' + a.time;
    var kb = (b.date || '0000-00-00') + ' ' + b.time;
    if (ka < kb) { return -1; }
    if (ka > kb) { return 1; }
    var pa = a.prio === 'high' ? 0 : a.prio === 'low' ? 2 : 1;
    var pb = b.prio === 'high' ? 0 : b.prio === 'low' ? 2 : 1;
    if (pa !== pb) { return pa - pb; }
    return 0;
  }

  function parseTasks(text) {
    var items = [];
    String(text || '').split(/\r\n|\r|\n/).forEach(function (line) {
      var t = taskFromLine(line);
      if (t) { items.push(t); }
    });
    items.sort(byWhen);
    return items;
  }

  function serializeTasks(items) {
    if (!items || !items.length) { return ''; }
    return items.map(taskToLine).join('\r\n') + '\r\n';
  }

  /** 打卡用 key：与 v2 完全一致，保证老 state.json 不失效 */
  function keyOf(t) { return (t.date ? t.date + ' ' : '') + t.time + '|' + t.text; }

  function occursOn(t, dateStr) { return R.occursOn(t, dateStr); }

  /** 某天的任务（含重复展开） */
  function itemsOn(items, dateStr) {
    return (items || []).filter(function (t) { return R.occursOn(t, dateStr); }).sort(byWhen);
  }

  /** 只要在该日期锚定的一次性任务 */
  function datedOn(items, dateStr) {
    return (items || []).filter(function (t) { return t.date === dateStr; });
  }

  /** 未来 n 天内所有 (date, task) 出现点，按时间排序 */
  function occurrencesUntil(items, fromDate, days) {
    var out = [];
    for (var i = 0; i <= days; i++) {
      var d = L.dateAdd(fromDate, i);
      if (!d) { break; }
      itemsOn(items, d).forEach(function (t) {
        if (t.repeat) {
          var next = R.nextOccurrence(t, d);
          if (next !== d) { return; }
        }
        out.push({ date: d, task: t });
      });
    }
    return out;
  }

  function isDone(doneMap, dateStr, key) {
    var arr = (doneMap && doneMap[dateStr]) || [];
    return arr.indexOf(key) >= 0;
  }

  /** 找一条最匹配的任务：先精确 key，再按时间+文本、再按文本包含 */
  function findTask(items, query) {
    var q = L.trim(query);
    if (q === '') { return null; }
    var i;
    for (i = 0; i < items.length; i++) { if (keyOf(items[i]) === q) { return items[i]; } }
    for (i = 0; i < items.length; i++) { if (items[i].text === q) { return items[i]; } }
    var hits = items.filter(function (t) { return t.text.indexOf(q) >= 0; });
    if (hits.length === 1) { return hits[0]; }
    return hits.length ? hits[0] : null;
  }

  /** 重叠检测：返回与 t 在同一时刻附近冲突的任务（用于日历/提醒提示） */
  function conflicts(items, dateStr, t, windowMin) {
    var w = windowMin === undefined ? 0 : windowMin;
    var a = L.hm2min(t.time);
    return itemsOn(items, dateStr).filter(function (o) {
      if (o === t) { return false; }
      var b = L.hm2min(o.time);
      return Math.abs(a - b) <= w;
    });
  }

  return {
    parseTasks: parseTasks,
    serializeTasks: serializeTasks,
    taskFromLine: taskFromLine,
    taskToLine: taskToLine,
    keyOf: keyOf,
    itemsOn: itemsOn,
    datedOn: datedOn,
    occursOn: occursOn,
    occurrencesUntil: occurrencesUntil,
    nextOccurrence: R.nextOccurrence,
    describeRepeat: R.describeRepeat,
    isDone: isDone,
    findTask: findTask,
    conflicts: conflicts,
    byWhen: byWhen
  };
});
