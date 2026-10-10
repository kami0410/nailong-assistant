'use strict';
/* 无头式界面自检（npm run audit）
 *
 * 为什么需要它：六个窗口 × 六套主题，靠肉眼盯会漏。这里把每个窗口的
 *  - 是否溢出窗口边界
 *  - 玻璃材质（backdrop-filter / 渐变 / 圆角 / 描边）有没有真的戴上
 *  - 关键元素是否存在、有没有被压成 0 尺寸
 * 全都 dump 成 JSON，一眼就能看出回归。
 */

const fs = require('fs');
const path = require('path');

const P = require('./paths.js');

// 在各个渲染窗口里跑的探针（必须是自包含的字符串）
const PROBE = `(function () {
  function r(el) {
    var b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  }
  var out = {
    theme: document.body.className || '(none)',
    win: { w: window.innerWidth, h: window.innerHeight },
    overflow: {
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight
    },
    styleSheets: document.styleSheets.length,
    widgetApi: typeof window.widget === 'object',
    logic: typeof window.WidgetLogic === 'object',
    audio: typeof window.WidgetAudio === 'object'
  };
  var card = document.querySelector('.card') || document.getElementById('card');
  if (card) {
    var cs = getComputedStyle(card);
    out.card = {
      rect: r(card),
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      bg: (cs.backgroundImage || 'none').slice(0, 64),
      radius: cs.borderRadius,
      shadow: (cs.boxShadow || 'none').slice(0, 48)
    };
  }
  var token = getComputedStyle(document.body);
  out.tokens = {
    accent: token.getPropertyValue('--accent').trim(),
    accentGrad: token.getPropertyValue('--accent-grad').trim().slice(0, 40),
    fg: token.getPropertyValue('--fg').trim(),
    rXl: token.getPropertyValue('--r-xl').trim()
  };
  // 关键元素（各窗口共用 + 各窗口特有）
  var ids = ['bubble', 'pet', 'chip', 'list', 'quickInput', 'cdstrip', 'msgs', 'msgInput',
    'pending', 'v-focus', 'ringFg', 'toolList', 'ctl', 'nav', 'memList', 'clock', 'heat'];
  out.nodes = {};
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var cs2 = getComputedStyle(el);
    out.nodes[id] = { rect: r(el), display: cs2.display, visible: cs2.visibility !== 'hidden' && cs2.opacity !== '0' };
  });
  // 越界检测：只抓「真的被裁掉」的元素。
  // 规则：往上找最近一个 overflow != visible 的祖先——
  //   1) 它是 auto/scroll  → 说明可以滚，不算错
  //   2) 它是 hidden/clip   → 元素超出它的盒子就是真被裁了
  function clipAncestor(el) {
    var p = el.parentElement;
    while (p && p !== document.body) {
      var cs = getComputedStyle(p);
      var ox = cs.overflowX, oy = cs.overflowY;
      if (oy !== 'visible' || ox !== 'visible') {
        return { el: p, overflowY: oy, overflowX: ox };
      }
      p = p.parentElement;
    }
    return null;
  }
  var offenders = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length && offenders.length < 14; i++) {
    var el2 = all[i];
    if (el2.classList && (el2.classList.contains('backdrop') || el2.classList.contains('sheen'))) continue;
    var cs3 = getComputedStyle(el2);
    if (cs3.display === 'none' || cs3.visibility === 'hidden') continue;
    if (cs3.position === 'fixed' || cs3.position === 'absolute') continue;
    var b2 = el2.getBoundingClientRect();
    if (b2.width < 1 || b2.height < 1) continue;
    var anc = clipAncestor(el2);
    if (anc && (anc.overflowY === 'auto' || anc.overflowY === 'scroll' || anc.overflowX === 'auto' || anc.overflowX === 'scroll')) continue;
    var box = anc ? anc.el.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    var cut = b2.bottom - box.bottom > 2 || box.top - b2.top > 2 || b2.right - box.right > 2 || box.left - b2.left > 2;
    if (!cut) continue;
    var tag = el2.tagName.toLowerCase() + (el2.id ? '#' + el2.id : (el2.className ? '.' + String(el2.className).split(' ')[0] : ''));
    offenders.push({
      el: tag,
      rect: { x: Math.round(b2.left), y: Math.round(b2.top), w: Math.round(b2.width), h: Math.round(b2.height) },
      clippedBy: anc ? (anc.el.id || anc.el.className || anc.el.tagName.toLowerCase()) : 'window',
      over: { right: Math.round(b2.right - box.right), bottom: Math.round(b2.bottom - box.bottom) }
    });
  }
  out.offenders = offenders;
  out.overlaps = [];
  var status = document.getElementById('status');
  var activeNote = document.querySelector('.view.on .note');
  if (status && activeNote && status.textContent.trim()) {
    var sb = status.getBoundingClientRect(), nb = activeNote.getBoundingClientRect();
    if (nb.bottom > sb.top + 1) out.overlaps.push('active-view-note/status');
  }
  out.unstyledInputs = Array.prototype.slice.call(document.querySelectorAll('input:not([type]), input[type=text], input[type=search], input[type=url], input[type=password], textarea, select'))
    .filter(function (el) { return getComputedStyle(el).borderRadius === '0px'; }).map(function (el) { return el.id; });
  // i18n 接线：页面上有 data-i18n 的话，字典得在，而且文字不该还等于 key 名
  out.i18n = {
    tags: document.querySelectorAll('[data-i18n]').length,
    dictLoaded: typeof window.WidgetI18n === 'object' && typeof window.WidgetI18n.t === 'function',
    untranslated: Array.prototype.slice.call(document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-ph]'))
      .filter((el) => ['data-i18n', 'data-i18n-title', 'data-i18n-ph'].some(function (attr) {
        var key = el.getAttribute(attr);
        var I = window.WidgetI18n;
        return key && (!I || !I.dict || typeof I.dict['zh-CN'][key] !== 'string' || typeof I.dict.en[key] !== 'string');
      })).length
  };
  return JSON.stringify(out);
})()`;

// 面板里几个隐藏的视图要一个个点开看，否则测不到
const VIEW_SWEEP = {
  panel: [
    { view: 'list', open: null },
    { view: 'cal', open: "document.getElementById('openCalBtn').click()" },
    { view: 'stats', open: "document.getElementById('backListBtn').click();document.getElementById('statsbtn').click()" },
    { view: 'add', open: "document.getElementById('backFromStats').click();document.getElementById('addItemBtn').click()" },
    { view: 'list-back', open: "document.getElementById('cancelAdd').click()" }
  ],
  settings: [
    { view: 'model', open: null },
    { view: 'model-parameters', open: "document.querySelector('[data-config=models]').click()", verify: "!document.getElementById('config-models').hidden", expect: 'true' },
    { view: 'runtime', open: "document.querySelector('[data-config=runtime]').click()", verify: "!document.getElementById('config-runtime').hidden", expect: 'true' },
    { view: 'resources', open: "document.querySelector('[data-config=resources]').click()", verify: "!document.getElementById('config-resources').hidden", expect: 'true' },
    { view: 'connection-back', open: "document.querySelector('[data-config=connection]').click()", verify: "!document.getElementById('config-connection').hidden", expect: 'true' },
    { view: 'perm', open: "document.querySelector('[data-page=perm]').click()" },
    { view: 'look', open: "document.querySelector('[data-page=look]').click()" },
    { view: 'remind', open: "document.querySelector('[data-page=remind]').click()" },
    { view: 'data', open: "document.querySelector('[data-page=data]').click()" },
    { view: 'about', open: "document.querySelector('[data-page=about]').click()" },
    { view: 'model-back', open: "document.querySelector('[data-page=model]').click()" }
  ],
  tool: [
    // 步骤带 verify/expect 时，会先点、再取值判断 —— 用来抓“点了没反应”的接线断了
    // （排版自检查不出这个：番茄钟 UI 一直在，但 JS 没接上时点开始是没动静的）
    { view: 'focus', open: null },
    { view: 'focus-start', open: "document.getElementById('pomoStart').click()",
      verify: "document.getElementById('pomoPhase').textContent", expect: '专注' },
    // 主循环每秒刷新，显示又向上取整；跨两个刷新周期再比较，避免同一秒的假失败。
    { view: 'focus-tick', wait: 2250,
      verify: "Number(document.getElementById('pomoTime').textContent.replace(':', '.')) < Number(window.__auditStartTime.replace(':', '.'))", expect: 'true' },
    { view: 'focus-stop', open: "document.getElementById('pomoStop').click()" },
    { view: 'countdown', open: "document.querySelector('[data-tab=countdown]').click()" },
    { view: 'alarm', open: "document.querySelector('[data-tab=alarm]').click()" },
    { view: 'coin', open: "document.querySelector('[data-tab=coin]').click()" },
    { view: 'focus-back', open: "document.querySelector('[data-tab=focus]').click()" }
  ],
  assistant: [
    { view: 'chat', open: "show('chat')", verify: "document.getElementById('v-chat').getBoundingClientRect().height > 0", expect: 'true' },
    // 底部选择面板是新增的，单独点开验一下排版
    { view: 'picker-more', open: "document.getElementById('moreBtn').click()",
      verify: "document.getElementById('pickerTitle').textContent" },
    { view: 'chat-back', open: "document.getElementById('pickerClose').click()" }
  ]
};

async function probeWindow(windows, kind) {
  const w = windows.get(kind);
  if (!w) return { error: '窗口不存在' };
  try {
    const raw = await w.webContents.executeJavaScript(PROBE, true);
    return JSON.parse(raw);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/** 在窗口里跑一小段表达式并把结果取回来（给接线校验用） */
async function evalIn(windows, kind, script) {
  const w = windows.get(kind);
  if (!w) return null;
  try {
    const r = await w.webContents.executeJavaScript('(() => { try { return String(' + script + '); } catch (e) { return "ERR:" + e.message; } })()', true);
    return r;
  } catch (e) {
    return 'ERR:' + String((e && e.message) || e);
  }
}

async function click(windows, kind, script) {
  const w = windows.get(kind);
  if (!script) return '';
  if (!w) return '窗口不存在';
  try { await w.webContents.executeJavaScript('(function(){' + script + ';return true;})()', true); } catch (e) { return String(e.message || e); }
  await new Promise((r) => setTimeout(r, 260));
  return '';
}

/** 需要的共享脚本：桌宠/面板要逻辑层，其它窗口自带 */
const NEEDS_LOGIC = { pet: true, panel: true };

/**
 * @param {object} ctx { windows, services, log, setMode }
 */
async function runAudit(ctx) {
  const { windows, services, log, setMode } = ctx;
  const themeCount = 6;
  const report = { at: new Date().toISOString(), themes: themeCount, windows: {}, themeSweep: [], problems: [] };
  const previewDir = process.env.NAILONG_AUDIT_PREVIEWS;
  async function capture(kind, label) {
    if (!previewDir) return;
    const w = windows.get(kind);
    if (!w) return;
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(path.join(previewDir, label + '.png'), (await w.webContents.capturePage()).toPNG());
  }

  const kinds = ['pet', 'panel', 'assistant', 'tool', 'menu', 'settings'];
  for (const kind of kinds) {
    windows.show(kind, { focus: false });
    await new Promise((r) => setTimeout(r, 420));
    report.windows[kind] = await probeWindow(windows, kind);
    await capture(kind, 'window-' + kind);

    // 把隐藏的分页/标签一个个点开看
    const sweep = VIEW_SWEEP[kind];
    if (sweep) {
      report.views = report.views || {};
      report.views[kind] = [];
      for (const step of sweep) {
        const openError = await click(windows, kind, step.open);
        if (step.view === 'focus-start') await evalIn(windows, kind, "(window.__auditStartTime = document.getElementById('pomoTime').textContent)");
        if (step.wait) await new Promise(r => setTimeout(r, step.wait));
        const p = await probeWindow(windows, kind);
        const row = {
          view: step.view,
          error: openError || p.error || '',
          theme: p.theme,
          overflow: p.overflow,
          offenders: (p.offenders || []).map((o) => o.el)
        };
        // 接线校验：点完之后该出现的字样有没有出现
        if (step.verify) {
          row.verify = await evalIn(windows, kind, step.verify);
          row.expect = step.expect === undefined ? null : step.expect;
          row.wired = !String(row.verify).startsWith('ERR:') && (step.expect === undefined ? (row.verify !== '' && row.verify != null) : (String(row.verify).indexOf(step.expect) >= 0));
        }
        report.views[kind].push(row);
      }
    }
    windows.hide(kind);
  }

  // 注意：settings 窗口 hide 之后不再需要，其余窗口由用户自己开合
  windows.show('pet', { focus: false });

  // 六个窗口分别检查六套主题；分页操作另列，避免虚构笛卡尔积覆盖。
  report.themeWindows = [];
  for (let t = 0; t < themeCount; t++) {
    services.settings.setKey('theme', t);
    windows.broadcast('theme-changed', t);
    await new Promise((r) => setTimeout(r, 260));
    windows.show('panel', { focus: false });
    await new Promise((r) => setTimeout(r, 260));
    const panel = await probeWindow(windows, 'panel');
    const pet = await probeWindow(windows, 'pet');
    report.themeSweep.push({
      theme: t,
      panelTheme: panel.theme,
      petTheme: pet.theme,
      panelAccent: panel.tokens && panel.tokens.accent,
      petAccent: pet.tokens && pet.tokens.accent,
      panelCard: panel.card && panel.card.radius,
      panelOverflow: panel.overflow,
      panelOffenders: (panel.offenders || []).length,
      petOffenders: (pet.offenders || []).length
    });
    await capture('panel', 'theme-' + t + '-panel');
    await capture('pet', 'theme-' + t + '-pet');
    windows.hide('panel');
    for (const kind of kinds) {
      windows.show(kind, { focus: false });
      await new Promise(r => setTimeout(r, 180));
      const sample = await probeWindow(windows, kind);
      report.themeWindows.push({ kind, theme: t, sample });
      await capture(kind, 'theme-' + t + '-' + kind);
      windows.hide(kind);
    }
  }
  services.settings.setKey('theme', 0);
  windows.broadcast('theme-changed', 0);

  report.localeWindows = [];
  for (const kind of kinds) {
    windows.show(kind, { focus: false });
    await click(windows, kind, "if (window.WidgetI18n) { WidgetI18n.setLocale('en'); WidgetI18n.applyDom(); }");
    report.localeWindows.push({ kind, locale: 'en', sample: await probeWindow(windows, kind) });
    await capture(kind, 'english-' + kind);
    await click(windows, kind, "if (window.WidgetI18n) { WidgetI18n.setLocale('zh-CN'); WidgetI18n.applyDom(); }");
    windows.hide(kind);
  }
  windows.show('pet', { focus: false });

  // 形态切换也要能跑通
  const modes = ['normal', 'assistant', 'focus', 'countdown', 'alarm', 'coin', 'catch'];
  report.modes = [];
  for (const m of modes) {
    try {
      setMode(m);
      await new Promise((r) => setTimeout(r, 320));
      const actual = await evalIn(windows, 'pet', 'state.mode');
      report.modes.push({ mode: m, actual, ok: actual === m });
      await capture('pet', 'mode-' + m);
    } catch (e) {
      report.modes.push({ mode: m, ok: false, error: String((e && e.message) || e) });
    }
  }
  // 抓奶蛙必须验证“点击→主进程结束游戏→胜利提示”，只切形态不能证明能抓到。
  try {
    const pet = windows.get('pet');
    await new Promise(r => setTimeout(r, 900));
    pet.show(); pet.focus();
    pet.webContents.sendInputEvent({ type: 'mouseDown', x: 95, y: 178, button: 'left', clickCount: 1 });
    pet.webContents.sendInputEvent({ type: 'mouseUp', x: 95, y: 178, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 180));
    const caught = await evalIn(windows, 'pet', "!state.catchOn && state.mode === 'normal' && !!state.ping && state.ping.text.includes('🎉') && $('bubble').classList.contains('show') && $('bubble').textContent.includes('🎉')");
    report.catchGame = { ok: caught === 'true', actual: caught };
    if (!report.catchGame.ok) report.problems.push('抓奶蛙：点击角色后未结束游戏并显示成功');
    await capture('pet', 'catch-win');
  } catch (e) {
    report.catchGame = { ok: false, error: e.message };
    report.problems.push('抓奶蛙实际点击失败：' + e.message);
  }
  setMode('normal');

  // 汇总问题
  Object.keys(report.windows).forEach((k) => {
    const w = report.windows[k];
    if (w.error) { report.problems.push(k + '：探针失败 ' + w.error); return; }
    if (w.overflow.x > 2 || w.overflow.y > 2) {
      report.problems.push(k + '：内容溢出窗口（x+' + w.overflow.x + ' y+' + w.overflow.y + '）');
    }
    if ((w.offenders || []).length) {
      report.problems.push(k + '：有 ' + w.offenders.length + ' 个元素越界（' + w.offenders.map((o) => o.el).join(', ') + '）');
    }
    if (!w.widgetApi) report.problems.push(k + '：preload 桥没注入');
    if (w.unstyledInputs && w.unstyledInputs.length) report.problems.push(k + '：输入控件未套用样式：' + w.unstyledInputs.join(', '));
    if (w.overlaps && w.overlaps.length) report.problems.push(k + '：说明与状态栏重叠');
    if (NEEDS_LOGIC[k] && !w.logic) report.problems.push(k + '：WidgetLogic 没加载');
    if (w.card && (w.card.bg === 'none' || !w.tokens.fg)) report.problems.push(k + '：主题背景或文字颜色缺失');
    if (w.card && w.card.radius === '0px') report.problems.push(k + '：卡片圆角丢了');
  });
  Object.keys(report.windows).forEach((k) => {
    const w = report.windows[k];
    if (w.i18n && w.i18n.tags > 0 && !w.i18n.dictLoaded) {
      report.problems.push(k + '：页面用了 data-i18n，但 i18n.js 没加载');
    }
    if (w.i18n && w.i18n.untranslated > 0) {
      report.problems.push(k + '：有 ' + w.i18n.untranslated + ' 个 data-i18n 元素没被翻译（字典里缺 key）');
    }
  });
  Object.keys(report.views || {}).forEach((kind) => {
    report.views[kind].forEach((v) => {
      if (v.error) report.problems.push(kind + ' 的「' + v.view + '」操作/探针失败：' + v.error);
      if (v.overflow && (v.overflow.x > 2 || v.overflow.y > 2)) {
        report.problems.push(kind + ' 的「' + v.view + '」视图内容溢出（x+' + v.overflow.x + ' y+' + v.overflow.y + '）');
      }
      if (v.wired === false) {
        report.problems.push(kind + ' 的「' + v.view + '」点了没反应：期望出现「' + v.expect + '」，实际是「' + String(v.verify).slice(0, 80) + '」');
      }
      if (v.offenders && v.offenders.length) {
        report.problems.push(kind + ' 的「' + v.view + '」视图有元素越界：' + v.offenders.slice(0, 5).join(', '));
      }
    });
  });
  report.themeSweep.forEach((t) => {
    if (t.panelTheme !== 't' + t.theme) report.problems.push('主题 ' + t.theme + ' 没切到面板（' + t.panelTheme + '）');
    if (t.petTheme !== 't' + t.theme) report.problems.push('主题 ' + t.theme + ' 没切到桌宠（' + t.petTheme + '）');
  });
  report.modes.forEach((m) => { if (!m.ok) report.problems.push('形态 ' + m.mode + ' 切换失败：' + m.error); });
  [...report.themeWindows, ...report.localeWindows].forEach(({ kind, theme, locale, sample: w }) => {
    const label = kind + ' ' + (locale || ('主题 ' + theme));
    if (w.error) { report.problems.push(label + '：' + w.error); return; }
    if (theme !== undefined && w.theme !== 't' + theme) report.problems.push(label + '：主题未切换');
    if (w.overflow.x > 2 || w.overflow.y > 2 || w.offenders.length) report.problems.push(label + '：内容溢出或被裁切');
    if (w.unstyledInputs.length) report.problems.push(label + '：输入控件未套用样式');
    if (w.overlaps.length) report.problems.push(label + '：说明与状态栏重叠');
    if (!w.widgetApi || w.i18n.untranslated) report.problems.push(label + '：preload 或翻译接线缺失');
  });
  report.rendererErrors = windows.auditErrors || [];
  report.rendererErrors.forEach(error => report.problems.push('渲染器错误：' + error));

  const out = path.join(P.cache, 'audit.json');
  try {
    fs.mkdirSync(P.cache, { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  } catch (e) {
    log.error('[audit] 写文件失败：' + e.message);
  }
  log.info('[audit] 报告：' + out + '，问题 ' + report.problems.length + ' 条');
  report.problems.forEach((p) => log.warn('[audit] ' + p));
  return report;
}

module.exports = { runAudit, PROBE, VIEW_SWEEP };
