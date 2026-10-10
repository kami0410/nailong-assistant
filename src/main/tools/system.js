'use strict';
/* 系统类工具：命令、剪贴板、音量亮度、进程、通知、抓网页 */

function def(o) {
  return {
    name: o.name, group: o.group || '系统', level: o.level || 'mid',
    description: o.description, parameters: o.parameters || { type: 'object', properties: {} },
    describe: o.describe || (() => o.name), preview: o.preview, run: o.run
  };
}

/** 极简 HTML → 文本（够用就行：去脚本样式、块级标签转换行、解实体、压空白） */
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '- ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)));
  s = s.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter((l) => l !== '').join('\n');
  return s.replace(/\n{3,}/g, '\n\n');
}

function createSystemTools(host) {
  return [
    def({
      name: 'run_command',
      level: 'high',
      description: '在 PowerShell 里执行一条命令并返回输出。适合做批量文件处理、查系统信息、跑脚本这类图形界面做不了或很啰嗦的事。\n'
        + '注意：默认工作目录是用户主目录；不要用它做危险操作（删除、改注册表、装软件都会被拦）。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'PowerShell 命令' },
          cwd: { type: 'string', description: '可选工作目录' },
          timeout_ms: { type: 'integer', description: '超时毫秒，默认 30000，最大 300000' }
        },
        required: ['command']
      },
      describe: (a) => '执行命令：' + String((a && a.command) || '').slice(0, 100),
      preview: (a) => '将在 PowerShell 中执行：\n\n  ' + ((a && a.command) || '') + '\n\n工作目录：' + ((a && a.cwd) || host.paths.home),
      async run(args) {
        const a = args || {};
        const cmd = String(a.command || '').trim();
        if (!cmd) throw new Error('命令不能为空');
        const timeout = Math.max(1000, Math.min(300000, Number(a.timeout_ms) || 30000));
        const r = await host.runCommand(cmd, a.cwd ? String(a.cwd) : host.paths.home, timeout);
        const out = [];
        if (r.stdout) out.push(r.stdout.trim().slice(0, 8000));
        if (r.stderr) out.push('[stderr]\n' + r.stderr.trim().slice(0, 2000));
        if (r.timedOut) out.push('（命令超时被终止）');
        return { ok: r.code === 0, text: '退出码 ' + r.code + '\n' + (out.join('\n') || '（没有输出）') };
      }
    }),

    def({
      name: 'clipboard_get',
      level: 'low',
      description: '读取剪贴板当前内容（文字）',
      parameters: { type: 'object', properties: {} },
      describe: () => '读取剪贴板',
      async run() {
        const t = host.clipboard.read();
        return { ok: true, text: t ? '剪贴板内容：\n' + String(t).slice(0, 4000) : '剪贴板是空的（或者里面不是文字）' };
      }
    }),

    def({
      name: 'clipboard_set',
      level: 'mid',
      description: '把文字写进剪贴板',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      describe: (a) => '写入剪贴板（' + String((a && a.text) || '').length + ' 字）',
      preview: (a) => '写入剪贴板：\n' + String((a && a.text) || '').slice(0, 400),
      async run(args) {
        host.clipboard.write(String((args || {}).text || ''));
        return { ok: true, text: '已写入剪贴板' };
      }
    }),

    def({
      name: 'clipboard_history',
      level: 'low',
      description: '翻剪贴板历史（奶蛙会自动记录你复制过的内容），可以按关键词找「我刚才复制的那个东西」。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，可不填' },
          limit: { type: 'integer', description: '默认 10' }
        }
      },
      describe: (a) => '查剪贴板历史' + (a && a.query ? '（' + a.query + '）' : ''),
      async run(args) {
        const a = args || {};
        const items = host.services.clipboard.history(a.query || '', Math.min(50, Number(a.limit) || 10));
        if (!items.length) return { ok: true, text: '剪贴板历史里没有匹配的内容' };
        return { ok: true, text: items.map((x, i) => (i + 1) + '. [' + new Date(x.at).toLocaleString('zh-CN') + '] ' + String(x.text).slice(0, 160)).join('\n') };
      }
    }),

    def({
      name: 'system_info',
      level: 'low',
      description: '系统概况：Windows 版本、CPU、内存、各盘剩余空间、电池、开机时长。想知道机器状态时用。',
      parameters: { type: 'object', properties: {} },
      describe: () => '查看系统概况',
      async run() {
        const i = await host.systemInfo();
        const lines = [
          i.os + ' (' + i.arch + ', ' + i.version + ')',
          '机器：' + i.host + ' / 用户 ' + i.user,
          'CPU：' + i.cpu + '（' + i.cores + ' 线程）',
          '内存：' + i.ramFreeGB + ' GB 可用 / ' + i.ramTotalGB + ' GB',
          '开机：' + i.uptimeHours + ' 小时',
          i.disks && i.disks.length ? '磁盘：' + i.disks.map((d) => d.drive + ' ' + d.freeGB + '/' + d.totalGB + ' GB').join('，') : '',
          i.battery ? '电池：' + i.battery.percent + '%' + (i.battery.charging ? '（充电中）' : '') : ''
        ].filter(Boolean);
        return { ok: true, text: lines.join('\n') };
      }
    }),

    def({
      name: 'list_processes',
      level: 'low',
      description: '列出占用最高的进程（看谁在吃 CPU 或内存）',
      parameters: {
        type: 'object',
        properties: {
          sort: { type: 'string', enum: ['cpu', 'mem'], description: '默认 mem' },
          limit: { type: 'integer', description: '默认 15' }
        }
      },
      describe: (a) => '查看占用最高的进程（' + ((a && a.sort) || 'mem') + '）',
      async run(args) {
        const a = args || {};
        const r = await host.windowControl('procs', { Sort: a.sort === 'cpu' ? 'cpu' : 'mem', Top: Math.max(1, Math.min(60, Number(a.limit) || 15)) });
        const list = r.processes || [];
        return { ok: true, text: list.map((p) => (p.pid + '\t' + p.name + '\t' + p.memMB + 'MB\t' + (p.title || '').slice(0, 40)).trimEnd()).join('\n') };
      }
    }),

    def({
      name: 'set_volume',
      level: 'mid',
      description: '调节系统音量：direction=up/down/mute。每次一格约 2%。',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'mute'] },
          steps: { type: 'integer', description: '按几次，默认 5' }
        },
        required: ['direction']
      },
      describe: (a) => '音量' + ((a && a.direction) === 'up' ? '调大' : (a && a.direction) === 'down' ? '调小' : '静音'),
      async run(args) {
        const a = args || {};
        const dir = ['up', 'down', 'mute'].indexOf(a.direction) >= 0 ? a.direction : 'up';
        await host.windowControl('volume', { Dir: dir, Steps: Math.max(1, Math.min(50, Number(a.steps) || 5)) });
        return { ok: true, text: '音量已' + (dir === 'up' ? '调大' : dir === 'down' ? '调小' : '切换静音') };
      }
    }),

    def({
      name: 'set_brightness',
      level: 'mid',
      description: '设置屏幕亮度（0~100）。只对支持 WMI 亮度控制的屏幕有效（多数笔记本可以，外接显示器通常不行）。',
      parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
      describe: (a) => '亮度设为 ' + (a && a.value),
      async run(args) {
        const v = Math.max(0, Math.min(100, Number((args || {}).value) || 50));
        const r = await host.windowControl('brightness', { Value: v });
        return { ok: true, text: '亮度已设为 ' + (r.brightness === undefined ? v : r.brightness) };
      }
    }),

    def({
      name: 'lock_screen',
      level: 'high',
      description: '锁定屏幕（Win+L 的效果）',
      parameters: { type: 'object', properties: {} },
      describe: () => '锁定屏幕',
      async run() {
        await host.windowControl('lock', {});
        return { ok: true, text: '已锁屏' };
      }
    }),

    def({
      name: 'notify_user',
      level: 'low',
      description: '给用户弹一条系统通知（适合「任务跑完了」这种需要用户知晓但不必打断的汇报）。',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' } },
        required: ['title']
      },
      describe: (a) => '发通知「' + (a && a.title) + '」',
      async run(args) {
        const a = args || {};
        host.services.notify.show(String(a.title || '奶蛙助手'), String(a.body || ''));
        return { ok: true, text: '已发送通知' };
      }
    }),

    def({
      name: 'web_fetch',
      level: 'low',
      description: '抓取一个网页并转成纯文本（去掉脚本样式）。适合让 AI 读一篇新闻/文档/接口返回，比截图看网页准确得多。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          max_chars: { type: 'integer', description: '最多返回多少字符，默认 6000' }
        },
        required: ['url']
      },
      describe: (a) => '抓取网页 ' + (a && a.url),
      async run(args) {
        const a = args || {};
        const url = String(a.url || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('url 必须以 http:// 或 https:// 开头');
        const maxChars = Math.max(500, Math.min(30000, Number(a.max_chars) || 6000));
        const fetchImpl = host.fetchImpl || globalThis.fetch;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        let res;
        try {
          res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NailongAssistant/3.0' } });
        } finally { clearTimeout(timer); }
        if (!res.ok) throw new Error('抓取失败，HTTP ' + res.status);
        const ctype = res.headers.get('content-type') || '';
        const raw = await res.text();
        const text = /json|text\/plain/.test(ctype) ? raw : htmlToText(raw);
        const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw) || [])[1];
        return {
          ok: true,
          text: (title ? '《' + htmlToText(title).trim() + '》\n' : '') + text.slice(0, maxChars)
            + (text.length > maxChars ? '\n…（全文 ' + text.length + ' 字，已截断）' : '')
        };
      }
    })
  ];
}

module.exports = { createSystemTools, htmlToText };
