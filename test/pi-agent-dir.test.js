'use strict';
/* 「应用自带 pi 内核」这套设计的测试
 *
 * 锁的是这个诉求：奶蛙自带一套 pi 配置，**不去读机器上那个 pi 的配置**。
 * 所以自带目录里不能出现代理、不能出现别人的 provider，模型必须来自奶蛙自己的设置。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const agentDirLib = require(path.join(SRC, 'main', 'engines', 'pi-agent-dir.js'));
const { createPiEngine } = require(path.join(SRC, 'main', 'engines', 'pi.js'));

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nl-agentdir-')); }

test('自带 agent 目录：会生成 settings.json 与 APPEND_SYSTEM.md', () => {
  const dir = path.join(tmp(), 'pi-agent');
  const r = agentDirLib.ensure(dir, { model: 'deepseek-chat', thinking: 'medium' });
  assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
  assert.ok(fs.existsSync(path.join(dir, 'APPEND_SYSTEM.md')));
  assert.ok(fs.existsSync(path.join(dir, 'sessions')));
  assert.deepEqual(r.wrote.sort(), ['APPEND_SYSTEM.md', 'settings.json']);
  assert.equal(r.settings.defaultProvider, 'nailong');
  assert.equal(r.settings.defaultModel, 'deepseek-chat');
  assert.equal(r.settings.defaultThinkingLevel, 'medium');
});

test('自带 agent 目录：绝不写入任何代理设置（这是当初踩的坑）', () => {
  const dir = path.join(tmp(), 'pi-agent');
  agentDirLib.ensure(dir, { model: 'x', thinking: 'high' });
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.equal(/proxy/i.test(raw), false, '自带配置里不该出现任何 proxy 字样：' + raw);
  const info = agentDirLib.inspect(dir);
  assert.equal(info.proxy, '');
});

test('自带 agent 目录：不写扩展/包声明（保持干净）', () => {
  const dir = path.join(tmp(), 'pi-agent');
  agentDirLib.ensure(dir, {});
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(s).sort(), ['defaultProvider']);
  assert.equal(s.extensions, undefined);
  assert.equal(s.packages, undefined);
});

test('自带 agent 目录：pi 自己重写过文件后，我们不再来回覆写（不跟它拉锯）', () => {
  const dir = path.join(tmp(), 'pi-agent');
  agentDirLib.ensure(dir, { model: 'm', thinking: 'medium' });
  // 模拟 pi 启动后把文件规范化：加了自己的键，我们要的键都还在
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({
    defaultProvider: 'nailong',
    defaultModel: 'm',
    defaultThinkingLevel: 'medium',
    compaction: { enabled: true },
    retry: { enabled: true }
  }, null, 2), 'utf8');
  const again = agentDirLib.ensure(dir, { model: 'm', thinking: 'medium' });
  assert.deepEqual(again.wrote, [], '我们要的键都还在，就不该再写一遍');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.compaction.enabled, true, 'pi 自己加的键不能被我们抹掉');
});

test('自带 agent 目录：pi 把 defaultModel 弄丢/状态变了要能纠回来', () => {
  const dir = path.join(tmp(), 'pi-agent');
  agentDirLib.ensure(dir, { model: 'a' });
  const file = path.join(dir, 'settings.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete s.defaultModel;                       // 模拟 pi 规范化时丢掉
  s.compaction = { enabled: true };
  fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf8');
  const again = agentDirLib.ensure(dir, { model: 'a' });
  assert.deepEqual(again.wrote, ['settings.json'], '关键键丢了就得补回来');
  const fixed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(fixed.defaultModel, 'a');
  assert.equal(fixed.compaction.enabled, true, '补的时候不能把 pi 的键丢掉');
});

test('自带 agent 目录：内容没变就不重复写（避免每次启动都动文件）', () => {
  const dir = path.join(tmp(), 'pi-agent');
  const a = agentDirLib.ensure(dir, { model: 'm', thinking: 'low' });
  assert.equal(a.wrote.length, 2);
  const b = agentDirLib.ensure(dir, { model: 'm', thinking: 'low' });
  assert.deepEqual(b.wrote, [], '内容一致时应当什么都不写');
  const c = agentDirLib.ensure(dir, { model: 'm2', thinking: 'low' });
  assert.deepEqual(c.wrote, ['settings.json'], '换了模型只该改 settings.json');
});

test('自带 agent 目录：不覆盖用户放进来的其它文件（比如 mcp.json）', () => {
  const dir = path.join(tmp(), 'pi-agent');
  agentDirLib.ensure(dir, {});
  const mcpFile = path.join(dir, 'mcp.json');
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { demo: { command: 'x' } } }), 'utf8');
  agentDirLib.ensure(dir, { model: 'm' });
  assert.ok(fs.existsSync(mcpFile), 'mcp.json 不该被动');
  assert.equal(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers.demo.command, 'x');
});

test('APPEND_SYSTEM.md：把「桌面助手而不是编程助手」这层身份与红线写进去', () => {
  const text = agentDirLib.SYSTEM_APPEND_ZH;
  for (const kw of ['桌面助手', 'ui_tree', 'click_element', 'schedule_', '回收站', '付款', '系统设置', '简体中文']) {
    assert.ok(text.indexOf(kw) >= 0, 'APPEND_SYSTEM.md 应包含「' + kw + '」');
  }
  assert.ok(/不是写代码的编程助手/.test(text), '必须明确纠正 pi 默认的编程助手身份');
});

test('bundled 模式：子进程被指定了独立的 agent 目录，且不继承父进程的', () => {
  const engine = createPiEngine({
    bridge: { url: 'http://127.0.0.1:1', token: 't' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    services: {},
    emit: () => {}
  });
  // 直接验证参数拼装（agent 目录走 env，不占命令行）
  const withDir = engine.buildArgs({ agentDir: 'D:/app/pi-agent', model: 'nailong/x' });
  assert.equal(withDir.indexOf('--agent-dir'), -1, 'agent 目录是环境变量，不该出现在命令行里');
  assert.ok(withDir.indexOf('--model') >= 0);
  assert.equal(withDir[withDir.indexOf('--model') + 1], 'nailong/x');
});

test('bundled 模式：与“沿用系统 pi 配置”互斥，默认必须是不读系统配置', () => {
  const def = require(path.join(SRC, 'main', 'services.js'));
  // 通过 settings 默认值确认默认是 bundled
  const fs2 = require('fs');
  const raw = fs2.readFileSync(path.join(SRC, 'main', 'services.js'), 'utf8');
  assert.ok(/piConfig:\s*'bundled'/.test(raw), '默认必须是 bundled，不能默认读用户的 ~/.pi');
  assert.ok(typeof def.createSettings === 'function');
});

test('auto 模式：pi 起来了但没有可用模型时，退回内置引擎（报错更可操作）', () => {
  const src = fs.readFileSync(path.join(SRC, 'main', 'engines', 'index.js'), 'utf8');
  // 实现在 activeEngine() 里：pi.ready && !pi.model → builtin
  const body = src.slice(src.indexOf('function activeEngine()'), src.indexOf('function activeEngine()') + 900);
  assert.ok(/if \(pi\.ready\) return pi\.model \? 'pi' : 'builtin'/.test(body),
    'auto 模式下 pi 就绪但没模型时应当退回内置引擎：\n' + body);
  assert.ok(/if \(pi\.starting\) return 'pi'/.test(body), '启动中不要路由到内置');
});
