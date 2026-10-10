'use strict';
/* 长期记忆：把「用户是谁 / 偏好 / 常用路径 / 历史约定」沉淀下来，跨会话注入系统提示。
 * 纯函数，持久化交给调用方。
 */

const MAX_ITEMS = 300;

function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function keyOf(text) { return norm(text).toLowerCase(); }

function makeId(at, n) { return 'm' + at.toString(36) + '-' + n.toString(36); }

/** 清洗从磁盘读到的数据 */
function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && norm(x.text))
    .map((x, i) => ({
      id: x.id || makeId(Number(x.at) || Date.now(), i),
      text: norm(x.text),
      tag: norm(x.tag || ''),
      source: norm(x.source || ''),
      at: Number(x.at) || Date.now(),
      hits: Number(x.hits) || 0
    }))
    .slice(-MAX_ITEMS);
}

/** 新增一条（同文本去重，重复则刷新时间并累加 hits） */
function add(list, item) {
  const arr = normalize(list);
  const text = norm(item && item.text);
  if (!text || text.length > 500) return arr;
  const k = keyOf(text);
  const found = arr.find((x) => keyOf(x.text) === k);
  if (found) {
    found.at = Date.now();
    found.hits += 1;
    if (item.tag) found.tag = norm(item.tag);
    return arr;
  }
  arr.push({
    id: makeId(Date.now(), arr.length),
    text,
    tag: norm(item.tag || ''),
    source: norm(item.source || 'agent'),
    at: Number(item.at) || Date.now(),
    hits: 1
  });
  while (arr.length > MAX_ITEMS) arr.shift();
  return arr;
}

function remove(list, id) { return normalize(list).filter((x) => x.id !== id); }

function clear() { return []; }

/** 关键词检索：中文按字二元组也能命中，英文按词 */
function search(list, query, limit) {
  const arr = normalize(list);
  const q = norm(query).toLowerCase();
  if (!q) return arr.slice(-(limit || 10)).reverse();
  const grams = [];
  for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
  const scored = arr.map((x) => {
    const t = keyOf(x.text) + ' ' + keyOf(x.tag);
    let score = 0;
    if (t.indexOf(q) >= 0) score += 10;
    grams.forEach((g) => { if (t.indexOf(g) >= 0) score += 1; });
    if (score === 0) return { x, score: 0 };
    score += Math.min(3, x.hits * 0.5);
    return { x, score };
  }).filter((r) => r.score > 0);
  scored.sort((a, b) => b.score - a.score || b.x.at - a.x.at);
  return scored.slice(0, limit || 10).map((r) => r.x);
}

/** 注入系统提示的记忆块（控制在 maxChars 内） */
function toPromptBlock(list, maxChars) {
  const arr = normalize(list).slice().sort((a, b) => b.at - a.at);
  const cap = maxChars || 1200;
  const lines = [];
  let used = 0;
  for (const m of arr) {
    const line = '- ' + (m.tag ? '[' + m.tag + '] ' : '') + m.text;
    if (used + line.length > cap) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return '';
  return '已知的关于用户的事实与偏好（不要反复复述，只在需要时使用）：\n' + lines.join('\n');
}

module.exports = { MAX_ITEMS, normalize, add, remove, clear, search, toPromptBlock, keyOf };
