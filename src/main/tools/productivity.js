'use strict';
/* 生产力类工具：把奶蛙自己的日程/倒数日/专注/记忆暴露给模型。
 * 这是「AI 助手 + 桌面待办」融合的关键：模型可以直接帮用户排日程，而不是只会在记事本里打字。 */

const L = require('../../shared/logic.js');
const T = require('../../shared/task.js');
const R = require('../../shared/repeat.js');
const NL = require('../../shared/nl.js');

function def(o) {
  return {
    name: o.name, group: o.group || '奶蛙助手', level: o.level || 'low',
    description: o.description, parameters: o.parameters || { type: 'object', properties: {} },
    describe: o.describe || (() => o.name), preview: o.preview, run: o.run
  };
}

function createProductivityTools(host) {
  const S = host.services;

  return [
    def({
      name: 'schedule_list',
      group: '日程',
      description: '查看用户的日程。可以看某一天，也可以看未来几天。返回每条日程的 time、text、是否已完成、是否重复。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
          days: { type: 'integer', description: '往后看几天，默认 1（只这一天）' }
        }
      },
      describe: (a) => '查看日程' + (a && a.date ? '（' + a.date + '）' : ''),
      async run(args) {
        const a = args || {};
        const start = a.date ? L.parseDate(a.date) : L.todayStr();
        if (!start) throw new Error('日期格式应为 YYYY-MM-DD');
        const days = Math.max(1, Math.min(30, Number(a.days) || 1));
        const lines = [];
        for (let i = 0; i < days; i++) {
          const d = L.dateAdd(start, i);
          const items = T.itemsOn(S.schedule.tasks(), d);
          if (!items.length) continue;
          lines.push('【' + d + ' ' + L.weekdayCn(L.dateObj(d)) + (L.holiday(d) ? ' ' + L.holiday(d) : '') + '】');
          items.forEach((t) => {
            const done = T.isDone(S.schedule.doneMap(), d, T.keyOf(t)) ? '✅' : '⬜';
            const rep = t.repeat ? ' [' + R.describeRepeat(t.repeat) + ']' : '';
            const prio = t.prio === 'high' ? ' ❗' : '';
            const tag = t.tag ? ' #' + t.tag : '';
            lines.push('  ' + done + ' ' + t.time + ' ' + t.text + rep + prio + tag);
          });
        }
        if (!lines.length) return { ok: true, text: (start === L.todayStr() ? '今天' : start) + ' 及之后 ' + days + ' 天没有任何日程。' };
        const p = S.schedule.progress(start);
        return { ok: true, text: lines.join('\n') + '\n\n完成情况：' + p.done + '/' + p.total + '（' + p.pct + '%）' };
      }
    }),

    def({
      name: 'schedule_add',
      group: '日程',
      description: '给用户加一条日程/待办。可以只给一句自然语言（when 字段），例如「明天下午3点跟设计组评审」——程序会自动解析出日期时间、重复规则、标签。\n'
        + '也可以显式给 time/date/repeat。加完要告诉用户你加了什么。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '事项内容' },
          when: { type: 'string', description: '自然语言时间，如「明天下午3点」「每周一早上9点」「30分钟后」。给了它就不用给 time/date' },
          time: { type: 'string', description: 'HH:MM' },
          date: { type: 'string', description: 'YYYY-MM-DD，不填表示每天' },
          repeat: { type: 'string', description: 'daily / weekdays / weekly:1,3,5 / monthly:1,15 / yearly / every:2d' },
          alarm: { type: 'integer', description: '提前多少分钟提醒' },
          prio: { type: 'string', enum: ['high', 'mid', 'low'] },
          tag: { type: 'string' }
        },
        required: ['text']
      },
      describe: (a) => '添加日程「' + ((a && a.text) || '') + '」' + ((a && a.when) ? '（' + a.when + '）' : ''),
      preview: (a) => '将要添加到日历：\n  ' + ((a && a.when) ? a.when + ' ' : '') + ((a && a.time) || '') + ' ' + ((a && a.text) || ''),
      async run(args) {
        const a = args || {};
        const text = String(a.text || '').trim();
        if (!text) throw new Error('text 不能为空');

        let parsed = null;
        const whenRaw = [a.when, a.time, a.repeat, a.tag].filter(Boolean).join(' ');
        if (a.when || (!a.time && !a.date && !a.repeat)) {
          parsed = NL.parseQuickAdd((a.when ? a.when + ' ' : '') + text, new Date());
          if (a.when && parsed.text) { parsed.text = text; }
        }

        const task = { date: '', time: '', text: text };
        if (parsed) {
          task.date = parsed.date || '';
          task.time = parsed.time || '';
          if (parsed.repeat) task.repeat = parsed.repeat;
          if (parsed.alarm) task.alarm = parsed.alarm;
          if (parsed.tag) task.tag = parsed.tag;
          if (parsed.prio && parsed.prio !== 'mid') task.prio = parsed.prio;
          if (parsed.dur) task.dur = parsed.dur;
        }
        if (a.date) { const d = L.parseDate(a.date); if (!d) throw new Error('date 格式应为 YYYY-MM-DD'); task.date = d; }
        if (a.time) { const t = L.parseTime(a.time); if (!t) throw new Error('time 格式应为 HH:MM'); task.time = t; }
        if (a.repeat) {
          const r = R.parseRepeat(a.repeat);
          if (!r) throw new Error('看不懂的 repeat：' + a.repeat);
          task.repeat = r;
          if (!task.date) task.date = L.todayStr();
        }
        if (a.alarm) task.alarm = Math.max(1, Math.min(1440, Number(a.alarm)));
        if (a.prio && ['high', 'mid', 'low'].indexOf(a.prio) >= 0) task.prio = a.prio;
        if (a.tag) task.tag = String(a.tag);

        if (!task.time) {
          return { ok: false, text: '没说几点。请告诉用户具体时间，或调用 ask_user 问一下。' };
        }
        const saved = S.schedule.add(task);
        const desc = (saved.date ? saved.date + ' ' : '每天 ') + saved.time + ' ' + saved.text
          + (saved.repeat ? '（' + R.describeRepeat(saved.repeat) + '）' : '')
          + (saved.tag ? ' #' + saved.tag : '');
        return { ok: true, text: '已加进日程：' + desc };
      }
    }),

    def({
      name: 'schedule_done',
      group: '日程',
      description: '把一条日程打勾（或取消打勾）。用 match 给出事项文字或完整的 时间|内容。',
      parameters: {
        type: 'object',
        properties: {
          match: { type: 'string', description: '事项内容关键字，或 "09:00|晨会" 这样的完整 key' },
          date: { type: 'string', description: '哪一天，默认今天' },
          undo: { type: 'boolean', description: 'true 表示取消打勾' }
        },
        required: ['match']
      },
      describe: (a) => (a && a.undo ? '取消打勾 ' : '完成 ') + (a && a.match),
      async run(args) {
        const a = args || {};
        const date = a.date ? L.parseDate(a.date) : L.todayStr();
        const items = T.itemsOn(S.schedule.tasks(), date);
        const found = T.findTask(items, String(a.match || ''));
        if (!found) throw new Error('在 ' + date + ' 没找到匹配「' + a.match + '」的日程');
        S.schedule.toggleDone(date, T.keyOf(found), !!a.undo);
        const nowDone = T.isDone(S.schedule.doneMap(), date, T.keyOf(found));
        return { ok: true, text: '「' + found.text + '」（' + date + ' ' + found.time + '）现在是' + (nowDone ? '已完成 ✅' : '未完成 ⬜') };
      }
    }),

    def({
      name: 'schedule_remove',
      group: '日程',
      description: '删除一条日程（从列表里彻底移除，不是打勾）。必须确认无误再删。',
      parameters: {
        type: 'object',
        properties: {
          match: { type: 'string', description: '事项内容关键字' },
          date: { type: 'string', description: '限定日期，默认今天' }
        },
        required: ['match']
      },
      describe: (a) => '删除日程「' + (a && a.match) + '」',
      preview: (a) => '将从日程表里删除匹配「' + ((a && a.match) || '') + '」的条目（不可撤销）',
      async run(args) {
        const a = args || {};
        const date = a.date ? L.parseDate(a.date) : L.todayStr();
        const items = T.itemsOn(S.schedule.tasks(), date);
        const found = T.findTask(items, String(a.match || ''));
        if (!found) throw new Error('没找到匹配「' + a.match + '」的日程');
        S.schedule.remove(task => T.keyOf(task) === T.keyOf(found));
        return { ok: true, text: '已删除日程「' + found.text + '」（' + found.time + '）' };
      }
    }),

    def({
      name: 'countdown_list',
      group: '日程',
      description: '查看倒数日（还有多少天）。',
      parameters: { type: 'object', properties: {} },
      describe: () => '查看倒数日',
      async run() {
        const list = L.nextCountdowns(S.countdown.list(), null, 20);
        if (!list.length) return { ok: true, text: '还没有倒数日' };
        return { ok: true, text: list.map((c) => c.date + '  ' + c.text + '  还有 ' + c.days + ' 天').join('\n') };
      }
    }),

    def({
      name: 'countdown_add',
      group: '日程',
      description: '添加一个倒数日，例如「2027-01-01|元旦」。',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string' }, text: { type: 'string' } },
        required: ['date', 'text']
      },
      describe: (a) => '添加倒数日 ' + (a && a.date) + ' ' + (a && a.text),
      async run(args) {
        const a = args || {};
        const d = L.parseDate(a.date);
        if (!d) throw new Error('date 格式应为 YYYY-MM-DD');
        S.countdown.add(d, String(a.text || ''));
        const days = L.daysUntil(d);
        return { ok: true, text: '已添加倒数日：' + d + ' ' + a.text + '（还有 ' + days + ' 天）' };
      }
    }),

    def({
      name: 'focus_start',
      group: '专注',
      description: '启动一个番茄钟/专注倒计时，到点奶蛙会提醒。用户说「我要专注 25 分钟」时用它。',
      parameters: {
        type: 'object',
        properties: {
          minutes: { type: 'integer', description: '专注分钟数，默认 25' },
          label: { type: 'string', description: '这段专注做什么，可选' }
        }
      },
      describe: (a) => '开始专注 ' + ((a && a.minutes) || 25) + ' 分钟',
      async run(args) {
        const a = args || {};
        const min = Math.max(1, Math.min(600, Number(a.minutes) || 25));
        const st = S.focus.start(min, String(a.label || ''));
        return { ok: true, text: '专注已开始：' + min + ' 分钟' + (a.label ? '（' + a.label + '）' : '') + '，结束时间 ' + new Date(st.endsAt).toTimeString().slice(0, 5) };
      }
    }),

    def({
      name: 'focus_status',
      group: '专注',
      description: '看当前专注/番茄钟状态和今天的专注统计。',
      parameters: { type: 'object', properties: {} },
      describe: () => '查看专注状态',
      async run() {
        const s = S.focus.status();
        const t = S.stats.today();
        const lines = [];
        lines.push('当前：' + s.label + (s.phase !== 'idle' ? '，剩余 ' + L.humanDuration(s.remainMs / 1000) : ''));
        lines.push('今天已完成 ' + t.focusCount + ' 个番茄，共 ' + t.focusMinutes + ' 分钟');
        lines.push('日程完成 ' + t.tasksDone + '/' + t.tasksTotal + '，连签 ' + t.streak + ' 天');
        return { ok: true, text: lines.join('\n') };
      }
    }),

    def({
      name: 'focus_stop',
      group: '专注',
      description: '停止当前专注计时',
      parameters: { type: 'object', properties: {} },
      describe: () => '停止专注',
      async run() {
        S.focus.stop();
        return { ok: true, text: '专注已停止' };
      }
    }),

    def({
      name: 'stats_overview',
      group: '专注',
      description: '用户的时间管理数据：近 N 天的完成率、每天明细、按标签统计、最出活的时段。用户问「我最近效率怎么样」时用。',
      parameters: { type: 'object', properties: { days: { type: 'integer', description: '默认 14' } } },
      describe: (a) => '查看最近 ' + ((a && a.days) || 14) + ' 天的数据',
      async run(args) {
        const days = Math.max(3, Math.min(180, Number((args || {}).days) || 14));
        const s = S.stats.range(days);
        const lines = [];
        lines.push('近 ' + days + ' 天：完成 ' + s.summary.doneItems + '/' + s.summary.totalItems + '（' + s.summary.rate + '%），有安排的天数 ' + s.summary.activeDays);
        lines.push('连签 ' + s.streak + ' 天，最长 ' + s.longest + ' 天');
        lines.push('专注：' + s.focusCount + ' 个番茄 / ' + s.focusMinutes + ' 分钟');
        if (s.tags.length) lines.push('按标签：' + s.tags.map((t) => t.tag + ' ' + t.done + '/' + t.total).join('，'));
        const hot = s.hours.map((n, h) => ({ n, h })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
        if (hot.length) lines.push('最出活的时段：' + hot.map((x) => x.h + ':00 前后').join('、'));
        return { ok: true, text: lines.join('\n') };
      }
    }),

    def({
      name: 'remember',
      group: '记忆',
      description: '把关于用户的一条事实/偏好记下来，以后所有对话都会知道。例如「他的项目文档都放在 D:\\work\\docs」「汇报要用中文」',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, tag: { type: 'string', description: '可选分类，如 偏好/项目/人' } },
        required: ['text']
      },
      describe: (a) => '记住：' + String((a && a.text) || '').slice(0, 60),
      async run(args) {
        const a = args || {};
        S.memory.add(String(a.text || ''), String(a.tag || ''));
        return { ok: true, text: '记住了：' + a.text };
      }
    }),

    def({
      name: 'recall',
      group: '记忆',
      description: '从长期记忆里检索相关内容。不确定用户以前的偏好/路径时先查一下。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer' } }
      },
      describe: (a) => '回忆' + (a && a.query ? '「' + a.query + '」' : ''),
      async run(args) {
        const a = args || {};
        const hits = S.memory.search(String(a.query || ''), Math.min(30, Number(a.limit) || 8));
        if (!hits.length) return { ok: true, text: '记忆里没有相关内容' };
        return { ok: true, text: hits.map((m) => '- ' + (m.tag ? '[' + m.tag + '] ' : '') + m.text).join('\n') };
      }
    }),

    def({
      name: 'ask_user',
      group: '奶蛙助手',
      description: '停下来问用户一个问题（当信息不足、或需要用户做选择时）。用户会直接在奶蛙窗口里回答。',
      parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
      describe: (a) => '问用户：' + String((a && a.question) || '').slice(0, 60),
      async run(args, ctx) {
        const q = String((args || {}).question || '').trim();
        if (!q) throw new Error('question 不能为空');
        const answer = await ctx.ask(q);
        return { ok: true, text: '用户的回答：' + answer };
      }
    }),

    def({
      name: 'propose_plan',
      group: '奶蛙助手',
      level: 'low',
      description: '把你要做的事拆成几步交给用户确认。\n**计划模式开启时，动手之前必须先调用它**；用户批准后再执行，被拒绝就停下来问清楚，不要自己继续。\n步骤要具体到“打开什么、点什么、看到什么算成功”，不要写“分析一下”“看看情况”这种空话。',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, description: '按顺序排列的步骤，每步一句话' },
          notes: { type: 'string', description: '可选：风险提示、会改到哪些东西、预计要多久' }
        },
        required: ['steps']
      },
      describe: (a) => '提交计划（' + String(((a && a.steps) || []).length) + ' 步）',
      preview: (a) => '计划：\n' + (((a && a.steps) || []).map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n')),
      async run(args, ctx) {
        const a = args || {};
        const steps = (Array.isArray(a.steps) ? a.steps : []).map((s) => String(s || '').trim()).filter(Boolean);
        if (!steps.length) throw new Error('steps 不能为空，至少写一步');
        if (steps.length > 20) throw new Error('步骤太多了（' + steps.length + ' 步），请先收敛到 20 步以内');
        if (!ctx || typeof ctx.askPlan !== 'function') {
          return { ok: true, text: '（当前内核不支持计划审批，直接按下面的步骤做：' + steps.join(' → ') + '）' };
        }
        const answer = String(await ctx.askPlan({ steps: steps, notes: String(a.notes || '') }) || '');
        if (answer === 'approve' || answer === 'auto') {
          return { ok: true, text: '用户批准了这个计划，可以开始执行了。' };
        }
        if (answer.indexOf('edit:') === 0) {
          return { ok: true, text: '用户把计划改成了下面这版，按新的来：\n' + answer.slice(5) };
        }
        return { ok: false, text: '用户没有批准这个计划。停下来问他希望怎么调整，在他同意之前不要动手。' };
      }
    }),

    def({
      name: 'think',
      group: '奶蛙助手',
      level: 'low',
      description: '把思路写在纸上（不会显示给用户，也不产生副作用）。拆解复杂任务时先想清楚再动手。',
      parameters: { type: 'object', properties: { thought: { type: 'string' } }, required: ['thought'] },
      describe: () => '整理思路',
      async run() { return { ok: true, text: '记下了。继续。' }; }
    })
  ];
}

module.exports = { createProductivityTools };
