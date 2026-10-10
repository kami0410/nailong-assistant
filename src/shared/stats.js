/* 打卡 / 连签 / 热力图统计（纯函数） */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var L = isNode ? require('./logic.js') : window.WidgetLogic;
  var T = isNode ? require('./task.js') : window.WidgetTask;
  var api = factory(L, T);
  if (isNode) { module.exports = api; }
  if (typeof window !== 'undefined') { window.WidgetStats = api; }
})(typeof window !== 'undefined' ? window : this, function (L, T) {
  /** 某天的完成情况 */
  function dayProgress(tasks, done, dateStr) {
    var items = T.itemsOn(tasks, dateStr);
    var doneArr = (done && done[dateStr]) || [];
    var n = 0;
    items.forEach(function (t) { if (doneArr.indexOf(T.keyOf(t)) >= 0) { n++; } });
    return {
      total: items.length,
      done: n,
      left: items.length - n,
      pct: items.length ? Math.round(n / items.length * 100) : 0,
      complete: items.length > 0 && n === items.length
    };
  }

  function todayProgress(tasks, done, today) { return dayProgress(tasks, done, today || L.todayStr()); }

  /** 连签天数：含今天（今天没做完则从昨天起算） */
  function streak(completedDays, today) {
    var set = {};
    (completedDays || []).forEach(function (d) { set[d] = true; });
    var d = today || L.todayStr();
    var n = 0;
    if (!set[d]) {
      d = L.dateAdd(d, -1);
      if (!set[d]) { return 0; }
    }
    while (set[d]) {
      n++;
      d = L.dateAdd(d, -1);
    }
    return n;
  }

  function longestStreak(completedDays) {
    var days = (completedDays || []).slice().sort();
    var best = 0, cur = 0, prev = null;
    days.forEach(function (d) {
      if (prev && L.daysBetween(prev, d) === 1) { cur++; } else { cur = 1; }
      prev = d;
      if (cur > best) { best = cur; }
    });
    return best;
  }

  /** 近 n 天热力图数据（从旧到新）：[{date, total, done, pct, level 0..4}] */
  function heatmap(tasks, done, days, today) {
    var end = today || L.todayStr();
    var n = days || 30;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = L.dateAdd(end, -i);
      var p = dayProgress(tasks, done, d);
      var level = 0;
      if (p.total > 0) {
        if (p.pct >= 100) { level = 4; }
        else if (p.pct >= 60) { level = 3; }
        else if (p.pct >= 30) { level = 2; }
        else if (p.pct > 0) { level = 1; }
      }
      out.push({ date: d, total: p.total, done: p.done, pct: p.pct, level: level });
    }
    return out;
  }

  /** 近 n 天完成率 / 活跃天数 */
  function windowSummary(tasks, done, days, today) {
    var hm = heatmap(tasks, done, days, today);
    var active = 0, totalItems = 0, doneItems = 0;
    hm.forEach(function (x) {
      if (x.total > 0) { active++; }
      totalItems += x.total;
      doneItems += x.done;
    });
    return {
      days: hm.length,
      activeDays: active,
      totalItems: totalItems,
      doneItems: doneItems,
      rate: totalItems ? Math.round(doneItems / totalItems * 100) : 0
    };
  }

  /** 按标签统计（近 n 天完成率） */
  function byTag(tasks, done, days, today) {
    var end = today || L.todayStr();
    var map = {};
    for (var i = (days || 30) - 1; i >= 0; i--) {
      var d = L.dateAdd(end, -i);
      var arr = (done && done[d]) || [];
      T.itemsOn(tasks, d).forEach(function (t) {
        var tag = t.tag || '未分类';
        if (!map[tag]) { map[tag] = { tag: tag, total: 0, done: 0 }; }
        map[tag].total++;
        if (arr.indexOf(T.keyOf(t)) >= 0) { map[tag].done++; }
      });
    }
    return Object.keys(map).map(function (k) {
      var v = map[k];
      v.pct = v.total ? Math.round(v.done / v.total * 100) : 0;
      return v;
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /** 高效时段：按完成的小时分布 */
  function byHour(tasks, done, days, today) {
    var end = today || L.todayStr();
    var buckets = new Array(24).fill(0);
    for (var i = (days || 30) - 1; i >= 0; i--) {
      var d = L.dateAdd(end, -i);
      var arr = (done && done[d]) || [];
      T.itemsOn(tasks, d).forEach(function (t) {
        if (arr.indexOf(T.keyOf(t)) >= 0) { buckets[parseInt(t.time.split(':')[0], 10)]++; }
      });
    }
    return buckets;
  }

  return {
    dayProgress: dayProgress,
    todayProgress: todayProgress,
    streak: streak,
    longestStreak: longestStreak,
    heatmap: heatmap,
    windowSummary: windowSummary,
    byTag: byTag,
    byHour: byHour
  };
});
