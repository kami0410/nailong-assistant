'use strict';
/* pi 内核引擎：把 pi 当子进程跑（`pi --mode rpc`），事件归一成奶蛙助手窗认识的形状。
 *
 * 为什么用子进程而不是进程内 SDK：
 *   1. pi 崩了不会把桌宠一起带走
 *   2. Electron 的 Node ABI 与 pi 依赖彻底解耦
 *   3. 协议是官方一等公民（docs/rpc.md），升级时坏在哪一眼能看见
 *
 * 关键参数：--no-builtin-tools（不要 pi 的 read/bash/edit/write）+ --no-extensions（不要用户
 * 其它扩展来搅局）+ -e <奶蛙扩展>（只加载我们的手）。这样 pi 只剩一颗脑子。
 */

const path = require('path');
const { spawn } = require('child_process');

const P = require('../paths.js');

const START_TIMEOUT = 30000;
const COMMAND_TIMEOUT = 30000;

/** 行协议：只按 LF 切（U+2028/U+2029 在 JSON 字符串里是合法字符，不能用 readline） */
/**
 * 该用什么跑 pi 子进程：
 *   1. NAILONG_NODE 显式指定
 *   2. 在 Electron 里：用 electron.exe 但带上 ELECTRON_RUN_AS_NODE=1 ——
 *      不带这个变量的话 electron.exe 会当成「启动一个 Electron 应用」，
 *      于是子进程立刻以 code 0 退出（这个坑在审计里露过一次）。
 *   3. 纯 Node 环境（含单测）：直接 process.execPath
 */
function resolveRuntime() {
  if (process.env.NAILONG_NODE) return { exe: process.env.NAILONG_NODE, env: {} };
  if (process.versions.electron) return { exe: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { exe: process.execPath, env: {} };
}

function createLineReader(onRecord) {
  let buf = '';
  return function feed(chunk) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        onRecord(JSON.parse(line));
      } catch (e) {
        onRecord({ type: '__parse_error', raw: line.slice(0, 200) });
      }
    }
  };
}

function createPiEngine(deps) {
  const { bridge, log, services, emit } = deps;

  const state = {
    proc: null,
    ready: false,
    starting: null,
    nextId: 0,
    waiters: new Map(),        // id -> {resolve, reject, timer}
    stderrTail: [],
    sessionId: null,
    sessionFile: '',
    modelProvider: '',
    sessionName: '',
    model: '',
    thinkingLevel: '',
    streaming: false,
    usage: { input: 0, output: 0, total: 0, cached: 0, usd: 0, calls: 0 },
    startedAt: 0,
    lastError: '',
    lastAssistantText: '',
    abortRequested: false,
    toolCards: new Map()       // toolCallId -> 卡片信息（用于把执行结果补回去）
  };

  function cliPath() {
    // 1) 用户显式指定  2) 应用自带  3) PATH 上的全局安装
    if (process.env.NAILONG_PI_CLI) return process.env.NAILONG_PI_CLI;
    const bundled = path.join(P.piPkg, 'dist', 'bundle', 'cli.js');
    try { if (require('fs').existsSync(bundled)) return bundled; } catch (e) { /* ignore */ }
    return null;
  }

  function extensionPath() {
    return process.env.NAILONG_PI_EXT || path.join(P.piExt, 'nailong.mjs');
  }

  function buildArgs(opts) {
    const o = opts || {};
    const args = [
      '--mode', 'rpc',
      '--no-builtin-tools',   // 不要 pi 的 read/bash/edit/write，只留奶蛙的手
      '-e', extensionPath()
    ];
    // 默认不加载用户的其它扩展（MCP / 子代理 / 第三方代码）；设置里可以显式打开
    if (!o.loadUserExtensions) args.push('--no-extensions');
    // 这三项与扩展开关独立，默认都留给 pi 自己决定
    if (o.noMcp) args.push('--no-mcp');
    if (o.noSkills) args.push('--no-skills');
    if (o.noContextFiles) args.push('--no-context-files');
    (o.skillPaths || []).forEach((sp) => { if (sp) args.push('--skill', String(sp)); });
    if (o.sessionDir) args.push('--session-dir', o.sessionDir);
    if (o.noSession) args.push('--no-session');
    if (o.model) args.push('--model', o.model);
    if (o.thinking) args.push('--thinking', o.thinking);
    if (o.sessionFile && require('fs').existsSync(o.sessionFile)) args.push('--session', o.sessionFile);
    if (o.name) args.push('--name', o.name);
    return args;
  }

  function spawnProc(opts) {
    const cli = cliPath();
    const ext = extensionPath();
    if (!cli) throw new Error('找不到 pi（既没有 NAILONG_PI_CLI，也没有自带副本）');
    if (!require('fs').existsSync(ext)) throw new Error('找不到奶蛙的 pi 扩展：' + ext);
    const args = buildArgs(opts);
    const runtime = resolveRuntime();
    log.info('[pi] 启动：' + runtime.exe + ' ' + cli + ' ' + args.join(' '));
    const env = Object.assign({}, process.env, runtime.env, {
      NAILONG_BRIDGE: bridge.url,
      NAILONG_TOKEN: bridge.token,
      // 让 pi 的子进程也能识别出这是奶蛙在驱动
      NAILONG_HOST: 'nailong-assistant'
    });
    // agent 目录：bundled 模式指到应用自己的目录（干净、无代理、只认奶蛙的 provider）；
    // system 模式保持不设，让 pi 用它自己的 ~/.pi/agent。
    // 两种情况下都要先清掉从父进程继承来的值，否则会串台。
    delete env.PI_CODING_AGENT_DIR;
    if (opts && opts.agentDir) {
      env.PI_CODING_AGENT_DIR = String(opts.agentDir);
      log.info('[pi] agent 目录（应用自带）：' + opts.agentDir);
    } else {
      log.info('[pi] agent 目录：沿用机器上 pi 自己的配置');
    }
    const proc = spawn(runtime.exe, [cli].concat(args), {
      cwd: opts && opts.cwd ? opts.cwd : P.ROOT,
      env: env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    state.abortRequested = false;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    const feed = createLineReader(onRecord);
    proc.stdout.on('data', feed);
    proc.stderr.on('data', (d) => {
      const text = String(d);
      text.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        state.stderrTail.push(line);
        if (state.stderrTail.length > 60) state.stderrTail.shift();
      });
      // 奶蛙扩展自己的日志用 info 级别记下来，排查“工具怎么没注册上”最有用
      if (text.indexOf('[nailong]') >= 0) log.info('[pi] ' + text.trim().slice(0, 300));
      else log.debug('[pi] ' + text.trim().slice(0, 500));
      // 扩展或启动期的报错要浮上来，别静默
      if (/Error|失败|extension/i.test(text)) emit('agent-event', { type: 'status', text: text.trim().slice(0, 200) });
    });
    proc.on('error', (e) => {
      if (state.proc !== proc) return;
      state.ready = false;
      state.lastError = 'pi 进程启动失败：' + e.message;
      log.error('[pi] ' + state.lastError);
      failAllWaiters(new Error(state.lastError));
      emit('agent-event', { type: 'error', message: state.lastError });
    });
    proc.on('exit', (code, signal) => {
      log.info('[pi] 进程退出 code=' + code + ' signal=' + signal);
      if (state.proc !== proc) return;
      state.ready = false;
      state.streaming = false;
      state.proc = null;
      failAllWaiters(new Error('pi 进程已退出（code ' + code + '）'));
      if (state.abortRequested) { state.abortRequested = false; return; }
      if (code !== 0 && state.ready === false) {
        emit('agent-event', { type: 'error', message: 'pi 内核已退出：' + (state.stderrTail.slice(-3).join(' ') || ('code ' + code)) });
      }
    });
    state.proc = proc;
    return proc;
  }

  function failAllWaiters(err) {
    state.waiters.forEach((w) => { clearTimeout(w.timer); try { w.reject(err); } catch (e) { /* ignore */ } });
    state.waiters.clear();
  }

  function write(record) {
    if (!state.proc || !state.proc.stdin || !state.proc.stdin.writable) throw new Error('pi 内核没有在运行');
    state.proc.stdin.write(JSON.stringify(record) + '\n');
  }

  /** 发一条命令并等它的 response；带 id 关联（pi 不保证响应顺序） */
  function command(type, payload, timeoutMs) {
    const id = 'n' + (++state.nextId);
    const record = Object.assign({ id: id, type: type }, payload || {});
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.waiters.delete(id);
        reject(new Error('pi 命令超时（' + type + '）'));
      }, timeoutMs || COMMAND_TIMEOUT);
      if (timer.unref) timer.unref();
      state.waiters.set(id, { resolve: resolve, reject: reject, timer: timer });
      try { write(record); } catch (e) { clearTimeout(timer); state.waiters.delete(id); reject(e); }
    });
  }

  // ------------------------------------------------------------ 事件归一
  function onRecord(rec) {
    if (!rec || typeof rec !== 'object') return;
    if (deps.onRaw) { try { deps.onRaw(rec); } catch (e) { /* 调试钩子不能影响主流程 */ } }
    if (rec.type === '__parse_error') { log.warn('[pi] 收到无法解析的记录：' + rec.raw); return; }

    if (rec.type === 'response') {
      const w = rec.id ? state.waiters.get(rec.id) : null;
      if (w) {
        state.waiters.delete(rec.id);
        clearTimeout(w.timer);
        if (rec.success === false) w.reject(new Error(rec.error || 'pi 命令失败'));
        else w.resolve(rec.data === undefined ? {} : rec.data);
      }
      return;
    }

    if (rec.type === 'extension_ui_request') { handleUiRequest(rec); return; }

    switch (rec.type) {
      case 'message_update': {
        const ev = rec.assistantMessageEvent || {};
        if (ev.type === 'text_delta' && ev.delta) {
          emit('agent-event', { type: 'text', delta: ev.delta });
        } else if (ev.type === 'thinking_delta' && ev.delta) {
          emit('agent-event', { type: 'thinking', delta: ev.delta });
        } else if (ev.type === 'toolcall_end' && ev.toolCall) {
          // 参数拼完了，先把卡片立起来（执行开始时会再补一次）
          emit('agent-event', {
            type: 'tool-call',
            id: ev.toolCall.id || ('t' + state.nextId),
            name: ev.toolCall.name,
            args: safeParse(ev.toolCall.arguments)
          });
        }
        if (rec.usage) countUsage(rec.usage);
        break;
      }
      case 'tool_execution_start':
        state.toolCards.set(rec.toolCallId, { name: rec.toolName, args: rec.args, at: Date.now() });
        emit('agent-event', {
          type: 'tool-call', id: rec.toolCallId, name: rec.toolName, args: rec.args, running: true,
          parent: rec.parentToolCallId || ''   // 子代理里的嵌套调用，界面要缩进显示
        });
        break;
      case 'tool_execution_end': {
        const card = state.toolCards.get(rec.toolCallId) || {};
        state.toolCards.delete(rec.toolCallId);
        emit('agent-event', {
          type: 'tool-result',
          id: rec.toolCallId,
          parent: rec.parentToolCallId || card.parent || '',
          name: rec.toolName || card.name,
          ok: !rec.isError && !(rec.result && rec.result.details && rec.result.details.ok === false),
          ms: rec.durationMs || (card.at ? Date.now() - card.at : 0),
          text: resultText(rec.result),
          images: resultImages(rec.result)
        });
        break;
      }
      case 'agent_start':
        state.streaming = true;
        emit('agent-event', { type: 'status', text: '思考中…' });
        break;
      case 'agent_end':
        // 注意：agent_end 之后还可能有自动重试/排队/压缩，真正结束看 agent_settled
        break;
      case 'agent_settled': {
        state.streaming = false;
        const reply = state.lastAssistantText || '';
        emit('agent-event', { type: 'done', reply: reply, aborted: !!rec.aborted });
        if (!reply && !rec.aborted) {
          emit('agent-event', { type: 'status', text: state.lastError ? ('没拿到回复：' + state.lastError) : '这一轮没有产生文本输出' });
        }
        state.lastAssistantText = '';
        break;
      }
      case 'message_end': {
        const m = rec.message || {};
        if (m.role === 'assistant') {
          const text = messageText(m);
          if (text) state.lastAssistantText = text;
          // 模型侧的拒绝/限流/超时只会出现在这里。
          // 先只记下来 —— pi 会自动重试，逐次报错会把界面刷成一片红，等 auto_retry_end 落定再说。
          if (m.stopReason === 'error' && m.errorMessage) state.lastError = String(m.errorMessage);
          else if (m.stopReason === 'aborted') emit('agent-event', { type: 'status', text: '已中止' });
        }
        break;
      }
      case 'auto_retry_start':
        state.lastError = rec.errorMessage || state.lastError;
        emit('agent-event', { type: 'status', text: '模型请求失败（' + String(rec.errorMessage || '').slice(0, 80) + '），' + (rec.attempt || 1) + '/' + (rec.maxAttempts || '?') + ' 次重试…' });
        break;
      case 'auto_retry_end':
        if (rec.success === false) {
          const msg = String(rec.finalError || state.lastError || '模型请求最终失败');
          state.lastError = msg;
          emit('agent-event', { type: 'error', message: msg });
        } else {
          emit('agent-event', { type: 'status', text: '重试成功' });
        }
        break;
      case 'session_info_changed':
        state.sessionName = rec.name || '';
        emit('agent-session', { id: state.sessionId, title: state.sessionName });
        break;
      case 'thinking_level_changed':
        state.thinkingLevel = rec.level || '';
        break;
      case 'model_select':
        state.model = typeof rec.model === 'object' ? rec.model.id || state.model : rec.model || state.model;
        if (rec.model && rec.model.provider) state.modelProvider = rec.model.provider;
        break;
      case 'queue_update':
        break;
      default:
        log.debug('[pi] 未处理的事件类型：' + rec.type);
    }
  }

  function safeParse(s) {
    if (s === undefined || s === null) return {};
    if (typeof s === 'object') return s;
    try { return JSON.parse(String(s)); } catch (e) { return { raw: String(s).slice(0, 200) }; }
  }

  function messageText(m) {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => (p && p.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
    return '';
  }

  function resultText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    const content = result.content || [];
    return content.map((p) => (p && p.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
  }

  function resultImages(result) {
    if (!result || !Array.isArray(result.content)) return [];
    return result.content
      .filter((p) => p && p.type === 'image' && p.data)
      .map((p) => 'data:' + (p.mimeType || 'image/png') + ';base64,' + p.data);
  }

  function countUsage(u) {
    const input = u.input || u.promptTokens || 0;
    const output = u.output || u.completionTokens || 0;
    state.usage.input += input;
    state.usage.output += output;
    state.usage.total += (u.totalTokens || input + output);
    state.usage.cached += (u.cacheRead || 0);
    state.usage.calls += 1;
    emit('agent-usage', state.usage);
  }

  /** pi 的扩展 UI 请求 → 奶蛙的确认条 / 通知 */
  function handleUiRequest(rec) {
    const id = rec.id;
    const kind = rec.kind || rec.method || '';
    log.debug('[pi] extension_ui_request：' + kind);
    if (kind === 'notify' || kind === 'status') {
      emit('agent-event', { type: 'status', text: String(rec.message || rec.text || '') });
      if (kind === 'notify') services.notify.show('奶蛙助手', String(rec.message || rec.text || ''));
      write({ type: 'extension_ui_response', id: id, cancelled: true });
      return;
    }
    // 需要用户选：默认取消，避免 pi 卡住；后续可映射成我们的选择器
    write({ type: 'extension_ui_response', id: id, cancelled: true });
  }

  // ------------------------------------------------------------ 生命周期
  function start(opts) {
    if (state.ready) return Promise.resolve(true);
    if (state.starting) return state.starting;
    state.lastError = '';
    state.starting = new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawnProc(Object.assign({ sessionDir: path.join(P.userData, 'pi-sessions') }, opts || {}));
      } catch (e) {
        state.starting = null;
        reject(e);
        return;
      }
      const timer = setTimeout(() => {
        if (state.proc === proc) state.starting = null;
        reject(new Error('pi 内核启动超时'));
      }, START_TIMEOUT);
      const check = () => {
        if (state.proc !== proc) { clearTimeout(timer); reject(new Error('pi 内核启动失败')); return; }
        command('get_state', {}, 8000).then((data) => {
          clearTimeout(timer);
          if (state.proc !== proc) { reject(new Error('pi 内核启动已中止')); return; }
          state.ready = true;
          state.starting = null;
          state.sessionId = data.sessionId || null;
          state.sessionFile = data.sessionFile || '';
          state.modelProvider = data.model && data.model.provider || '';
          state.sessionName = data.sessionName || '';
          const mid = data.model ? String(data.model.id || data.model.name || '') : '';
          // pi 在没有可用模型时会给个占位值 'unknown'，不要把它当成模型名显示给用户
          state.model = (mid && mid !== 'unknown') ? mid : '';
          state.thinkingLevel = data.thinkingLevel || '';
          log.info('[pi] 内核就绪，session=' + state.sessionId + ' model=' + state.model);
          resolve(true);
        }).catch((e) => {
          clearTimeout(timer);
          if (state.proc === proc) state.starting = null;
          reject(new Error('pi 内核握手失败：' + e.message + '｜stderr: ' + state.stderrTail.slice(-3).join(' ')));
        });
      };
      setTimeout(check, 1200);
    });
    return state.starting;
  }

  function stop() {
    if (!state.proc) return true;
    state.abortRequested = true;
    try { state.proc.stdin.end(); } catch (e) { /* ignore */ }
    const proc = state.proc;
    setTimeout(() => { try { if (proc && !proc.killed) proc.kill(); } catch (e) { /* ignore */ } }, 1500);
    state.proc = null;
    state.ready = false;
    state.starting = null;
    failAllWaiters(new Error('pi 内核已停止'));
    return true;
  }

  async function ensure() {
    if (state.ready) return true;
    await start();
    return true;
  }

  // ------------------------------------------------------------ 对外接口
  async function send(text, opts) {
    await ensure();
    const o = opts || {};
    if (o.auto) await command('set_steering_mode', { mode: 'all' }).catch(() => {});
    state.lastAssistantText = '';
    const payload = { message: String(text || '') };
    // 正在跑的时候再发一句：必须告诉 pi 这句是“插入当前任务”还是“排在后面”
    // （否则 pi 会直接拒掉）
    if (state.streaming) payload.streamingBehavior = o.mode === 'followUp' ? 'followUp' : 'steer';
    const res = await command('prompt', payload, 60000);
    return { ok: true, disposition: res && res.disposition, steered: !!payload.streamingBehavior };
  }

  async function abort() {
    try { await command('clear_queue', {}, 15000); } catch (e) { log.warn('[pi] 清空排队任务失败：' + e.message); }
    try { await command('abort', {}, 15000); } catch (e) { log.warn('[pi] abort 失败：' + e.message); }
    return true;
  }

  async function status() {
    if (!state.ready) return { ready: false, starting: !!state.starting, error: state.lastError };
    try {
      const s = await command('get_state', {}, 10000);
      state.sessionFile = s.sessionFile || state.sessionFile;
      state.sessionId = s.sessionId || state.sessionId;
      state.sessionName = s.sessionName || '';
      state.modelProvider = s.model && s.model.provider || '';
      state.model = s.model && s.model.id || '';
      state.thinkingLevel = s.thinkingLevel || 'off';
      const mid = s.model ? String(s.model.id || s.model.name || '') : '';
      return {
        ready: true,
        sessionId: s.sessionId,
        sessionName: s.sessionName || '',
        model: (mid && mid !== 'unknown') ? mid : '',
        thinkingLevel: s.thinkingLevel || '',
        streaming: !!s.isStreaming,
        messageCount: s.messageCount || 0,
        usage: state.usage
      };
    } catch (e) {
      return { ready: false, error: e.message };
    }
  }
  async function stats() {
    if (!state.ready) return null;
    try { return await command('get_session_stats', {}, 15000); } catch (e) { return null; }
  }

  // ------------------------------------------------------------ 模型 / 思考档位
  async function models() {
    await ensure();
    const d = await command('get_available_models', {}, 25000);
    const list = d && d.models ? d.models : (Array.isArray(d) ? d : []);
    return list.map((m) => ({
      id: m.id || '',
      name: m.name || m.id || '',
      provider: m.provider || '',
      reasoning: !!m.reasoning,
      contextWindow: m.contextWindow || 0,
      maxTokens: m.maxTokens || 0,
      input: m.input || []
    })).filter((m) => m.id);
  }

  async function setModel(provider, modelId) {
    await ensure();
    const d = await command('set_model', { provider: provider, modelId: modelId }, 25000);
    const actual = await command('get_state', {}, 10000);
    state.model = actual.model && actual.model.id || modelId;
    state.modelProvider = actual.model && actual.model.provider || provider;
    state.thinkingLevel = actual.thinkingLevel || 'off';
    emit('agent-thinking', { level: state.thinkingLevel });
    emit('agent-model', { id: state.model, provider: provider });
    return d;
  }

  async function cycleModel() {
    await ensure();
    const d = await command('cycle_model', {}, 25000);
    if (d && d.model) {
      state.model = d.model.id || state.model;
      state.thinkingLevel = d.thinkingLevel || state.thinkingLevel;
      emit('agent-model', { id: state.model, provider: d.model.provider || '' });
      emit('agent-thinking', { level: state.thinkingLevel });
    }
    return d;
  }

  async function thinkingLevels() {
    await ensure();
    const d = await command('get_available_thinking_levels', {}, 15000);
    return (d && d.levels) || ['off'];
  }

  async function setThinking(level) {
    await ensure();
    await command('set_thinking_level', { level: level }, 15000);
    const actual = await command('get_state', {}, 10000);
    state.thinkingLevel = actual.thinkingLevel || 'off';
    emit('agent-thinking', { level: state.thinkingLevel });
    return state.thinkingLevel;
  }

  // ------------------------------------------------------------ 上下文 / 重试
  async function compact(customInstructions) {
    await ensure();
    emit('agent-event', { type: 'status', text: '正在压缩上下文…' });
    const d = await command('compact', customInstructions ? { customInstructions: customInstructions } : {}, 180000);
    emit('agent-event', { type: 'status', text: '上下文已压缩' + (d && d.tokensBefore ? '（' + d.tokensBefore + ' → ' + d.estimatedTokensAfter + ' tokens）' : '') });
    return d;
  }

  async function setAutoCompaction(enabled) {
    await ensure();
    await command('set_auto_compaction', { enabled: !!enabled }, 15000);
    return !!enabled;
  }

  async function setAutoRetry(enabled) {
    await ensure();
    await command('set_auto_retry', { enabled: !!enabled }, 15000);
    return !!enabled;
  }

  // ------------------------------------------------------------ 会话树 / 分支
  async function commands() {
    await ensure();
    const d = await command('get_commands', {}, 20000);
    return (d && d.commands) || [];
  }

  async function messages() {
    await ensure();
    const d = await command('get_messages', {}, 30000);
    return (d && d.messages) || [];
  }

  async function tree() {
    await ensure();
    const d = await command('get_tree', {}, 20000) || {};
    return { tree: d.tree || [], leafId: d.leafId || '' };
  }

  async function clone() {
    await ensure();
    const d = await command('clone', {}, 20000);
    return d || {};
  }

  async function fork(entryId) {
    await ensure();
    const d = await command('fork', { entryId: entryId }, 20000);
    return d || {};
  }

  /** 可以在这里开分支的那几条用户消息 */
  async function forkMessages() {
    await ensure();
    const d = await command('get_fork_messages', {}, 20000);
    return (d && d.messages) || [];
  }

  async function rename(name) {
    await ensure();
    await command('set_session_name', { name: String(name || '') }, 15000);
    state.sessionName = String(name || '');
    return true;
  }

  async function newSession(name) {
    await ensure();
    const data = await command('new_session', name ? { name: name } : {}, 20000);
    state.sessionId = data && data.sessionId ? data.sessionId : state.sessionId;
    state.sessionName = (name || '');
    return data;
  }

  async function setModelLegacy(model) {
    return setModel('', model);
  }

  return {
    // 元信息
    get ready() { return state.ready; },
    get starting() { return !!state.starting; },
    get sessionId() { return state.sessionId; },
    get sessionName() { return state.sessionName; },
    get model() { return state.model; },
    get thinkingLevel() { return state.thinkingLevel; },
    get streaming() { return state.streaming; },
    get usage() { return state.usage; },
    get stderrTail() { return state.stderrTail.slice(); },
    get lastError() { return state.lastError; },
    cliPath, extensionPath, buildArgs, state, handleRecord: onRecord, resolveRuntime,
    // 生命周期
    start, stop, ensure, status,
    // 对话
    send, abort, stats, newSession,
    // 模型 / 思考
    models, setModel, setModelLegacy, cycleModel, thinkingLevels, setThinking,
    // 上下文
    compact, setAutoCompaction, setAutoRetry,
    // 会话
    commands, messages, tree, clone, fork, forkMessages, rename,
    command
  };
}

// 导出给测试用
createPiEngine.createLineReader = createLineReader;

module.exports = { createPiEngine, createLineReader };
