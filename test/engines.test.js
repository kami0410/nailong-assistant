'use strict';
/* pi 内核接入层的测试
 *
 * 分三层：
 *   1. 桥：鉴权、工具代理、权限拦截（真起一个 http 服务，不桩）
 *   2. pi 引擎：命令行参数、事件归一、行协议边界（喂假的记录，不起进程）
 *   3. 端到端：真起 pi 子进程 + 真桥，验证扩展加载与工具注册（机器上没有 pi 就跳过）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const { createBridge } = require(path.join(SRC, 'main', 'engines', 'bridge.js'));
const { createPiEngine, createLineReader } = require(path.join(SRC, 'main', 'engines', 'pi.js'));
const { piMessagesToTranscript, piStatsToUsage } = require(path.join(SRC, 'main', 'engines', 'pi-history.js'));
const { createTools } = require(path.join(SRC, 'main', 'tools', 'index.js'));

// ------------------------------------------------------------------ 通用桩
function stubHost() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-pi-'));
  const shell = [];
  return {
    paths: { root: path.join(dir, 'app'), home: dir, desktop: path.join(dir, 'Desktop'), downloads: '', documents: '' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    lastShot: () => ({ physW: 1920, physH: 1080, sentW: 960, sentH: 540 }),
    screenshot: async () => ({ dataUrl: 'data:image/jpeg;base64,QUJD', physW: 1920, physH: 1080, sentW: 960, sentH: 540 }),
    afterShot: async () => [],
    pause: async () => {},
    input: (c) => shell.push(c),
    uiTree: async () => ({ window: 'w', count: 0, nodes: [] }),
    findElement: async () => [],
    elementAction: async () => ({ invoked: true }),
    windowControl: async () => ({}),
    windowList: async () => [],
    screenInfo: async () => ({ screens: [], scale: 1, cursor: { x: 0, y: 0 }, foreground: null, windows: [] }),
    systemInfo: async () => ({}),
    runCommand: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
    launch: async () => true,
    recycle: async () => ({ ok: 1, fail: 0, err: '' }),
    guardPath: () => ({ ok: true }),
    b64utf8: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
    readImageFile: () => ({ ok: true, dataUrl: 'data:image/png;base64,QUJD', width: 10, height: 10, scaled: false, mime: 'image/png', bytes: 3 }),
    clipboard: { read: () => '', write: () => {} },
    services: {
      schedule: { tasks: () => [], doneMap: () => ({}), add: (t) => t, remove: () => 1, toggleDone: () => ({}), progress: () => ({ total: 0, done: 0, pct: 0 }) },
      countdown: { list: () => [], add: () => [] },
      focus: { start: () => ({}), status: () => ({ phase: 'idle', remainMs: 0, config: {} }), stop: () => ({}) },
      stats: { today: () => ({ focusCount: 0, focusMinutes: 0, tasksDone: 0, tasksTotal: 0, streak: 0 }), range: () => ({ summary: { rate: 0, activeDays: 0, doneItems: 0, totalItems: 0 }, streak: 0, longest: 0, tags: [], hours: new Array(24).fill(0), focusCount: 0, focusMinutes: 0 }) },
      memory: { add: () => [], search: () => [] },
      clipboard: { history: () => [] },
      notify: { show: () => {} }
    },
    _shell: shell, _dir: dir
  };
}

function httpJson(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token !== undefined) headers['x-nailong-token'] = token;
  return fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

// ------------------------------------------------------------------ 1. 桥
test('bridge: 没有 token 一律 401', async () => {
  const host = stubHost();
  const tools = createTools(host);
  const b = createBridge({ host, toolset: tools, services: host.services, log: host.log, getPolicy: () => ({ mode: 'auto' }), askUser: async () => 'exec' });
  await b.start();
  try {
    const noToken = await httpJson(b.url + '/health');
    assert.equal(noToken.status, 401);
    const badToken = await httpJson(b.url + '/health', undefined, 'x'.repeat(48));
    assert.equal(badToken.status, 401);
    const ok = await httpJson(b.url + '/health', undefined, b.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.ok(ok.body.tools > 30, '工具数应该 >= 31，实际 ' + ok.body.tools);
  } finally { b.stop(); }
});

test('bridge: /catalog 提供给 pi 注册工具，schema 原样透传', async () => {
  const host = stubHost();
  const b = createBridge({ host, toolset: createTools(host), services: host.services, log: host.log, getPolicy: () => ({ mode: 'auto' }) });
  await b.start();
  try {
    const r = await httpJson(b.url + '/catalog', undefined, b.token);
    const names = r.body.tools.map((t) => t.name);
    for (const need of ['screenshot', 'ui_tree', 'click_element', 'read_file', 'run_command', 'schedule_add']) {
      assert.ok(names.indexOf(need) >= 0, '工具清单里应有 ' + need);
    }
    const click = r.body.tools.find((t) => t.name === 'click');
    assert.equal(click.parameters.type, 'object');
    assert.ok(click.parameters.required.indexOf('x') >= 0);
    assert.ok(click.promptSnippet.length > 0);
  } finally { b.stop(); }
});

test('bridge: /tool 真的执行工具并回传结果与图片', async () => {
  const host = stubHost();
  const b = createBridge({ host, toolset: createTools(host), services: host.services, log: host.log, getPolicy: () => ({ mode: 'auto' }) });
  await b.start();
  try {
    const shot = await httpJson(b.url + '/tool', { name: 'screenshot', args: {} }, b.token);
    assert.equal(shot.body.ok, true);
    assert.equal(shot.body.images.length, 1);
    assert.ok(shot.body.text.indexOf('截图') >= 0);

    const click = await httpJson(b.url + '/tool', { name: 'click', args: { x: 480, y: 270 } }, b.token);
    assert.equal(click.body.ok, true);
    assert.deepEqual(host._shell, ['click 960 540'], '截图宽 960 → 物理宽 1920，系数 2');

    const unknown = await httpJson(b.url + '/tool', { name: '不存在的工具', args: {} }, b.token);
    assert.equal(unknown.body.ok, false);
  } finally { b.stop(); }
});

test('bridge: 权限是同一份实现，确认模式下会真的问用户，跳过就不执行', async () => {
  const host = stubHost();
  const asked = [];
  const b = createBridge({
    host, toolset: createTools(host), services: host.services, log: host.log,
    getPolicy: () => ({ mode: 'confirm' }),
    askUser: async (req) => { asked.push(req); return 'skip'; }
  });
  await b.start();
  try {
    // 只读工具直接放行
    const tree = await httpJson(b.url + '/tool', { name: 'ui_tree', args: {} }, b.token);
    assert.equal(tree.body.ok, true);
    assert.equal(asked.length, 0, '只读工具不该打扰用户');

    // 中危工具要先问，用户跳过后不能真的点下去
    const click = await httpJson(b.url + '/tool', { name: 'click', args: { x: 10, y: 10 } }, b.token);
    assert.equal(click.body.skipped, true);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].tool, 'click');
    assert.deepEqual(host._shell, [], '被跳过就不能有输入模拟');

    // 危险命令硬拦截，连问都不问
    const danger = await httpJson(b.url + '/tool', { name: 'run_command', args: { command: 'format c:' } }, b.token);
    assert.equal(danger.body.ok, false);
    assert.ok(danger.body.text.indexOf('拦下') >= 0);
    assert.equal(asked.length, 1, '硬拦截不该弹确认');
  } finally { b.stop(); }
});

test('bridge: 中止会把挂着的确认一起否掉', async () => {
  const host = stubHost();
  const b = createBridge({
    host, toolset: createTools(host), services: host.services, log: host.log,
    getPolicy: () => ({ mode: 'confirm' }),
    askUser: () => new Promise(() => {})   // 永远不回答，模拟用户离开
  });
  await b.start();
  try {
    const p = httpJson(b.url + '/tool', { name: 'click', args: { x: 1, y: 1 } }, b.token);
    await new Promise((r) => setTimeout(r, 200));
    b.cancelPending();
    const r = await p;
    assert.equal(r.body.skipped, true, '中止后必须返回，不能悬着');
  } finally { b.stop(); }
});

// ------------------------------------------------------------------ 2. pi 引擎
test('pi: 行协议只按 LF 切，U+2028 不能当分隔符', () => {
  const got = [];
  const feed = createLineReader((r) => got.push(r));
  feed('{"a":1}\n{"b":"前\u2028后"}\r\n');
  feed('{"c":3}');
  feed('\n');
  assert.equal(got.length, 3);
  assert.equal(got[1].b, '前\u2028后');
  assert.equal(got[2].c, 3);
});

test('pi: 启动参数把 pi 削成「只有脑子」', () => {
  const host = stubHost();
  const bridge = { url: 'http://127.0.0.1:1', token: 't' };
  const engine = createPiEngine({ bridge, log: host.log, services: host.services, emit: () => {} });
  const args = engine.buildArgs({ sessionDir: 'D:/x', model: 'nailong/gpt-4o' });
  assert.ok(args.indexOf('--mode') >= 0 && args[args.indexOf('--mode') + 1] === 'rpc');
  assert.ok(args.indexOf('--no-builtin-tools') >= 0, '必须关掉 pi 自带的 read/bash/edit/write');
  assert.ok(args.indexOf('--no-extensions') >= 0, '默认要关掉用户的其它扩展');
  const ei = args.indexOf('-e');
  assert.ok(ei > 0 && args[ei + 1].endsWith('nailong.mjs'), '必须显式加载奶蛙扩展');
  assert.ok(args.indexOf('--session-dir') >= 0);
  assert.ok(args.indexOf('--model') >= 0);
});

test('pi: 打开「加载用户扩展」后不再传 --no-extensions（MCP/子代理才可用）', () => {
  const host = stubHost();
  const engine = createPiEngine({ bridge: { url: '', token: '' }, log: host.log, services: host.services, emit: () => {} });
  const off = engine.buildArgs({ loadUserExtensions: false });
  const on = engine.buildArgs({ loadUserExtensions: true });
  assert.ok(off.indexOf('--no-extensions') >= 0);
  assert.ok(on.indexOf('--no-extensions') < 0, '开启后要去掉这个开关');
  assert.ok(on.indexOf('-e') > 0, '但我们自己的扩展始终显式加载');
});

test('pi: 运行时优先 ELECTRON_RUN_AS_NODE（在 Electron 里必须）', () => {
  const host = stubHost();
  const engine = createPiEngine({ bridge: { url: '', token: '' }, log: host.log, services: host.services, emit: () => {} });
  const rt = engine.resolveRuntime();
  assert.ok(rt.exe);
  if (process.versions.electron) assert.equal(rt.env.ELECTRON_RUN_AS_NODE, '1');
});

test('pi: 模型/档位/压缩等命令都打到正确的 RPC 命令上', async () => {
  const host = stubHost();
  const engine = createPiEngine({ bridge: { url: '', token: '' }, log: host.log, services: host.services, emit: () => {} });
  const sent = [];
  engine.state.proc = { stdin: { writable: true, write: (s) => sent.push(JSON.parse(s)) }, killed: false };
  engine.state.ready = true;

  const reply = (command, data) => ({ type: 'response', command: command, success: true, data: data, id: null });
  const answer = (fn) => {
    setTimeout(() => {
      const last = sent[sent.length - 1];
      engine.handleRecord(Object.assign(reply(last.type, fn ? fn() : {}), { id: last.id }));
    }, 5);
  };

  let p = engine.setModel('anthropic', 'claude-sonnet-4');
  answer(() => ({ id: 'claude-sonnet-4' }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sent[0].type, 'set_model');
  assert.equal(sent[sent.length - 1].type, 'get_state');
  answer(() => ({ model: { id: 'claude-sonnet-4', provider: 'anthropic' }, thinkingLevel: 'off' }));
  await p;
  assert.deepEqual({ provider: sent[0].provider, modelId: sent[0].modelId }, { provider: 'anthropic', modelId: 'claude-sonnet-4' });

  p = engine.setThinking('high');
  answer();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sent.at(-2).type, 'set_thinking_level');
  assert.equal(sent.at(-2).level, 'high');
  answer(() => ({ thinkingLevel: 'high' }));
  assert.equal(await p, 'high');

  p = engine.thinkingLevels();
  answer(() => ({ levels: ['off', 'low', 'high'] }));
  assert.deepEqual(await p, ['off', 'low', 'high']);

  p = engine.compact('重点保留日程');
  answer(() => ({ tokensBefore: 90000, estimatedTokensAfter: 20000 }));
  await p;
  assert.equal(sent[sent.length - 1].type, 'compact');
  assert.equal(sent[sent.length - 1].customInstructions, '重点保留日程');

  p = engine.setAutoCompaction(false);
  answer();
  await p;
  assert.equal(sent[sent.length - 1].type, 'set_auto_compaction');
  assert.equal(sent[sent.length - 1].enabled, false);

  p = engine.setAutoRetry(true);
  answer();
  await p;
  assert.equal(sent[sent.length - 1].type, 'set_auto_retry');

  p = engine.clone();
  answer(() => ({ cancelled: false }));
  await p;
  assert.equal(sent[sent.length - 1].type, 'clone');

  p = engine.fork('entry-1');
  answer(() => ({ text: '原来的话' }));
  await p;
  assert.equal(sent[sent.length - 1].type, 'fork');
  assert.equal(sent[sent.length - 1].entryId, 'entry-1');

  p = engine.rename('给会话起个名');
  answer();
  await p;
  assert.equal(sent[sent.length - 1].type, 'set_session_name');
  assert.equal(sent[sent.length - 1].name, '给会话起个名');
});

test('pi-history: 历史转录能还原成对话条目，工具结果回填到对应调用', () => {
  const ts = piMessagesToTranscript([
    { role: 'user', content: '看看屏幕上有什么' },
    { role: 'user', content: [{ type: 'text', text: '（这是上一步操作后的最新截图）' }, { type: 'image', data: 'AA', mimeType: 'image/jpeg' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先截个屏' },
        { type: 'text', text: '好的，我看一下' },
        { type: 'toolCall', id: 'c1', name: 'screenshot', arguments: {} },
        { type: 'toolCall', id: 'c2', name: 'ui_tree', arguments: { depth: 3 } }
      ]
    },
    { role: 'toolResult', toolCallId: 'c1', toolName: 'screenshot', isError: false, content: [{ type: 'text', text: '截图成功' }, { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }] },
    { role: 'toolResult', toolCallId: 'c2', toolName: 'ui_tree', isError: true, content: [{ type: 'text', text: '窗口没找到' }] },
    { role: 'compactionSummary', summary: '前面聊了截图的事' },
    { role: 'bashExecution', command: 'ls', output: 'x' }
  ]);

  const kinds = ts.map((e) => e.kind);
  assert.deepEqual(kinds, ['user', 'assistant', 'tool', 'tool', 'note'], '工具回填后不应多出独立条目：' + JSON.stringify(kinds));
  assert.equal(ts[0].text, '看看屏幕上有什么');
  assert.ok(!ts.some((e) => e.kind === 'user' && e.text.indexOf('最新截图') >= 0), '自己塞回去的截图说明不该进历史');
  assert.equal(ts[1].thinking, '先截个屏');
  assert.equal(ts[2].name, 'screenshot');
  assert.equal(ts[2].ok, true);
  assert.equal(ts[2].text, '截图成功');
  assert.deepEqual(ts[2].images, ['data:image/jpeg;base64,QUJD']);
  assert.equal(ts[3].name, 'ui_tree');
  assert.equal(ts[3].ok, false, '失败的调用要标出来');
  assert.deepEqual(ts[3].args, { depth: 3 });
  assert.ok(ts[4].text.indexOf('压缩') >= 0);
});

test('pi-history: 缺结果、缺 id 的边界情况不崩', () => {
  const ts = piMessagesToTranscript([
    { role: 'assistant', content: [{ type: 'toolCall', name: 'x', arguments: '不是 JSON' }] },
    { role: 'toolResult', toolCallId: '孤儿', toolName: 'y', isError: false, content: [{ type: 'text', text: 'r' }] }
  ]);
  assert.equal(ts.length, 2, 'assistant 没有文本块就不该产生空气泡，只应剩两个工具条目');
  assert.equal(ts[0].kind, 'tool');
  assert.ok(ts[0].args.raw, '坏 JSON 要能兜住');
  assert.equal(ts[1].kind, 'tool');
  assert.equal(ts[1].name, 'y');
});

test('pi-history: 会话统计转成界面用量', () => {
  const u = piStatsToUsage({
    assistantMessages: 7, toolCalls: 12, cost: 0.42,
    tokens: { input: 1000, output: 200, total: 1200, cacheRead: 300 },
    contextUsage: { tokens: 1000, contextWindow: 128000, percent: 1 }
  });
  assert.equal(u.calls, 7);
  assert.equal(u.cached, 300);
  assert.equal(u.usd, 0.42);
  assert.equal(u.context.percent, 1);
  assert.equal(piStatsToUsage(null), null);
});

test('pi: 事件归一成助手窗认识的形状', () => {
  const host = stubHost();
  const events = [];
  const engine = createPiEngine({
    bridge: { url: '', token: '' }, log: host.log, services: host.services,
    emit: (ch, payload) => events.push({ ch, payload })
  });
  const rec = engine.handleRecord;

  rec({ type: 'agent_start' });
  rec({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '好' }, usage: { input: 10, output: 2, totalTokens: 12 } });
  rec({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '的' } });
  rec({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '嗯…' } });
  rec({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'screenshot', args: {} });
  rec({
    type: 'tool_execution_end', toolCallId: 'c1', toolName: 'screenshot', isError: false, durationMs: 120,
    result: { content: [{ type: 'text', text: '截图成功' }, { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }] }
  });
  rec({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } });
  rec({ type: 'agent_settled', aborted: false });

  const agentEvents = events.filter((e) => e.ch === 'agent-event').map((e) => e.payload);
  assert.equal(agentEvents.filter((e) => e.type === 'text').map((e) => e.delta).join(''), '好的');
  assert.ok(agentEvents.some((e) => e.type === 'thinking' && e.delta === '嗯…'));
  assert.ok(agentEvents.some((e) => e.type === 'tool-call' && e.name === 'screenshot'));
  const tr = agentEvents.find((e) => e.type === 'tool-result');
  assert.equal(tr.ok, true);
  assert.equal(tr.text, '截图成功');
  assert.deepEqual(tr.images, ['data:image/jpeg;base64,QUJD'], '工具返回的图片要能显示在对话里');
  assert.equal(tr.ms, 120);
  const done = agentEvents.find((e) => e.type === 'done');
  assert.equal(done.reply, '好的');
  assert.ok(events.some((e) => e.ch === 'agent-usage' && e.payload.input === 10));
});

test('pi: 请求-响应按 id 关联，不靠顺序', async () => {
  const host = stubHost();
  const engine = createPiEngine({ bridge: { url: '', token: '' }, log: host.log, services: host.services, emit: () => {} });
  // 假装子进程还活着，把 stdin 收集起来
  const written = [];
  engine.state.proc = { stdin: { writable: true, write: (s) => written.push(JSON.parse(s)) }, killed: false };
  const p = engine.command('get_state', {});
  assert.equal(written[0].type, 'get_state');
  assert.ok(written[0].id);
  // 先回一个不相干的响应，再回真正的那个
  engine.handleRecord({ type: 'response', command: 'other', success: true, id: 'nope' });
  engine.handleRecord({ type: 'response', command: 'get_state', success: true, id: written[0].id, data: { sessionId: 's1' } });
  const data = await p;
  assert.equal(data.sessionId, 's1');
});

test('pi: 命令失败会 reject，不会静默吞掉', async () => {
  const host = stubHost();
  const engine = createPiEngine({ bridge: { url: '', token: '' }, log: host.log, services: host.services, emit: () => {} });
  const written = [];
  engine.state.proc = { stdin: { writable: true, write: (s) => written.push(JSON.parse(s)) }, killed: false };
  const p = engine.command('set_model', { model: 'x' });
  engine.handleRecord({ type: 'response', command: 'set_model', success: false, error: 'Model not found', id: written[0].id });
  await assert.rejects(p, /Model not found/);
});

// ------------------------------------------------------------------ 3. 端到端（需要本机装了 pi）
const PI_CLI = path.join(ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
const HAS_PI = fs.existsSync(PI_CLI);

test('端到端：pi 子进程能起来，并且把奶蛙的工具注册成 pi 工具', { skip: HAS_PI ? false : '本机没有 pi，跳过' }, async () => {
  const host = stubHost();
  const toolset = createTools(host);
  const events = [];
  const b = createBridge({
    host, toolset, services: host.services, log: host.log,
    getPolicy: () => ({ mode: 'auto' }),
    getMeta: () => ({ version: 'test', locale: 'zh-CN' }),
    getModelConfig: () => ({ baseUrl: '', model: '', key: '', provider: 'auto', useCustomProvider: false })
  });
  await b.start();

  const stderr = [];
  const engine = createPiEngine({
    bridge: b,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    services: host.services,
    emit: (ch, payload) => events.push({ ch, payload })
  });
  // 把 stderr 抓出来，用扩展自己的日志确认它加载成功
  const origSpawn = require('child_process').spawn;
  try {
    await engine.start({ sessionDir: path.join(host._dir, 'pi-sessions') });
    assert.equal(engine.ready, true, 'pi 内核应当就绪');
    const st = await engine.status();
    assert.equal(st.ready, true);

    // 扩展是异步加载的，等它的日志出现
    const deadline = Date.now() + 8000;
    let loaded = '';
    while (Date.now() < deadline) {
      loaded = engine.stderrTail.join('\n');
      if (/扩展已加载/.test(loaded)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(/扩展已加载/.test(loaded), '扩展应当报告加载成功，实际 stderr：' + loaded.slice(-400));
    const m = /工具 (\d+) 个/.exec(loaded);
    assert.ok(m, '日志里应该有工具数量');
    assert.ok(Number(m[1]) >= 30, '注册到 pi 的工具应有 30+ 个，实际 ' + m[1]);
    assert.equal(Number(m[1]), toolset.all.filter((t) => t.enabled !== false).length, '数量应与桥上的清单一致');
  } finally {
    engine.stop();
    b.stop();
    void origSpawn;
  }
});
