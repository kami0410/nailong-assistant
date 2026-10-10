'use strict';
/* pi 侧环境自检的测试
 *
 * 这里锁的是一个真实踩过的坑：pi 的 settings.json 里配了 httpProxy 但那个代理没开，
 * 于是所有模型调用都只回一句含糊的 "Connection error."，用户根本不知道去哪改。
 * 自检负责把这句话翻译成人话。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const PF = require(path.join(SRC, 'main', 'engines', 'pi-preflight.js'));

function tmpAgentDir(settings, creds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-'));
  if (settings !== null) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings || {}), 'utf8');
  if (creds) fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(creds), 'utf8');
  return dir;
}

test('preflight: 代理地址解析', () => {
  assert.deepEqual(PF.parseProxy('http://127.0.0.1:7897'), { host: '127.0.0.1', port: 7897 });
  assert.deepEqual(PF.parseProxy('socks5://10.0.0.1:1080'), { host: '10.0.0.1', port: 1080 });
  assert.deepEqual(PF.parseProxy('http://proxy.local'), { host: 'proxy.local', port: 80 });
  assert.equal(PF.parseProxy('随便写的'), null);
});

test('preflight: 代理配了但连不上 → 给出可执行的修复建议', async () => {
  const dir = tmpAgentDir({ httpProxy: 'http://127.0.0.1:7897', defaultModel: 'deepseek/deepseek-v4-pro' }, { deepseek: { type: 'api_key', key: 'x' } });
  const r = await PF.preflight({ agentDir: dir, probe: async () => false, timeoutMs: 50 });
  assert.equal(r.proxy.configured, true);
  assert.equal(r.proxy.port, 7897);
  assert.equal(r.proxy.reachable, false);
  assert.equal(r.credentials.ok, true);
  assert.equal(r.model, 'deepseek/deepseek-v4-pro');
  assert.equal(r.warnings.length, 1);
  const w = r.warnings[0];
  assert.ok(w.indexOf('7897') >= 0, '要点名是哪个端口');
  assert.ok(w.indexOf('settings.json') >= 0, '要指出改哪个文件');
  assert.ok(w.indexOf('内置引擎') >= 0, '要给出绕过办法');
  assert.ok(w.indexOf('Connection error') >= 0, '要把用户看到的那句报错对上号');
});

test('preflight: 代理通、凭据齐全 → 不报警', async () => {
  const dir = tmpAgentDir({ httpProxy: 'http://127.0.0.1:7897' }, { deepseek: { type: 'api_key', key: 'x' } });
  const r = await PF.preflight({ agentDir: dir, probe: async () => true, timeoutMs: 50 });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.proxy.reachable, true);
  assert.ok(PF.summarize(r).indexOf('（通）') >= 0);
});

test('preflight: 没配代理 / 没装 pi 都不该报错', async () => {
  const none = tmpAgentDir({ defaultModel: 'openai/gpt-4o' }, null);
  const a = await PF.preflight({ agentDir: none, probe: async () => false });
  assert.deepEqual(a.warnings, []);
  assert.equal(a.proxy.configured, false);
  assert.equal(a.credentials.ok, false);

  const missing = path.join(os.tmpdir(), 'pi-agent-not-here-' + Date.now());
  const b = await PF.preflight({ agentDir: missing, probe: async () => false });
  assert.deepEqual(b.warnings, [], '目录不存在是常态（没装过 pi），不该当成错误');
});

test('preflight: 设置文件损坏要提示，而不是静默', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-bad-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ 这不是 JSON', 'utf8');
  const r = await PF.preflight({ agentDir: dir, probe: async () => false });
  assert.equal(r.settingsReadable, false);
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].indexOf('settings.json') >= 0);
});

test('preflight: 代理不通时提示里不包含代理地址也算合法（地址写坏了的情况）', async () => {
  const dir = tmpAgentDir({ httpProxy: '不是个地址' }, null);
  const r = await PF.preflight({ agentDir: dir, probe: async () => false });
  assert.equal(r.proxy.configured, true);
  assert.equal(r.proxy.reachable, null);
  assert.equal(r.warnings.length, 1, '地址都解析不了，必须警告');
});

test('preflight: TCP 探活对真实端口给对答案', async () => {
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.equal(await PF.probeTcp('127.0.0.1', port, 800), true, '开着的端口应当可连');
  await new Promise((r) => server.close(r));
  assert.equal(await PF.probeTcp('127.0.0.1', port, 600), false, '关掉的端口应当连不上');
});

test('preflight: 判断一条报错像不像网络/代理问题', () => {
  assert.equal(PF.looksLikeProxyFailure('Connection error.'), true);
  assert.equal(PF.looksLikeProxyFailure('fetch failed'), true);
  assert.equal(PF.looksLikeProxyFailure('connect ECONNREFUSED 127.0.0.1:7897'), true);
  assert.equal(PF.looksLikeProxyFailure('接口返回 401：invalid api key'), false);
});

test('preflight: 能读到默认的 agent 目录（可用 PI_CODING_AGENT_DIR 覆盖）', () => {
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = 'D:/somewhere/agent';
  assert.equal(PF.agentDir(), 'D:/somewhere/agent');
  if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
  assert.ok(PF.agentDir().indexOf('.pi') >= 0, '默认应当指向 ~/.pi/agent');
});
