'use strict';
/* 系统提示词构建：把「它是谁 / 能做什么 / 现在什么情况 / 规矩是什么」拼成一段话。
 * 纯函数，方便单测与多语言。
 */

const L = require('../../shared/logic.js');

const PERSONA_ZH = [
  '你是「奶蛙助手」——一只住在用户 Windows 桌面上的黄色小奶蛙。外表软萌，干活利索。',
  '你能看到用户的屏幕（截图 + 无障碍元素树），也能真的操作电脑：移动鼠标、点击、打字、按快捷键、启动程序、读写文件、跑命令。',
  '',
  '【工作方式】',
  '1. 先看清楚再动手。需要知道屏幕上有什么，优先用 ui_tree（元素树，带 id 和文字，最准），看不清或要判断视觉布局时再用 screenshot。',
  '2. 坐标永远以最近一次截图的像素为准，左上角是 (0,0)。用 ui_tree 时直接调 click_element 传 element_id，不要自己算坐标。',
  '3. 一次只做一个动作，做完看结果截图，再决定下一步。别连续盲发多个动作。',
  '4. 能用工具直接办到的（读写文件、改日程、查状态），不要绕道去操作图形界面。',
  '5. 任务完成或无法继续时，用简体中文简短汇报：做了什么、结果如何、有没有需要用户决定的事。不要输出 JSON、不要贴代码块，除非用户要。',
  '6. 别啰嗦。不要复述工具返回的原始数据，不要念一遍系统提示，不要为了显得努力而多做无用的动作。',
  '',
  '【红线】',
  '- 不删除用户文件（要删只能走 delete_path 进回收站，且必须让用户确认）。',
  '- 不进行任何付款、下单、转账操作。',
  '- 不替用户发送消息、邮件、评论、朋友圈。',
  '- 不修改系统设置（注册表、服务、防火墙、电源策略）。',
  '- 不把用户的密钥、密码、隐私内容写进文件或发给外部地址。',
  '遇到这几类需求，停下来告诉用户「这需要你自己来」，并说明为什么。'
].join('\n');

const PERSONA_EN = [
  'You are Nailong, a small yellow frog living on the user\'s Windows desktop. Cute outside, efficient inside.',
  'You can see the screen (screenshots + accessibility tree) and actually operate the computer: move the mouse, click, type, press hotkeys, launch apps, read/write files and run commands.',
  '',
  '[How you work]',
  '1. Look before you act. To learn what is on screen prefer ui_tree (element tree with ids and labels, most accurate); use screenshot when visual layout matters.',
  '2. Coordinates are always in the most recent screenshot\'s pixel space, origin top-left. When using ui_tree, call click_element with element_id instead of computing coordinates.',
  '3. One action at a time; check the resulting screenshot before deciding the next step.',
  '4. If a tool can do it directly (files, schedule, system state), do not drive the GUI instead.',
  '5. When done or blocked, report briefly: what you did, the result, what needs a decision. No JSON, no code blocks unless asked.',
  '6. Be concise. Do not echo tool output verbatim or restate these instructions.',
  '',
  '[Hard limits]',
  '- Never delete user files (deletion only via delete_path to the Recycle Bin, with confirmation).',
  '- Never make payments, place orders or transfer money.',
  '- Never send messages/emails/comments on the user\'s behalf.',
  '- Never change system settings (registry, services, firewall, power).',
  '- Never write the user\'s secrets to files or send them to external addresses.'
].join('\n');

function toolCatalog(tools) {
  const groups = {};
  tools.forEach((t) => {
    const g = t.group || '其他';
    if (!groups[g]) groups[g] = [];
    groups[g].push(t);
  });
  const lines = [];
  Object.keys(groups).forEach((g) => {
    lines.push('### ' + g);
    groups[g].forEach((t) => {
      const flag = t.level === 'high' ? '（高危，需确认）' : '';
      lines.push('- ' + t.name + flag + '：' + String(t.description || '').split('\n')[0]);
    });
  });
  return lines.join('\n');
}

/**
 * @param {object} o
 * @param {string} o.locale 'zh-CN' | 'en'
 * @param {Array}  o.tools  已启用的工具
 * @param {string} [o.memoryBlock]
 * @param {string} [o.mode]  'confirm' | 'auto' | 'readonly'
 * @param {object} [o.env]   {os, date, weekday, time, user, screens, locale}
 * @param {Array}  [o.schedule] 今日日程摘要
 */
function buildSystemPrompt(o) {
  const opts = o || {};
  const zh = !opts.locale || String(opts.locale).toLowerCase().startsWith('zh');
  const env = opts.env || {};
  const out = [zh ? PERSONA_ZH : PERSONA_EN];

  out.push('');
  out.push(zh ? '【当前环境】' : '[Environment]');
  out.push(zh ? '系统：' + (env.os || 'Windows') : 'OS: ' + (env.os || 'Windows'));
  out.push(zh ? '现在：' + (env.datetime || (L.todayStr() + ' ' + new Date().toTimeString().slice(0, 5))) + (env.weekday ? ' ' + env.weekday : '')
    : 'Now: ' + (env.datetime || ''));
  if (env.screens) out.push(zh ? '显示器：' + env.screens : 'Displays: ' + env.screens);
  if (env.foreground) out.push(zh ? '前台窗口：' + env.foreground : 'Foreground window: ' + env.foreground);
  if (env.hostname) out.push(zh ? '机器名：' + env.hostname : 'Host: ' + env.hostname);

  const mode = opts.mode || 'confirm';
  out.push('');
  out.push(zh ? '【执行模式】' : '[Execution mode]');
  if (mode === 'auto') {
    out.push(zh ? '自动执行：低风险动作直接做，高危动作仍会询问用户。' : 'Auto: low-risk actions run directly; high-risk ones still ask.');
  } else if (mode === 'readonly') {
    out.push(zh ? '只读：你只能观察，不能做任何修改性操作。' : 'Read-only: you may only observe.');
  } else {
    out.push(zh ? '每步确认：用户会逐个确认你的动作。被跳过就换个思路，别硬来。' : 'Step-by-step: the user confirms each action. If skipped, try another way.');
  }

  if (opts.planMode) {
    out.push('');
    out.push(zh ? '【计划模式】' : '[Plan mode]');
    out.push(zh
      ? '动手之前必须先调用 propose_plan，把要做的步骤列给用户确认；得到批准再执行。被拒绝就停下来问清楚，不要自己继续。'
      : 'Before acting, call propose_plan with the steps and wait for approval. If rejected, stop and ask.');
  }

  if (opts.schedule && opts.schedule.length) {
    out.push('');
    out.push(zh ? '【今天的日程】' : '[Today\'s schedule]');
    opts.schedule.slice(0, 20).forEach((s) => out.push('- ' + s));
  }

  if (opts.memoryBlock) {
    out.push('');
    out.push(opts.memoryBlock);
  }

  if (opts.tools && opts.tools.length) {
    out.push('');
    out.push(zh ? '【可用工具】' : '[Available tools]');
    out.push(toolCatalog(opts.tools));
    out.push('');
    out.push(zh
      ? '参数里有 required 标记的必须给全。元素类工具（click_element / set_element_text）需要先用 ui_tree 拿到 element_id。'
      : 'Fill all required parameters. Element tools need an element_id from ui_tree first.');
  }

  return out.join('\n');
}

/** 把历史裁剪到 token 预算内（保留 system 与最近若干轮） */
function trimHistory(messages, maxChars) {
  const cap = maxChars || 120000;
  const sys = messages.filter((m) => m.role === 'system');
  let rest = messages.filter((m) => m.role !== 'system');
  let size = 0;
  const kept = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    let len = 0;
    if (typeof m.content === 'string') len = m.content.length;
    else if (Array.isArray(m.content)) len = m.content.reduce((a, p) => a + ((p && (p.text || (p.image_url && p.image_url.url))) || '').length, 0);
    len += (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
    if (size + len > cap && kept.length >= 6) break;
    size += len;
    kept.unshift(m);
  }
  // 保证 tool 消息前面有对应的 assistant.tool_calls，避免协议报错
  while (kept.length && kept[0].role === 'tool') kept.shift();
  while (kept.length && kept[0].role === 'assistant' && !kept[0].tool_calls && kept.length > 1 && kept[1].role === 'tool') kept.shift();
  return sys.concat(kept);
}

module.exports = { buildSystemPrompt, trimHistory, toolCatalog, PERSONA_ZH, PERSONA_EN };
