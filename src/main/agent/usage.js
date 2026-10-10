'use strict';
/* 用量与成本核算：把 token 数换算成钱，给用户看得懂的账本 */

// 单位：美元 / 百万 token。没列到的模型按 fallback 估。
const PRICES = {
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4.1': { in: 2.0, out: 8 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-5': { in: 1.25, out: 10 },
  'o3': { in: 2, out: 8 },
  'o4-mini': { in: 1.1, out: 4.4 },
  'claude-sonnet-4': { in: 3, out: 15 },
  'claude-3-5-sonnet': { in: 3, out: 15 },
  'claude-3-7-sonnet': { in: 3, out: 15 },
  'claude-3-5-haiku': { in: 0.8, out: 4 },
  'claude-opus-4': { in: 15, out: 75 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
  'qwen-vl-max': { in: 0.6, out: 1.8 },
  'qwen-max': { in: 1.6, out: 6.4 },
  'moonshot-v1-8k': { in: 1.7, out: 1.7 },
  'glm-4v': { in: 0.7, out: 0.7 }
};

const FALLBACK = { in: 1.0, out: 3.0 };

function priceOf(model) {
  const m = String(model || '').toLowerCase();
  if (PRICES[m]) return PRICES[m];
  // 前缀匹配：gemini-2.5-flash-001 → gemini-2.5-flash
  const keys = Object.keys(PRICES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (m.indexOf(k) === 0) return PRICES[k];
  }
  // 通配：带 vision / vl 的多模态通常更贵
  if (/vision|vl|omni/.test(m)) return { in: 0.5, out: 1.5 };
  return FALLBACK;
}

/** @returns {{in:number,out:number,total:number,usd:number}} */
function costOf(model, usage) {
  const u = usage || {};
  const p = priceOf(model);
  const input = u.input || 0;
  const output = u.output || 0;
  const cached = u.cached || 0;
  const billableIn = Math.max(0, input - cached) + cached * 0.25; // 缓存命中按 25% 计价
  const usd = (billableIn / 1e6) * p.in + (output / 1e6) * p.out;
  return { in: input, out: output, total: input + output, usd: usd, price: p, cached: cached };
}

function addUsage(a, b) {
  a = a || {};
  b = b || {};
  return {
    input: (a.input || 0) + (b.input || 0),
    output: (a.output || 0) + (b.output || 0),
    total: (a.total || 0) + (b.total || 0),
    cached: (a.cached || 0) + (b.cached || 0),
    usd: (a.usd || 0) + (b.usd || 0),
    calls: (a.calls || 0) + 1
  };
}

/** 粗略估算一段文本的 token 数（中文约 1.5 字/token，英文约 4 字符/token） */
function estimateTokens(text) {
  const s = String(text || '');
  let cjk = 0;
  for (const ch of s) { if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++; }
  const rest = Math.max(0, s.length - cjk);
  return Math.ceil(cjk * 0.9 + rest / 3.6);
}

function fmtUsd(usd) {
  const v = Number(usd) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return '$' + v.toFixed(4);
  if (v < 1) return '$' + v.toFixed(3);
  return '$' + v.toFixed(2);
}

/** 按天聚合用量，用于「这个月花了多少」 */
function byDay(records) {
  const map = {};
  (records || []).forEach((r) => {
    const d = r.day || (r.at ? new Date(r.at).toISOString().slice(0, 10) : 'unknown');
    if (!map[d]) map[d] = { day: d, calls: 0, input: 0, output: 0, usd: 0 };
    map[d].calls += 1;
    map[d].input += (r.usage && r.usage.input) || 0;
    map[d].output += (r.usage && r.usage.output) || 0;
    map[d].usd += r.usd || 0;
  });
  return Object.keys(map).sort().map((k) => map[k]);
}

module.exports = { PRICES, priceOf, costOf, addUsage, estimateTokens, fmtUsd, byDay };
