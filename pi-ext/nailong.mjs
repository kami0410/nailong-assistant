/**
 * 奶蛙助手 · pi 扩展
 *
 * 作用：把「奶蛙的手」交给 pi 当工具用。
 *   - 启动时从本地工具桥拉一份工具清单（截图 / 无障碍元素树 / 鼠标键盘 / 文件 / 系统 / 日程…），
 *     逐个注册成 pi 工具；execute 时再代理回桥去真正执行。
 *   - 工具清单不在这里写死：以后奶蛙加工具，pi 侧自动就有了。
 *   - 如果用户是用「Base URL + API Key」配置的模型，这里顺手把它注册成 pi 的一个 provider，
 *     这样不需要用户去改 pi 自己的配置。
 *
 * 由 pi 以 `-e <此文件>` 显式加载；桥的地址与 token 通过环境变量传入。
 */

import { Type } from 'typebox';
import http from 'node:http';
import providers from '../src/main/agent/providers.js';
import catalog from '../src/main/agent/model-catalog.js';

const BRIDGE = process.env.NAILONG_BRIDGE || '';
const TOKEN = process.env.NAILONG_TOKEN || '';
const TIMEOUT_MS = Number(process.env.NAILONG_TIMEOUT || 15 * 60 * 1000);

function parseUrl(u) {
  const m = /^http:\/\/([^:/]+)(?::(\d+))?$/.exec(String(u || ''));
  if (!m) throw new Error('工具桥地址格式不对：' + u);
  return { host: m[1], port: Number(m[2] || 80) };
}

/**
 * 为什么不用 fetch：pi 进程里的全局 fetch 会被它自己的网络层接管，
 * 打本机 http 会直接 "fetch failed"。直接走 node:http 最稳，也没有代理变量干扰。
 */
function request(path, body, method) {
  return new Promise((resolve, reject) => {
    if (!BRIDGE) { reject(new Error('没有配置本地工具桥地址（NAILONG_BRIDGE）')); return; }
    let target;
    try { target = parseUrl(BRIDGE); } catch (e) { reject(e); return; }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: target.host,
      port: target.port,
      path: path,
      method: method || (payload ? 'POST' : 'GET'),
      headers: Object.assign(
        { 'x-nailong-token': TOKEN, accept: 'application/json' },
        payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}
      ),
      timeout: TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('工具桥返回 ' + res.statusCode + '：' + text.slice(0, 200)));
          return;
        }
        try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(new Error('工具桥返回的不是 JSON')); }
      });
    });
    req.on('timeout', () => { try { req.destroy(new Error('工具桥调用超时')); } catch (e) { /* ignore */ } });
    req.on('error', (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}

const call = (path, body, method) => request(path, body, method);

function toContent(result) {
  const parts = [{ type: 'text', text: String(result.text || (result.ok ? '完成' : '执行失败')) }];
  (result.images || []).forEach((dataUrl) => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl));
    if (m) parts.push({ type: 'image', data: m[2], mimeType: m[1] });
  });
  return parts;
}

export default async function nailongExtension(pi) {
  // ---------- 1) 把桥上的工具全部注册成 pi 工具 ----------
  let tools = [];
  try {
    const cat = await call('/catalog');
    tools = Array.isArray(cat.tools) ? cat.tools : [];
  } catch (e) {
    const cause = e && e.cause ? (' ／ ' + (e.cause.message || e.cause)) : '';
    console.error('[nailong] 拿不到工具清单：' + ((e && e.message) || e) + cause);
  }

  for (const t of tools) {
    pi.registerTool({
      name: t.name,
      label: t.name,
      description: t.description || t.name,
      // 工具 schema 从奶蛙那边原样透传，避免两边各写一份定义
      parameters: Type.Unsafe(t.parameters || { type: 'object', properties: {} }),
      promptSnippet: t.promptSnippet,
      execute: async (_toolCallId, params, signal) => {
        if (signal && signal.aborted) {
          return { content: [{ type: 'text', text: '已被用户中止' }], details: { aborted: true } };
        }
        const r = await call('/tool', { name: t.name, args: params || {} });
        return { content: toContent(r), details: { ok: r.ok !== false, skipped: !!r.skipped, ms: r.ms, group: t.group, level: t.level } };
      }
    });
  }

  // ---------- 2) 把用户自己的 Base URL 注册成 pi provider ----------
  // 这样用户不必去改 pi 自己的 models.json：奶蛙设置里填的 Base URL + Key + 模型
  // 直接变成 pi 的 provider「nailong/<model>」。若用户更想用 pi 自己的订阅登录，
  // 设置里把引擎切到「跟随 pi 配置」即可，这里就不会注册。
  let cfg = null;
  try { cfg = await call('/config'); } catch (e) { /* 用 pi 自带的凭据也行 */ }
  if (cfg && cfg.useCustomProvider !== false && cfg.baseUrl && cfg.apiKey && cfg.model) {
    try {
      const provider = providers.detectProvider(cfg);
      const api = provider === 'anthropic' ? 'anthropic-messages'
        : provider === 'gemini' ? 'google-generative-ai' : 'openai-completions';
      pi.registerProvider('nailong', {
        name: '奶蛙助手配置的接口',
        baseUrl: cfg.baseUrl,
        api,
        apiKey: cfg.apiKey,
        authHeader: true,
        models: catalog.fromConfig(cfg).map(m => ({
          type: 'chat', id: m.id, name: m.name,
          input: m.vision ? ['text', 'image'] : ['text'], output: ['text'],
          reasoning: m.reasoning,
          thinkingLevelMap: Object.fromEntries(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(level => [level, m.thinkingLevels && m.thinkingLevels.includes(level) ? level === 'off' ? 'none' : level : null])),
          ...(api === 'openai-completions' && m.thinkingFormat === 'deepseek' ? { compat: { thinkingFormat: 'deepseek', maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true } } : {}),
          contextWindow: m.contextWindow || Number(cfg.contextWindow) || 128000,
          maxTokens: m.maxTokens || Number(cfg.maxTokens) || 4096,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }))
      });
      console.error('[nailong] 已注册 provider：nailong/' + cfg.model);
    } catch (e) {
      console.error('[nailong] 注册 provider 失败（将使用 pi 自己的配置）：' + ((e && e.message) || e));
    }
  }

  // Apply the saved request budget to the actual custom provider payload.
  pi.on('before_provider_request', async (event, ctx) => {
    if (!cfg || !ctx.model || ctx.model.provider !== 'nailong') return;
    const current = await call('/config');
    const payload = { ...event.payload };
    const limit = Math.min(Number(current.maxTokens) || 4096, ctx.model.maxTokens);
    if (ctx.model.api === 'google-generative-ai') {
      payload.config = { ...payload.config, maxOutputTokens: limit };
      if (!ctx.model.reasoning && current.temperature !== undefined) payload.config.temperature = current.temperature;
    } else {
      if ('max_completion_tokens' in payload) payload.max_completion_tokens = limit;
      else payload.max_tokens = limit;
      if (payload.thinking && payload.thinking.type === 'enabled' && Number(payload.thinking.budget_tokens) >= limit) {
        if (limit <= 1024) throw new Error('此思考模型的输出上限需要大于 1024 token');
        payload.thinking = { ...payload.thinking, budget_tokens: Math.max(1024, limit - 1) };
      }
      // Reasoning providers may forbid temperature. Let their default apply.
      if (!ctx.model.reasoning && current.temperature !== undefined) payload.temperature = current.temperature;
    }
    return payload;
  });

  // ---------- 3) 计划模式：动手前先让用户看到计划 ----------
  // 注意：这个开关是热的 —— 用户在奶蛙设置里改了，下一次对话就生效（不用重启 pi），
  // 所以每次 agent 开始前重新问一次桥。
  const PLAN_TEXT = '\n\n# 计划模式已打开\n' +
    '用户要求：动手之前先把计划交给他确认。\n' +
    '所以在本轮里，你必须先调用 propose_plan 把要做的步骤（按顺序、具体到点哪里/看什么）列出来，\n' +
    '等用户批准之后再执行。用户拒绝就停下来问清楚，不要自己继续。\n' +
    '已经批准过的步骤不需要重复提交计划。';

  pi.on('before_agent_start', async (event) => {
    let plan = false;
    try {
      const c = await call('/config');
      plan = !!(c && c.planMode);
    } catch (e) { /* 桥不在就当没开计划模式 */ }
    if (!plan) return undefined;
    if (String(event.systemPrompt || '').indexOf('计划模式已打开') >= 0) return undefined;
    return { systemPrompt: String(event.systemPrompt || '') + PLAN_TEXT };
  });

  pi.on('input', async () => undefined);

  console.error('[nailong] 扩展已加载，工具 ' + tools.length + ' 个');
}
