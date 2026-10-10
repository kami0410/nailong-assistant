'use strict';
/* pi 的转录（AgentMessage[]）→ 奶蛙助手窗能直接渲染的条目
 *
 * 纯函数，方便单测。目标形状：
 *   { kind:'user',      text }
 *   { kind:'assistant', text, thinking }
 *   { kind:'tool',      id, name, args, ok, text, images[] }
 *   { kind:'note',      text }        // 压缩摘要 / 分支摘要这类系统信息
 *
 * 关键点：
 *   - assistant 的 content 是块数组，里面混着 text / thinking / toolCall，要拆开
 *   - toolResult 用 toolCallId 回填到对应的 toolCall 上，这样显示的是"一次调用 + 它的结果"
 *   - 图片按 data URL 还原，能直接 <img src>
 */

function toText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p && p.type === 'text' && p.text).map((p) => p.text).join('\n');
}

function toImages(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((p) => p && p.type === 'image' && p.data)
    .map((p) => 'data:' + (p.mimeType || 'image/png') + ';base64,' + p.data);
}

function argsOf(toolCall) {
  const a = toolCall && toolCall.arguments;
  if (a === undefined || a === null) return {};
  if (typeof a === 'string') {
    try { return JSON.parse(a); } catch (e) { return { raw: a.slice(0, 200) }; }
  }
  return a;
}

/**
 * @param {Array} messages pi 的 AgentMessage[]
 * @param {object} [opts] { hideThink: boolean }
 * @returns {Array} UI 条目
 */
function piMessagesToTranscript(messages, opts) {
  const o = opts || {};
  const out = [];
  const byCallId = {};

  (Array.isArray(messages) ? messages : []).forEach((m) => {
    if (!m || !m.role) return;

    if (m.role === 'user') {
      const text = toText(m.content);
      const images = toImages(m.content);
      if (!text && !images.length) return;
      // 工具执行后被我们自己塞回去的"截图说明"不进历史
      if (/^（这是上一步操作后的最新截图）/.test(String(text))) return;
      out.push({ kind: 'user', text: text + (images.length ? '\n（附了 ' + images.length + ' 张图）' : '') });
      return;
    }

    if (m.role === 'assistant') {
      const text = toText(m.content).trim();
      const thinking = Array.isArray(m.content)
        ? m.content.filter((p) => p && p.type === 'thinking' && p.thinking).map((p) => p.thinking).join('\n')
        : '';
      const toolCalls = Array.isArray(m.content) ? m.content.filter((p) => p && p.type === 'toolCall') : [];

      if (text || (thinking && !o.hideThink)) {
        out.push({ kind: 'assistant', text: text, thinking: o.hideThink ? '' : thinking });
      }
      toolCalls.forEach((tc) => {
        const entry = {
          kind: 'tool',
          id: tc.id || ('t' + out.length),
          name: tc.name || 'tool',
          args: argsOf(tc),
          ok: true,
          text: '（历史记录里没有保留结果明细）',
          images: []
        };
        byCallId[entry.id] = entry;
        out.push(entry);
      });
      return;
    }

    if (m.role === 'toolResult') {
      const target = byCallId[m.toolCallId];
      const text = toText(m.content) || (m.isError ? '执行失败' : '完成');
      const images = toImages(m.content);
      if (target) {
        target.ok = !m.isError;
        target.text = text;
        target.images = images;
        if (m.toolName) target.name = m.toolName;
      } else {
        out.push({
          kind: 'tool',
          id: m.toolCallId || ('t' + out.length),
          name: m.toolName || 'tool',
          args: {},
          ok: !m.isError,
          text: text,
          images: images
        });
      }
      return;
    }

    if (m.role === 'branchSummary') {
      out.push({ kind: 'note', text: '（从这里分了个岔：' + String(m.summary || '').slice(0, 200) + '）' });
      return;
    }
    if (m.role === 'compactionSummary') {
      out.push({ kind: 'note', text: '（上下文已压缩）' + (m.summary ? '\n' + String(m.summary).slice(0, 400) : '') });
      return;
    }
    if (m.role === 'custom') {
      const text = toText(m.content) || String(m.text || '');
      if (text) out.push({ kind: 'note', text: text });
      return;
    }
    // bashExecution 等跟桌面场景无关的角色直接忽略
  });

  return out;
}

/** 会话统计 → 界面上那句"用了多少" */
function piStatsToUsage(stats) {
  if (!stats) return null;
  const t = stats.tokens || {};
  return {
    input: t.input || 0,
    output: t.output || 0,
    total: t.total || (t.input || 0) + (t.output || 0),
    cached: t.cacheRead || 0,
    usd: typeof stats.cost === 'number' ? stats.cost : 0,
    calls: stats.assistantMessages || 0,
    context: stats.contextUsage || null,
    toolCalls: stats.toolCalls || 0
  };
}

module.exports = { piMessagesToTranscript, piStatsToUsage, toText, toImages };
