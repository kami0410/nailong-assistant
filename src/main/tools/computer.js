'use strict';
/* 计算机操作类工具：看屏幕 / 无障碍元素树 / 鼠标键盘 / 窗口 */

function def(o) {
  return {
    name: o.name,
    group: o.group || '电脑操作',
    level: o.level || 'mid',
    description: o.description,
    parameters: o.parameters || { type: 'object', properties: {} },
    describe: o.describe || (() => o.name),
    preview: o.preview,
    run: o.run
  };
}

function num(v, dflt) {
  const n = Number(v);
  return isNaN(n) ? dflt : n;
}

function createComputerTools(host) {
  /** 把「截图坐标系」的坐标换算成物理屏幕坐标 */
  function toPhysical(x, y) {
    const s = host.lastShot && host.lastShot();
    if (!s || !s.sentW) return { x: Math.round(num(x, 0)), y: Math.round(num(y, 0)) };
    const kx = s.scaleX || s.physW / s.sentW;
    const ky = s.scaleY || (s.sentH ? s.physH / s.sentH : kx);
    return {
      x: Math.round((s.originX || 0) + (s.cropX || 0) + num(x, 0) * kx),
      y: Math.round((s.originY || 0) + (s.cropY || 0) + num(y, 0) * ky)
    };
  }

  return [
    def({
      name: 'screenshot',
      level: 'low',
      description: '截取屏幕画面给你看。需要确认某个操作的结果、或要判断视觉布局（颜色、图标、图片）时调用。\n返回的像素尺寸就是坐标系的尺寸；左上角是 (0,0)。',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'string', description: '可选，只截一块区域，格式 "x,y,w,h"（截图坐标系）' },
          monitor: { type: 'string', description: '可选，哪个显示器："cursor"（默认，鼠标所在）或 "primary" 或 "2"（第几个，从 1 开始）' }
        }
      },
      describe: (a) => '看屏幕' + (a && a.monitor && a.monitor !== 'cursor' ? '（' + a.monitor + '）' : ''),
      async run(args) {
        const a = args || {};
        const shot = await host.screenshot({ region: a.region, monitor: a.monitor });
        const k = (shot.physW / Math.max(1, shot.sentW)).toFixed(3);
        return {
          ok: true,
          text: '截图成功' + (a.monitor && a.monitor !== 'cursor' ? '（显示器 ' + a.monitor + '）' : '') + '。截图尺寸 ' + shot.sentW + 'x' + shot.sentH
            + '，实际屏幕 ' + shot.physW + 'x' + shot.physH
            + '。你看到的坐标直接用，程序会自己换算（系数 ' + k + '）。',
          images: [shot.dataUrl]
        };
      }
    }),

    def({
      name: 'view_image',
      level: 'low',
      description: '读取本地图片文件（用户说「看下这张图」「这张截图里是什么」时用）。支持 png / jpg / gif / bmp / webp / ico。\n比先 launch 打开图片再 screenshot 准得多，也不会把别的窗口拍进来。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '图片文件的绝对路径' },
          max_side: { type: 'integer', description: '可选，最长边缩到多少像素，默认 1400（越大越费 token）' }
        },
        required: ['path']
      },
      describe: (a) => '看图片 ' + String((a && a.path) || '').split(/[\\/]/).pop(),
      async run(args) {
        const a = args || {};
        const p = String(a.path || '').trim();
        if (!p) throw new Error('path 不能为空');
        if (!/\.(png|jpe?g|gif|bmp|webp|ico)$/i.test(p)) {
          throw new Error('这看起来不是图片文件：' + p + '（支持 png/jpg/gif/bmp/webp/ico）');
        }
        const r = host.readImageFile(p, a.max_side);
        if (!r || !r.ok) throw new Error((r && r.error) || '读不到这张图');
        return {
          ok: true,
          text: '图片已读取：' + r.width + 'x' + r.height + (r.scaled ? '（原图已按长边缩放）' : '') + '，' + Math.round(r.bytes / 1024) + ' KB',
          images: [r.dataUrl]
        };
      }
    }),

    def({
      name: 'ui_tree',
      level: 'low',
      description: '读取当前窗口（或指定窗口）的界面元素树：每个元素有 id、类型(role)、名称(name)、状态和位置。\n这是最准的定位方式——看到想点的元素后，直接调 click_element 传它的 id，不用猜坐标。优先用它而不是截图猜位置。',
      parameters: {
        type: 'object',
        properties: {
          depth: { type: 'integer', description: '递归深度，默认 8，越大越慢。3~5 适合快速看结构' },
          limit: { type: 'integer', description: '最多返回多少个元素，默认 260' },
          window_title: { type: 'string', description: '可选，指定窗口标题关键字；不填则用当前前台窗口' }
        }
      },
      describe: (a) => '读取界面元素树' + (a && a.window_title ? '（' + a.window_title + '）' : ''),
      async run(args) {
        const a = args || {};
        const tree = await host.uiTree({
          depth: Math.max(1, Math.min(12, num(a.depth, 8))),
          limit: Math.max(20, Math.min(600, num(a.limit, 260))),
          windowTitle: a.window_title || ''
        });
        const lines = renderTree(tree.nodes);
        return {
          ok: true,
          text: '窗口「' + (tree.window || '未知') + '」共 ' + tree.count + ' 个元素（已按重要性精简）：\n' + lines
        };
      }
    }),

    def({
      name: 'find_element',
      level: 'low',
      description: '按可见文字在当前窗口里查找元素，返回它的 id 和位置。适合「找到写着"发送"的按钮」这类需求。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要查找的文字（精确或忽略大小写匹配）' },
          window_title: { type: 'string', description: '可选，限定窗口标题关键字' }
        },
        required: ['text']
      },
      describe: (a) => '查找元素「' + (a && a.text) + '」',
      async run(args) {
        const hits = await host.findElement({ text: String((args && args.text) || ''), windowTitle: (args && args.window_title) || '' });
        if (!hits.length) return { ok: true, text: '没找到包含「' + (args && args.text) + '」的元素。可以改用 ui_tree 看整棵树，或截图后用坐标点击。' };
        return { ok: true, text: '找到 ' + hits.length + ' 个：\n' + hits.map((h) => '  ' + h.id + ' [' + h.role + '] "' + h.name + '" @(' + (h.x + h.w / 2) + ',' + (h.y + h.h / 2) + ')').join('\n') };
      }
    }),

    def({
      name: 'click_element',
      level: 'mid',
      description: '点击界面元素树里的某个元素（用 ui_tree 或 find_element 拿到的 id）。\n优先用这个，比猜坐标可靠得多。程序会先尝试无障碍调用，不行再点它的中心。',
      parameters: {
        type: 'object',
        properties: { element_id: { type: 'string', description: '元素 id，例如 e37' } },
        required: ['element_id']
      },
      describe: (a) => '点击元素 ' + (a && a.element_id),
      async run(args) {
        const id = String((args && args.element_id) || '').trim();
        if (!/^e\d+$/.test(id)) throw new Error('element_id 格式不对，应该是 ui_tree 返回的 e 加数字');
        const r = await host.elementAction('invoke', id);
        if (r && r.invoked) {
          await host.pause(500);
          return { ok: true, text: '已通过无障碍接口触发「' + (r.name || id) + '」' };
        }
        if (r && r.clickable) {
          host.input('click ' + r.x + ' ' + r.y);
          await host.pause(600);
          return { ok: true, text: '元素「' + (r.name || id) + '」不支持无障碍触发，已改为点击它的中心 (' + r.x + ',' + r.y + ')' };
        }
        return { ok: false, text: '这个元素没法点击：' + JSON.stringify(r) };
      }
    }),

    def({
      name: 'set_element_text',
      level: 'mid',
      description: '把一个输入框里的内容替换成指定文本（用 ui_tree 拿到的 id）。比「点进去再全选删除再输入」可靠。',
      parameters: {
        type: 'object',
        properties: {
          element_id: { type: 'string' },
          text: { type: 'string' }
        },
        required: ['element_id', 'text']
      },
      describe: (a) => '设置元素 ' + (a && a.element_id) + ' 的内容',
      async run(args) {
        const a = args || {};
        const r = await host.elementAction('setvalue', String(a.element_id || ''), String(a.text || ''));
        await host.pause(300);
        return { ok: true, text: '已设置「' + (r.name || a.element_id) + '」的值为：' + a.text };
      }
    }),

    def({
      name: 'click',
      level: 'mid',
      description: '在截图坐标 (x,y) 处单击左键。坐标必须是最近一次截图里的像素坐标。能用 click_element 时优先用元素。',
      parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
      describe: (a) => '点击 (' + a.x + ', ' + a.y + ')',
      async run(args) {
        const p = toPhysical(args.x, args.y);
        host.input('click ' + p.x + ' ' + p.y);
        await host.pause(600);
        return { ok: true, text: '已点击 (' + p.x + ',' + p.y + ')，下面是结果截图', images: await host.afterShot() };
      }
    }),

    def({
      name: 'dblclick',
      level: 'mid',
      description: '在截图坐标 (x,y) 处双击左键',
      parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
      describe: (a) => '双击 (' + a.x + ', ' + a.y + ')',
      async run(args) {
        const p = toPhysical(args.x, args.y);
        host.input('dblclick ' + p.x + ' ' + p.y);
        await host.pause(700);
        return { ok: true, text: '已双击 (' + p.x + ',' + p.y + ')', images: await host.afterShot() };
      }
    }),

    def({
      name: 'rightclick',
      level: 'mid',
      description: '在截图坐标 (x,y) 处单击右键（打开上下文菜单）',
      parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
      describe: (a) => '右键 (' + a.x + ', ' + a.y + ')',
      async run(args) {
        const p = toPhysical(args.x, args.y);
        host.input('rightclick ' + p.x + ' ' + p.y);
        await host.pause(600);
        return { ok: true, text: '已右键 (' + p.x + ',' + p.y + ')', images: await host.afterShot() };
      }
    }),

    def({
      name: 'move_mouse',
      level: 'mid',
      description: '把鼠标移动到截图坐标 (x,y)（不点击，用于触发悬停提示）',
      parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
      describe: (a) => '移动鼠标到 (' + a.x + ', ' + a.y + ')',
      async run(args) {
        const p = toPhysical(args.x, args.y);
        host.input('move ' + p.x + ' ' + p.y);
        await host.pause(300);
        return { ok: true, text: '鼠标已移到 (' + p.x + ',' + p.y + ')' };
      }
    }),

    def({
      name: 'drag',
      level: 'mid',
      description: '按住左键从 (from_x,from_y) 拖到 (to_x,to_y)，用于拖拽文件、调整顺序、框选。坐标同截图坐标系。',
      parameters: {
        type: 'object',
        properties: {
          from_x: { type: 'integer' }, from_y: { type: 'integer' },
          to_x: { type: 'integer' }, to_y: { type: 'integer' }
        },
        required: ['from_x', 'from_y', 'to_x', 'to_y']
      },
      describe: (a) => '拖拽 (' + a.from_x + ',' + a.from_y + ') → (' + a.to_x + ',' + a.to_y + ')',
      async run(args) {
        const a = args || {};
        const f = toPhysical(a.from_x, a.from_y);
        const t = toPhysical(a.to_x, a.to_y);
        host.input('drag ' + f.x + ' ' + f.y + ' ' + t.x + ' ' + t.y);
        await host.pause(1000);
        return { ok: true, text: '已拖拽到 (' + t.x + ',' + t.y + ')', images: await host.afterShot() };
      }
    }),

    def({
      name: 'type_text',
      level: 'mid',
      description: '向当前焦点输入文字（中文、emoji 都行，内部走剪贴板粘贴）。先用 click/click_element 把光标放到目标位置。',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      describe: (a) => '输入「' + String((a && a.text) || '').slice(0, 40) + '」',
      preview: (a) => '将要输入的内容：\n' + String((a && a.text) || ''),
      async run(args) {
        const text = String((args && args.text) || '');
        host.input('type ' + host.b64utf8(text));
        await host.pause(500);
        return { ok: true, text: '已输入 ' + text.length + ' 个字符' };
      }
    }),

    def({
      name: 'press_key',
      level: 'mid',
      description: '按键或组合键。例：enter、esc、tab、backspace、ctrl+s、ctrl+shift+t、alt+f4、win+r、shift+方向键。'
        + '也支持多媒体键：volumeup、volumedown、volumemute、playpause、nexttrack、prevtrack。',
      parameters: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] },
      describe: (a) => '按键 ' + (a && a.keys),
      async run(args) {
        const k = String((args && args.keys) || '').trim();
        if (!k) throw new Error('keys 不能为空');
        host.input('key ' + k);
        await host.pause(500);
        return { ok: true, text: '已按键 ' + k, images: await host.afterShot() };
      }
    }),

    def({
      name: 'scroll',
      level: 'mid',
      description: '滚动鼠标滚轮。dy 正数向下、负数向上，一格是 1（一般 3~5 格够用）。',
      parameters: { type: 'object', properties: { dy: { type: 'integer' } }, required: ['dy'] },
      describe: (a) => '滚动 ' + (a && a.dy),
      async run(args) {
        const dy = Math.max(-30, Math.min(30, num((args || {}).dy, 3)));
        host.input('scroll ' + dy);
        await host.pause(500);
        return { ok: true, text: '已滚动 ' + dy + ' 格', images: await host.afterShot() };
      }
    }),

    def({
      name: 'wait',
      level: 'low',
      description: '等一会儿（毫秒），用在启动程序、加载页面之后。最多 10 秒。',
      parameters: { type: 'object', properties: { ms: { type: 'integer' } }, required: ['ms'] },
      describe: (a) => '等待 ' + (a && a.ms) + 'ms',
      async run(args) {
        const ms = Math.max(100, Math.min(10000, num((args || {}).ms, 1000)));
        await host.pause(ms);
        return { ok: true, text: '已等待 ' + ms + ' 毫秒' };
      }
    }),

    def({
      name: 'launch',
      level: 'mid',
      description: '启动程序或打开网址/文件/文件夹。例：notepad、explorer、calc、https://www.baidu.com、D:\\\\报表.xlsx',
      parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
      describe: (a) => '打开 ' + (a && a.target),
      async run(args) {
        const t = String((args || {}).target || '').trim();
        if (!t) throw new Error('target 不能为空');
        await host.launch(t);
        await host.pause(1200);
        return { ok: true, text: '已打开 ' + t, images: await host.afterShot() };
      }
    }),

    def({
      name: 'screen_info',
      level: 'low',
      description: '查看屏幕与窗口的当前状况：分辨率、缩放、鼠标位置、所有可见窗口（标题/位置/是否最小化）、前台窗口。开始一个任务前先调它，能省掉一次截图。',
      parameters: { type: 'object', properties: {} },
      describe: () => '查看屏幕与窗口状况',
      async run() {
        const info = await host.screenInfo();
        const lines = [];
        lines.push('显示器：' + (info.screens || []).map((s) => s.w + 'x' + s.h + (s.primary ? '(主)' : '')).join('  '));
        lines.push('缩放：' + info.scale + 'x，鼠标：(' + info.cursor.x + ',' + info.cursor.y + ')');
        lines.push('前台窗口：' + (info.foreground ? info.foreground.title + ' (pid ' + info.foreground.pid + ')' : '无'));
        lines.push('可见窗口 ' + info.windows.length + ' 个：');
        info.windows.slice(0, 25).forEach((w) => {
          lines.push('  - ' + (w.minimized ? '[最小化] ' : '') + w.title.slice(0, 60) + ' @' + w.x + ',' + w.y + ' ' + w.w + 'x' + w.h + ' (pid ' + w.pid + ')');
        });
        return { ok: true, text: lines.join('\n') };
      }
    }),

    def({
      name: 'focus_window',
      level: 'mid',
      description: '把某个窗口切到前台（按标题关键字匹配）。操作某个程序前先用它激活。',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      describe: (a) => '切到窗口「' + (a && a.title) + '」',
      async run(args) {
        const r = await host.windowControl('win-focus', { B64: host.b64utf8(String((args || {}).title || '')) });
        await host.pause(700);
        return { ok: true, text: '已切换到「' + (r.title || (args || {}).title) + '」', images: await host.afterShot() };
      }
    }),

    def({
      name: 'window_action',
      level: 'mid',
      description: '控制窗口：minimize 最小化、maximize 最大化、restore 还原、close 关闭、topmost 置顶/取消置顶、move 移动缩放。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '窗口标题关键字' },
          action: { type: 'string', enum: ['minimize', 'maximize', 'restore', 'close', 'topmost', 'move'] },
          topmost: { type: 'boolean', description: 'action=topmost 时用' },
          x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' }
        },
        required: ['title', 'action']
      },
      describe: (a) => '窗口「' + (a && a.title) + '」执行 ' + (a && a.action),
      async run(args) {
        const a = args || {};
        const map = { minimize: 'win-minimize', maximize: 'win-maximize', restore: 'win-restore', close: 'win-close', topmost: 'win-topmost', move: 'win-move' };
        const act = map[a.action];
        if (!act) throw new Error('不支持的窗口动作：' + a.action);
        const params = { B64: host.b64utf8(String(a.title || '')) };
        if (a.action === 'topmost') params.On = a.topmost === false ? 0 : 1;
        if (a.action === 'move') { params.X = num(a.x, 0); params.Y = num(a.y, 0); params.W = num(a.w, 800); params.H = num(a.h, 600); }
        const r = await host.windowControl(act, params);
        await host.pause(600);
        return { ok: true, text: '已执行：' + JSON.stringify(r), images: await host.afterShot() };
      }
    })
  ];
}

/** 把元素树渲染成给模型看的紧凑文本 */
function renderTree(nodes) {
  return (nodes || []).map((n) => {
    const pad = '  '.repeat(Math.min(6, n.d));
    const bits = [n.id, '[' + n.role + ']'];
    if (n.name) bits.push('"' + String(n.name).replace(/\s+/g, ' ').slice(0, 70) + '"');
    if (n.value) bits.push('值="' + String(n.value).slice(0, 40) + '"');
    if (n.aid) bits.push('#' + n.aid);
    if (!n.on) bits.push('(禁用)');
    if (n.off) bits.push('(不可见)');
    if (n.w > 0 && n.h > 0) bits.push('@' + n.x + ',' + n.y + ' ' + n.w + 'x' + n.h);
    return pad + bits.join(' ');
  }).join('\n');
}

module.exports = { createComputerTools, renderTree };
