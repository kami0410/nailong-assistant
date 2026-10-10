'use strict';
/* MCP 配置管理 + pi 启动开关的测试
 *
 * MCP 是「harness 水平」的重要一条：能连外部工具服务器。这里锁的是
 *   - 粘贴 Claude Desktop / Cursor 现成片段就能加进来
 *   - 校验要说人话（名字非法、command/url 冲突、缺传输方式）
 *   - 不改用户自己的 ~/.pi/agent/mcp.json
 *   - 开关（--no-mcp / --no-skills / --no-context-files / --skill）真的进了命令行
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const mcp = require(path.join(SRC, 'main', 'engines', 'mcp.js'));
const { createPiEngine } = require(path.join(SRC, 'main', 'engines', 'pi.js'));

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-mcp-')), 'mcp.json'); }

test('mcp: 解析 Claude Desktop / Cursor 片段', () => {
  const r = mcp.parseConfig(JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
      docs: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } }
    }
  }));
  assert.equal(r.ok, true);
  const list = mcp.describe(r.config);
  assert.equal(list.length, 2);
  const fsSrv = list.find((x) => x.name === 'filesystem');
  assert.equal(fsSrv.type, 'stdio');
  assert.ok(fsSrv.target.indexOf('npx -y @modelcontextprotocol/server-filesystem .') >= 0);
  assert.equal(fsSrv.enabled, true);
  const docs = list.find((x) => x.name === 'docs');
  assert.equal(docs.type, 'http');
  assert.equal(docs.needsOAuth, false, '带 Authorization 头的不算“需要登录”');
});

test('mcp: 只有 url 没头上的服务器会被标成「需登录」', () => {
  const r = mcp.parseConfig('{"mcpServers":{"sentry":{"url":"https://mcp.sentry.dev/mcp"}}}');
  assert.equal(mcp.describe(r.config)[0].needsOAuth, true);
});

test('mcp: 坏 JSON / 顶层结构不对要说人话', () => {
  assert.equal(mcp.parseConfig('{ 不是 json').ok, false);
  assert.ok(/不是合法 JSON/.test(mcp.parseConfig('{ 不是 json').error));
  assert.equal(mcp.parseConfig('[1,2,3]').ok, false);
  assert.ok(/顶层/.test(mcp.parseConfig('[1,2,3]').error));
  assert.equal(mcp.parseConfig('{"mcpServers":[1,2]}').ok, false);
  assert.ok(/mcpServers/.test(mcp.parseConfig('{"mcpServers":[1,2]}').error));
  assert.equal(mcp.parseConfig('').ok, true, '空文件应当当成还没有服务器');
});

test('mcp: 添加时的校验', () => {
  const base = mcp.emptyConfig();
  assert.equal(mcp.upsert(base, 'bad name!', { command: 'x' }).ok, false, '名字里有空格/符号应当拒绝');
  assert.equal(mcp.upsert(base, 'ok-name_1.x', { command: 'x' }).ok, true);
  assert.equal(mcp.upsert(base, 'a', {}).ok, false, '既没 command 也没 url 应当拒绝');
  assert.equal(mcp.upsert(base, 'a', { command: 'x', url: 'http://y' }).ok, false, 'command 和 url 不能同时给');
  assert.equal(mcp.upsert(base, 'a', { command: 'x', args: 'not-array' }).ok, false, 'args 必须是数组');
  const r = mcp.upsert(base, 'a', { command: 'npx', args: ['-y', 'x'] });
  assert.equal(r.ok, true);
  assert.equal(mcp.describe(r.config)[0].name, 'a');
});

test('mcp: 单条粘贴自动猜名字 / 多条一次加完 / 增删改禁用', () => {
  const single = mcp.extractEntry('{"command":"npx","args":["-y","x"]}');
  assert.equal(single.ok, true);
  assert.equal(single.single.command, 'npx');

  const named = mcp.extractEntry('{"mcpServers":{"fs":{"command":"npx"}}}');
  assert.equal(named.name, 'fs');

  const multi = mcp.extractEntry('{"mcpServers":{"a":{"command":"x"},"b":{"url":"http://y"}}}');
  assert.equal(multi.ok, true);
  assert.deepEqual(Object.keys(multi.multi).sort(), ['a', 'b']);

  let cfg = mcp.emptyConfig();
  cfg = mcp.upsert(cfg, 'a', { command: 'x' }).config;
  cfg = mcp.setEnabled(cfg, 'a', false);
  assert.equal(mcp.describe(cfg)[0].enabled, false);
  cfg = mcp.setEnabled(cfg, 'a', true);
  assert.equal(mcp.describe(cfg)[0].enabled, true);
  cfg = mcp.remove(cfg, 'a');
  assert.deepEqual(mcp.describe(cfg), []);
});

test('mcp: 落盘是原子的、读回来一致、文件不存在不报错', () => {
  const file = tmpFile();
  const r0 = mcp.read(file);
  assert.equal(r0.ok, true);
  assert.deepEqual(r0.config, { mcpServers: {} });

  const cfg = mcp.upsert(mcp.emptyConfig(), 'demo', { command: 'npx', args: ['-y', 'x'] }).config;
  mcp.write(file, cfg);
  assert.equal(fs.readdirSync(path.dirname(file)).filter((f) => f.indexOf('.tmp') >= 0).length, 0, '不该留下临时文件');
  const back = mcp.read(file);
  assert.equal(back.ok, true);
  assert.equal(mcp.describe(back.config)[0].name, 'demo');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(raw.mcpServers.demo, '写出来的应当是标准 mcpServers 结构');
});

test('mcp: 现有文件坏了要提示而不是静默清空', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ 坏了', 'utf8');
  const r = mcp.read(file);
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.deepEqual(r.config, { mcpServers: {} }, '读不了时给空配置，但不该把文件覆盖掉');
});

test('pi 启动开关：--no-mcp / --no-skills / --no-context-files / --skill 都进了命令行', () => {
  const engine = createPiEngine({
    bridge: { url: 'http://127.0.0.1:1', token: 't' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    services: {},
    emit: () => {}
  });
  const off = engine.buildArgs({});
  assert.equal(off.indexOf('--no-mcp'), -1, '默认不要关掉 MCP');
  assert.equal(off.indexOf('--no-skills'), -1);
  assert.equal(off.indexOf('--no-context-files'), -1);

  const on = engine.buildArgs({
    noMcp: true, noSkills: true, noContextFiles: true,
    skillPaths: ['D:/my-skills/desktop', 'D:/my-skills/SKILL.md', '']
  });
  assert.ok(on.indexOf('--no-mcp') >= 0);
  assert.ok(on.indexOf('--no-skills') >= 0);
  assert.ok(on.indexOf('--no-context-files') >= 0);
  const skillIdx = on.reduce((acc, v, i) => (v === '--skill' ? acc.concat([i]) : acc), []);
  assert.equal(skillIdx.length, 2, '空路径要被过滤掉');
  assert.equal(on[skillIdx[0] + 1], 'D:/my-skills/desktop');
  assert.equal(on[skillIdx[1] + 1], 'D:/my-skills/SKILL.md');
});

test('steering：运行中发消息会带上 streamingBehavior', async () => {
  const engine = createPiEngine({
    bridge: { url: '', token: '' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    services: {},
    emit: () => {}
  });
  const sent = [];
  engine.state.proc = { stdin: { writable: true, write: (s) => sent.push(JSON.parse(s)) }, killed: false };
  engine.state.ready = true;

  // 空闲时发：不该带 streamingBehavior
  let p = engine.send('你好');
  setTimeout(() => {
    const last = sent[sent.length - 1];
    engine.handleRecord({ type: 'response', command: 'prompt', success: true, data: { disposition: 'started' }, id: last.id });
  }, 5);
  await p;
  assert.equal(sent[sent.length - 1].streamingBehavior, undefined, '空闲时不该带这个字段（pi 会拒）');

  // 正在跑的时候发：默认插到当前任务里
  engine.state.streaming = true;
  p = engine.send('改成用记事本');
  setTimeout(() => {
    const last = sent[sent.length - 1];
    engine.handleRecord({ type: 'response', command: 'prompt', success: true, data: { disposition: 'queued' }, id: last.id });
  }, 5);
  const r1 = await p;
  assert.equal(sent[sent.length - 1].streamingBehavior, 'steer');
  assert.equal(r1.steered, true);

  // 显式要求排在后面
  p = engine.send('跑完再说这个', { mode: 'followUp' });
  setTimeout(() => {
    const last = sent[sent.length - 1];
    engine.handleRecord({ type: 'response', command: 'prompt', success: true, data: { disposition: 'queued' }, id: last.id });
  }, 5);
  await p;
  assert.equal(sent[sent.length - 1].streamingBehavior, 'followUp');
});

test('fork：能拿到可分支的消息，fork 后把新历史带回来', async () => {
  const engine = createPiEngine({
    bridge: { url: '', token: '' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    services: {},
    emit: () => {}
  });
  const sent = [];
  engine.state.proc = { stdin: { writable: true, write: (s) => sent.push(JSON.parse(s)) }, killed: false };
  engine.state.ready = true;

  let p = engine.forkMessages();
  setTimeout(() => {
    const last = sent[sent.length - 1];
    assert.equal(last.type, 'get_fork_messages');
    engine.handleRecord({ type: 'response', command: 'get_fork_messages', success: true, id: last.id, data: { messages: [{ entryId: 'e1', text: '第一句' }] } });
  }, 5);
  const msgs = await p;
  assert.deepEqual(msgs, [{ entryId: 'e1', text: '第一句' }]);

  p = engine.fork('e1');
  setTimeout(() => {
    const last = sent[sent.length - 1];
    assert.equal(last.type, 'fork');
    assert.equal(last.entryId, 'e1');
    engine.handleRecord({ type: 'response', command: 'fork', success: true, id: last.id, data: { text: '第一句', cancelled: false } });
  }, 5);
  const r = await p;
  assert.equal(r.cancelled, false);
});
