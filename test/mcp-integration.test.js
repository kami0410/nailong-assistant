'use strict';
/* MCP 与 pi CLI 的真实集成：pi mcp list --json 的输出形状、以及我们依赖它的方式
 *
 * 这一条特别值得测，因为它背后藏着一个真实的集成坑：
 * pi 的 MCP 默认 exposure 是 codemode，而 codemode 是内置扩展 —— 奶蛙默认 --no-extensions
 * 把它关着。于是「服务器连上了，但模型看不到它的任何工具」。我们让新加的服务器默认 direct。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const mcp = require(path.join(SRC, 'main', 'engines', 'mcp.js'));

const PI_CLI = path.join(ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
const HAS_PI = fs.existsSync(PI_CLI);

function tmpAgentDirWithMcp(servers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-mcpint-'));
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2), 'utf8');
  return dir;
}

/** 用和应用一样的方式跑 pi CLI：electron-as-node + PI_CODING_AGENT_DIR */
function runPiCli(args, agentDir, timeout) {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const exe = fs.existsSync(electron) ? electron : process.execPath;
  const env = Object.assign({}, process.env, { PI_CODING_AGENT_DIR: agentDir });
  if (exe !== process.execPath) env.ELECTRON_RUN_AS_NODE = '1';
  return new Promise((resolve) => {
    execFile(exe, [PI_CLI].concat(args), { env, timeout: timeout || 40000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? 1 : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

test('mcp: 新增的服务器默认走 direct，不依赖任何扩展', () => {
  const cfg = mcp.upsert(mcp.emptyConfig(), 'fs', { command: 'npx', args: ['-y', 'x'] }).config;
  const s = mcp.describe(cfg)[0];
  assert.equal(s.exposure, 'direct');
  assert.equal(s.exposureNeedsExtension, false, 'direct 不该被标成“需要扩展”');
});

test('mcp: 用户显式写了 codemode/deferred 要尊重，并标出它需要扩展', () => {
  const a = mcp.upsert(mcp.emptyConfig(), 'a', { command: 'x', exposure: 'deferred' }).config;
  const sa = mcp.describe(a)[0];
  assert.equal(sa.exposure, 'deferred');
  assert.equal(sa.exposureNeedsExtension, true, 'deferred 要靠 tool_search 扩展');
  const b = mcp.upsert(mcp.emptyConfig(), 'b', { command: 'x', exposure: 'codemode' }).config;
  assert.equal(mcp.describe(b)[0].exposureNeedsExtension, true, 'codemode 要靠 codemode 扩展');
});

test('mcp: 默认值不会覆盖用户已有的 expose 设置', () => {
  let cfg = mcp.upsert(mcp.emptyConfig(), 'a', { command: 'x', exposure: 'direct' }).config;
  cfg = mcp.upsert(cfg, 'a', { args: ['--flag'] }).config;   // 再改一次别的字段
  assert.equal(mcp.describe(cfg)[0].exposure, 'direct', '重复 upsert 不该把 exposure 弄丢');
});

test('端到端：pi mcp list --json 的输出我们能解析，并拿到 state/tools/error', { skip: HAS_PI ? false : '本机没有 pi' }, async () => {
  const dir = tmpAgentDirWithMcp({
    broken: { command: 'no-such-binary-xyz-nailong', args: [], exposure: 'direct' }
  });
  const r = await runPiCli(['mcp', 'list', '--json'], dir);
  let data = null;
  try { data = JSON.parse(r.stdout); } catch (e) { data = null; }
  assert.ok(data, 'pi mcp list --json 要能解析成 JSON，实际输出：' + (r.stdout || r.stderr).slice(0, 300));
  assert.ok(Array.isArray(data.servers), '要有 servers 数组');
  const s = data.servers.find((x) => x.name === 'broken');
  assert.ok(s, '要列出我们写进去的服务器');
  assert.equal(s.state, 'failed', '这个命令根本不存在，状态应当是 failed');
  assert.ok(Array.isArray(s.tools), '要带 tools 数组');
  assert.ok(String(s.error || '').length > 0, '要有可读的错误信息给用户看');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('端到端：pi 能认出 direct exposure（也就是我们的默认值）', { skip: HAS_PI ? false : '本机没有 pi' }, async () => {
  const dir = tmpAgentDirWithMcp({
    broken2: { command: 'no-such-binary-xyz-nailong', args: [], exposure: 'direct' }
  });
  const r = await runPiCli(['mcp', 'list', '--json'], dir);
  const data = JSON.parse(r.stdout);
  const s = data.servers.find((x) => x.name === 'broken2');
  assert.equal(String(s.exposure), 'direct', 'pi 应当原样读回我们写的 exposure');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('会话树：router 会把 leafId 一起给出来，界面标出当前位置', () => {
  const piSrc = fs.readFileSync(path.join(SRC, 'main', 'engines', 'pi.js'), 'utf8');
  assert.ok(/leafId: d\.leafId/.test(piSrc), 'pi.tree() 要返回 leafId');
  const ipc = fs.readFileSync(path.join(SRC, 'main', 'ipc.js'), 'utf8');
  assert.ok(/leafId: \(t && t\.leafId\)/.test(ipc), 'IPC 要把 leafId 拍平传出去');
  const asst = fs.readFileSync(path.join(ROOT, 'renderer', 'assistant.js'), 'utf8');
  assert.ok(/r\.leafId/.test(asst) && /当前位置/.test(asst), '界面要标出当前所在节点');
});

test('MCP 登录：登录/登出/状态三个接口都在，且登录后会轮询到连上为止', () => {
  const ipc = fs.readFileSync(path.join(SRC, 'main', 'ipc.js'), 'utf8');
  assert.ok(/h\('mcp-login'/.test(ipc));
  assert.ok(/h\('mcp-logout'/.test(ipc));
  assert.ok(/h\('mcp-check-logged-in'/.test(ipc));
  const pre = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  ['mcpLogin', 'mcpLogout', 'mcpStatus', 'mcpCheckLoggedIn'].forEach((m) => {
    assert.ok(pre.indexOf(m) >= 0, 'preload 缺少 ' + m);
  });
  const ui = fs.readFileSync(path.join(ROOT, 'renderer', 'settings.js'), 'utf8');
  assert.ok(/mcpCheckLoggedIn/.test(ui), '界面要轮询是否登录成功');
  assert.ok(/已连接，暴露/.test(ui), '成功后要报出拿到了多少工具');
});
