'use strict';
/* 多协议模型适配层（零依赖）
 *
 * 内部统一用「OpenAI Chat Completions」形状表示消息与工具调用，
 * 向后端转发时按 provider 转换成 Anthropic Messages / Gemini generateContent 形状，
 * 流式响应再统一转回 {type:'text'|'tool'|'usage'|'done'} 事件。
 *
 * 支持：任何 OpenAI 兼容网关、Anthropic 官方、Google Gemini 官方。
 */

const DEFAULT_MAX_TOKENS = 4096;

// ---------------------------------------------------------------- 工具定义转换

function toOpenAiTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} }
    }
  }));
}

function toAnthropicTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters || { type: 'object', properties: {} }
  }));
}

function toGeminiTools(tools) {
  if (!tools.length) return undefined;
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchema(t.parameters || { type: 'object', properties: {} })
    }))
  }];
}

/** Gemini 的 schema 不接受 additionalProperties / $schema / 空 properties 之外的键 */
function sanitizeSchema(s) {
  if (!s || typeof s !== 'object') return { type: 'object' };
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = sanitizeSchema(s.items);
  if (s.properties) {
    out.properties = {};
    for (const k of Object.keys(s.properties)) out.properties[k] = sanitizeSchema(s.properties[k]);
  }
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  return out;
}

// ---------------------------------------------------------------- 消息转换

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && p.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
  }
  return '';
}

function imagesOf(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  content.forEach((p) => {
    if (!p || p.type !== 'image_url') return;
    const url = (p.image_url && p.image_url.url) || p.image_url || '';
    if (typeof url !== 'string' || !url.startsWith('data:')) return;
    const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (m) out.push({ mime: m[1], data: m[2] });
  });
  return out;
}

function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: textOf(m.content) || '(空)' };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const content = [];
      const txt = textOf(m.content);
      if (txt) content.push({ type: 'text', text: txt });
      (m.tool_calls || []).forEach((tc) => {
        let input = {};
        try { input = JSON.parse(tc.function.arguments || '{}'); } catch (e) { input = {}; }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      });
      if (content.length) out.push({ role: 'assistant', content });
      continue;
    }
    // user
    const parts = [];
    const txt = textOf(m.content);
    if (txt) parts.push({ type: 'text', text: txt });
    imagesOf(m.content).forEach((img) => {
      parts.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
    });
    out.push({ role: 'user', content: parts.length ? parts : [{ type: 'text', text: '(空)' }] });
  }
  return out;
}

function toGeminiContents(messages) {
  const out = [];
  const namesById = {};
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      // Gemini 的 functionResponse 必须带函数名，从对应的 assistant.tool_calls 里找回来
      out.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.name || namesById[m.tool_call_id] || 'tool',
            response: { result: textOf(m.content) || '(空)' }
          }
        }]
      });
      continue;
    }
    if (m.role === 'assistant') {
      const parts = [];
      const txt = textOf(m.content);
      if (txt) parts.push({ text: txt });
      (m.tool_calls || []).forEach((tc) => {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
        namesById[tc.id] = tc.function.name;
        parts.push({ functionCall: { name: tc.function.name, args } });
      });
      if (parts.length) out.push({ role: 'model', parts });
      continue;
    }
    const parts = [];
    const txt = textOf(m.content);
    if (txt) parts.push({ text: txt });
    imagesOf(m.content).forEach((img) => {
      parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
    });
    out.push({ role: 'user', parts: parts.length ? parts : [{ text: '(空)' }] });
  }
  return out;
}

// ---------------------------------------------------------------- 请求构造

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

function detectProvider(cfg) {
  if (cfg.provider && cfg.provider !== 'auto') return cfg.provider;
  const base = String(cfg.baseUrl || '').toLowerCase();
  const model = String(cfg.model || '').toLowerCase();
  if (base.includes('anthropic') || /^claude/.test(model)) return 'anthropic';
  if (base.includes('generativelanguage.googleapis.com') || base.includes('googleapis') || /^gemini/.test(model)) return 'gemini';
  return 'openai';
}

function endpoint(cfg, provider, stream) {
  const base = trimSlash(cfg.baseUrl);
  if (provider === 'anthropic') {
    let b = base;
    if (!/\/v\d+$/.test(b)) b = b + '/v1';
    return b + '/messages';
  }
  if (provider === 'gemini') {
    let b = base;
    if (/\/models$/.test(b)) b = b.replace(/\/models$/, '');
    if (!/\/v\d+(beta)?$/.test(b)) b = b + '/v1beta';
    const verb = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return b + '/models/' + encodeURIComponent(cfg.model) + ':' + verb;
  }
  // openai 兼容
  let b = base;
  if (!/\/v\d+$/.test(b) && !/\/chat\/completions$/.test(b)) {
    b = b + '/v1';
  }
  if (/\/chat\/completions$/.test(b)) return b;
  return b + '/chat/completions';
}

function buildChatRequest(cfg, messages, opts) {
  opts = opts || {};
  const provider = detectProvider(cfg);
  const tools = opts.tools || [];
  const stream = opts.stream !== false;
  const url = endpoint(cfg, provider, stream);
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'nailong-assistant/3.0' };
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
  let body;

  if (provider === 'anthropic') {
    headers['x-api-key'] = cfg.key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    body = {
      model: cfg.model,
      max_tokens: opts.maxTokens || cfg.maxTokens || DEFAULT_MAX_TOKENS,
      temperature: opts.temperature === undefined ? 0.2 : opts.temperature,
      messages: toAnthropicMessages(messages)
    };
    if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (tools.length) { body.tools = toAnthropicTools(tools); if (opts.toolChoice !== 'none') body.tool_choice = { type: 'auto' }; }
    if (stream) body.stream = true;
  } else if (provider === 'gemini') {
    headers['x-goog-api-key'] = cfg.key;
    body = {
      contents: toGeminiContents(messages),
      generationConfig: {
        temperature: opts.temperature === undefined ? 0.2 : opts.temperature,
        maxOutputTokens: opts.maxTokens || cfg.maxTokens || DEFAULT_MAX_TOKENS
      }
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const gt = toGeminiTools(tools);
    if (gt && opts.toolChoice !== 'none') body.tools = gt;
  } else {
    headers['Authorization'] = 'Bearer ' + cfg.key;
    body = {
      model: cfg.model,
      messages,
      temperature: opts.temperature === undefined ? 0.2 : opts.temperature,
      max_tokens: opts.maxTokens || cfg.maxTokens || DEFAULT_MAX_TOKENS
    };
    if (tools.length && opts.toolChoice !== 'none') {
      body.tools = toOpenAiTools(tools);
      body.tool_choice = 'auto';
    }
    if (stream) { body.stream = true; body.stream_options = { include_usage: true }; }
  }
  return { url, headers, body, provider, stream };
}

function buildModelsRequest(cfg) {
  const provider = detectProvider(cfg);
  const base = trimSlash(cfg.baseUrl);
  if (provider === 'anthropic') {
    let b = base;
    if (!/\/v\d+$/.test(b)) b = b + '/v1';
    return { url: b + '/models?limit=200', headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' }, provider };
  }
  if (provider === 'gemini') {
    let b = base;
    if (/\/models$/.test(b)) b = b.replace(/\/models$/, '');
    if (!/\/v\d+(beta)?$/.test(b)) b = b + '/v1beta';
    return { url: b + '/models?pageSize=200', headers: { 'x-goog-api-key': cfg.key }, provider };
  }
  let b = base;
  if (/\/chat\/completions$/.test(b)) b = b.replace(/\/chat\/completions$/, '');
  else if (!/\/v\d+$/.test(b)) b = b + '/v1';
  return { url: b + '/models', headers: { Authorization: 'Bearer ' + cfg.key }, provider };
}

function listModels(data, provider) {
  if (provider === 'gemini') {
    return (data && data.models ? data.models : [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => ({ ...m, contextWindow: m.inputTokenLimit, maxTokens: m.outputTokenLimit, id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || '' }));
  }
  return ((data && (data.data || data.models)) || []).map((m) => ({
    ...m,
    id: String(m.id || m.name || m.model || ''),
    name: String(m.display_name || m.displayName || m.name || '')
  })).filter((m) => m.id);
}

// ---------------------------------------------------------------- SSE 解析

/** 把 fetch Response 变成 SSE 事件流（自动处理跨 chunk 的行/多行 data） */
async function* sseEvents(res, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    for (;;) {
      if (signal && signal.aborted) { break; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '' || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        yield data;
      }
    }
  } finally {
    try { reader.cancel(); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- 流式事件归一

/** 创建一个「流式增量归并器」，逐块喂入后吐出统一事件 */
function createStreamParser(provider) {
  const state = {
    provider,
    text: '',
    toolCalls: [],           // {id, name, args}
    usage: null,
    finishReason: '',
    _byIndex: {},
    _geminiBuf: {}
  };

  function pushTool(delta) {
    const key = delta.index !== undefined ? String(delta.index) : (delta.id || ('n' + state.toolCalls.length));
    let slot = state._byIndex[key];
    if (!slot) {
      slot = { id: delta.id || 'call_' + state.toolCalls.length, name: delta.name || '', args: '' };
      state._byIndex[key] = slot;
      state.toolCalls.push(slot);
    }
    if (delta.id) slot.id = delta.id;
    if (delta.name) slot.name = delta.name;
    if (delta.args) slot.args += delta.args;
    return slot;
  }

  function handle(evt) {
    const out = [];
    if (provider === 'anthropic') {
      if (evt.type === 'content_block_start' && evt.content_block && evt.content_block.type === 'tool_use') {
        pushTool({ index: evt.index, id: evt.content_block.id, name: evt.content_block.name, args: '' });
      } else if (evt.type === 'content_block_delta' && evt.delta) {
        if (evt.delta.type === 'text_delta' && evt.delta.text) {
          state.text += evt.delta.text;
          out.push({ type: 'text', delta: evt.delta.text });
        } else if (evt.delta.type === 'input_json_delta') {
          pushTool({ index: evt.index, args: evt.delta.partial_json || '' });
        }
      } else if (evt.type === 'message_delta') {
        if (evt.delta && evt.delta.stop_reason) state.finishReason = evt.delta.stop_reason;
        if (evt.usage) state.usage = mergeUsage(state.usage, mapAnthropicUsage(evt.usage));
      } else if (evt.type === 'message_start' && evt.message && evt.message.usage) {
        state.usage = mergeUsage(state.usage, mapAnthropicUsage(evt.message.usage));
      } else if (evt.type === 'error') {
        out.push({ type: 'error', message: (evt.error && evt.error.message) || '上游返回错误' });
      }
      return out;
    }

    if (provider === 'gemini') {
      const cand = (evt.candidates || [])[0];
      if (!cand) {
        if (evt.usageMetadata) state.usage = mapGeminiUsage(evt.usageMetadata);
        if (evt.error) out.push({ type: 'error', message: evt.error.message || '上游返回错误' });
        return out;
      }
      if (cand.finishReason) state.finishReason = cand.finishReason;
      const parts = (cand.content && cand.content.parts) || [];
      parts.forEach((p) => {
        if (p.text) {
          state.text += p.text;
          out.push({ type: 'text', delta: p.text });
        } else if (p.functionCall) {
          const slot = pushTool({ name: p.functionCall.name, args: '' });
          slot.args = JSON.stringify(p.functionCall.args || {});
        }
      });
      if (evt.usageMetadata) state.usage = mapGeminiUsage(evt.usageMetadata);
      return out;
    }

    // openai
    if (evt.error) { out.push({ type: 'error', message: (evt.error && evt.error.message) || '上游返回错误' }); return out; }
    if (evt.usage) state.usage = { input: evt.usage.prompt_tokens, output: evt.usage.completion_tokens, total: evt.usage.total_tokens, cached: evt.usage.prompt_tokens_details && evt.usage.prompt_tokens_details.cached_tokens };
    const choice = (evt.choices || [])[0];
    if (!choice) return out;
    if (choice.finish_reason) state.finishReason = choice.finish_reason;
    const d = choice.delta || choice.message || {};
    if (typeof d.content === 'string' && d.content) {
      state.text += d.content;
      out.push({ type: 'text', delta: d.content });
    } else if (Array.isArray(d.content)) {
      d.content.forEach((part) => {
        if (part && part.type === 'text' && part.text) {
          state.text += part.text;
          out.push({ type: 'text', delta: part.text });
        }
      });
    }
    (d.tool_calls || []).forEach((tc) => {
      pushTool({
        index: tc.index === undefined ? tc.id : tc.index,
        id: tc.id,
        name: tc.function && tc.function.name,
        args: (tc.function && tc.function.arguments) || ''
      });
    });
    return out;
  }

  return {
    state,
    /** @returns {Array} 统一事件 */
    push(evt) { return handle(evt); },
    result() {
      return {
        content: state.text,
        toolCalls: state.toolCalls.filter((t) => t.name).map((t) => ({ id: t.id, name: t.name, args: t.args || '{}' })),
        usage: state.usage,
        finishReason: state.finishReason
      };
    }
  };
}

function mergeUsage(a, b) {
  const out = Object.assign({}, a || {});
  Object.keys(b || {}).forEach((k) => { if (b[k] !== undefined && b[k] !== null) out[k] = b[k]; });
  return out;
}

function mapAnthropicUsage(u) {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    total: (u.input_tokens || 0) + (u.output_tokens || 0),
    cached: u.cache_read_input_tokens
  };
}

function mapGeminiUsage(u) {
  return {
    input: u.promptTokenCount,
    output: u.candidatesTokenCount,
    total: u.totalTokenCount,
    cached: u.cachedContentTokenCount
  };
}

/** 非流式响应 → 统一结构 */
function parseFullResponse(provider, data) {
  if (provider === 'anthropic') {
    const content = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
    const toolCalls = (data.content || []).filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: JSON.stringify(b.input || {}) }));
    return {
      content, toolCalls, finishReason: data.stop_reason,
      usage: data.usage ? mapAnthropicUsage(data.usage) : null
    };
  }
  if (provider === 'gemini') {
    const cand = (data.candidates || [])[0] || {};
    const parts = (cand.content && cand.content.parts) || [];
    const content = parts.map((p) => p.text || '').join('');
    const toolCalls = parts.filter((p) => p.functionCall)
      .map((p, i) => ({ id: 'gemini_' + i, name: p.functionCall.name, args: JSON.stringify(p.functionCall.args || {}) }));
    return { content, toolCalls, finishReason: cand.finishReason, usage: data.usageMetadata ? mapGeminiUsage(data.usageMetadata) : null };
  }
  const msg = ((data.choices || [])[0] || {}).message || {};
  const toolCalls = (msg.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: (tc.function && tc.function.arguments) || '{}' }));
  return {
    content: typeof msg.content === 'string' ? msg.content : textOf(msg.content),
    toolCalls,
    finishReason: ((data.choices || [])[0] || {}).finish_reason,
    usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens, cached: data.usage.prompt_tokens_details && data.usage.prompt_tokens_details.cached_tokens } : null
  };
}

/** 把工具调用转成 OpenAI 形状的 assistant.tool_calls（供历史记录复用） */
function toolCallsToOpenAi(list) {
  return list.map((t) => ({
    id: t.id,
    type: 'function',
    function: { name: t.name, arguments: t.args && t.args.trim() ? t.args : '{}' }
  }));
}

module.exports = {
  DEFAULT_MAX_TOKENS,
  detectProvider,
  endpoint,
  buildChatRequest,
  buildModelsRequest,
  listModels,
  sseEvents,
  createStreamParser,
  parseFullResponse,
  toolCallsToOpenAi,
  toOpenAiTools,
  toAnthropicTools,
  toGeminiTools,
  toAnthropicMessages,
  toGeminiContents,
  sanitizeSchema,
  textOf,
  imagesOf
};
