#!/usr/bin/env node
'use strict';
/* npm run smoke:pi —— 真跑一次**应用自带**的 pi 内核
 *
 * 做四件事：
 *   1. 起一个真的本地工具桥（工具用桩实现，不需要 Electron）
 *   2. 建一个脱离系统 ~/.pi 的 agent 目录（bundled 模式），只用奶蛙自己的设置
 *   3. 用真 pi CLI 起 RPC 子进程，加载奶蛙扩展，逐项核对工具注册
 *   4. 如果给了接口配置，就真发一句提示，看流式输出、工具调用与用量
 *
 * 两种跑法：
 *   什么都不配      → 只验证内核与工具链路（不花 token）
 *   配好三个环境变量 → 真发一句：
 *     NAILONG_BASE_URL=https://api.deepseek.com NAILONG_API_KEY=sk-xxx NAILONG_MODEL=deepseek-chat npm run smoke:pi
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { createBridge } = require(path.join(ROOT, 'src', 'main', 'engines', 'bridge.js'));
const { createPiEngine } = require(path.join(ROOT, 'src', 'main', 'engines', 'pi.js'));
const { createTools } = require(path.join(ROOT, 'src', 'main', 'tools', 'index.js'));
const agentDirLib = require(path.join(ROOT, 'src', 'main', 'engines', 'pi-agent-dir.js'));

const PROMPT = process.env.NAILONG_SMOKE_PROMPT || '只回复四个字：奶蛙在线';
const CFG = {
  baseUrl: process.env.NAILONG_BASE_URL || '',
  key: process.env.NAILONG_API_KEY || '',
  model: process.env.NAILONG_MODEL || ''
};
const CAN_CALL = !!(CFG.baseUrl && CFG.key && CFG.model);

function stubHost() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-smoke-'));
  return {
    _dir: dir,
    paths: { root: path.join(dir, 'app'), home: dir, desktop: dir, downloads: '', documents: '' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    lastShot: () => null,
    screenshot: async () => ({ dataUrl: 'data:image/jpeg;base64,QQ==', physW: 1920, physH: 1080, sentW: 960, sentH: 540 }),
    afterShot: async () => [], pause: async () => {}, input() {},
    uiTree: async () => ({ window: '', count: 0, nodes: [] }), findElement: async () => [],
    elementAction: async () => ({}), windowControl: async () => ({}), windowList: async () => [],
    screenInfo: async () => ({ screens: [], scale: 1, cursor: { x: 0, y: 0 }, foreground: null, windows: [] }),
    systemInfo: async () => ({}), runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
    launch: async () => true, recycle: async () => ({ ok: 0, fail: 0, err: '' }),
    guardPath: () => ({ ok: true }),
    readImageFile: () => ({ ok: true, dataUrl: 'data:image/png;base64,QUJD', width: 10, height: 10, scaled: false, mime: 'image/png', bytes: 3 }),
    clipboard: { read: () => '', write() {} },
    services: {
      schedule: { tasks: () => [], doneMap: () => ({}), add: (t) => t, remove: () => 1, toggleDone: () => ({}), progress: () => ({ total: 0, done: 0, pct: 0 }) },
      countdown: { list: () => [], add: () => [] },
      focus: { start: () => ({}), status: () => ({ phase: 'idle', remainMs: 0, config: {} }), stop: () => ({}) },
      stats: { today: () => ({}), range: () => ({ summary: {}, hours: [] }) },
      memory: { add: () => [], search: () => [] },
      clipboard: { history: () => [] },
      notify: { show: (t, b) => console.log('  [通知] ' + t + '：' + b) }
    }
  };
}

(async () => {
  const host = stubHost();
  const toolset = createTools(host);
  const events = [];

  const bridge = createBridge({
    host, toolset, services: host.services, log: host.log,
    getPolicy: () => ({ mode: 'auto' }),           // 冒烟测试不弹确认框
    askUser: async () => 'exec',
    getMeta: () => ({ version: require(path.join(ROOT, 'package.json')).version, locale: 'zh-CN' }),
    getModelConfig: () => ({
      baseUrl: CFG.baseUrl, model: CFG.model, key: CFG.key, provider: 'auto',
      useCustomProvider: true, maxTokens: 8192, contextWindow: 128000
    })
  });
  await bridge.start();
  console.log('① 工具桥就绪：' + bridge.url + '（工具 ' + toolset.all.length + ' 个）');

  // 关键：用应用自己的 agent 目录，不读机器上的 ~/.pi（那里可能有死代理或别人的配置）
  const agentDir = path.join(host._dir, 'pi-agent');
  agentDirLib.ensure(agentDir, { model: CAN_CALL ? CFG.model : '', thinking: 'medium', log: host.log });
  console.log('② 自带 agent 目录：' + agentDir);
  console.log('   settings.json = ' + fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8').replace(/\s+/g, ' ').trim());
  console.log('   APPEND_SYSTEM.md ' + fs.readFileSync(path.join(agentDir, 'APPEND_SYSTEM.md'), 'utf8').length + ' 字节');

  const engine = createPiEngine({
    bridge, log: host.log, services: host.services,
    emit: (ch, payload) => events.push({ ch, payload }),
    onRaw: process.env.NAILONG_SMOKE_DEBUG === '1'
      ? (r) => console.log('  << ' + r.type + (r.command ? ':' + r.command : '') + (r.success === false ? ' 失败:' + r.error : ''))
      : undefined
  });

  const started = Date.now();
  await engine.start({
    sessionDir: path.join(host._dir, 'pi-sessions'),
    agentDir: agentDir,
    model: CAN_CALL ? ('nailong/' + CFG.model) : undefined
  });
  console.log('③ pi 内核就绪（' + (Date.now() - started) + 'ms），模型 ' + (engine.model || '（未指定）')
    + '，会话 ' + String(engine.sessionId).slice(0, 8));

  const loaded = /\u5de5\u5177 (\d+) \u4e2a/.exec(engine.stderrTail.join('\n'));
  console.log('④ 奶蛙扩展注册工具：' + (loaded ? loaded[1] : '未报告') + ' 个');
  console.log('   扩展日志：' + engine.stderrTail.filter((l) => l.indexOf('[nailong]') >= 0).join(' | '));

  const models = await engine.models().catch(() => []);
  console.log('⑤ pi 认到的模型：' + (models.length ? models.map((m) => m.provider + '/' + m.id).join(', ') : '（无，需要先在奶蛙设置里填接口）'));

  if (!CAN_CALL) {
    console.log('\n── 结果 ──');
    console.log('内核与工具链路 OK。没提供接口配置，所以没真发提示（不花 token）。');
    console.log('想连真模型：');
    console.log('  NAILONG_BASE_URL=... NAILONG_API_KEY=... NAILONG_MODEL=... npm run smoke:pi');
    engine.stop();
    bridge.stop();
    process.exit(loaded && Number(loaded[1]) === toolset.all.length ? 0 : 1);
  }

  console.log('⑥ 发送提示：' + PROMPT);
  const tick = setInterval(() => process.stdout.write('.'), 400);
  const donePromise = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (events.some((e) => e.payload && e.payload.type === 'done')) { clearInterval(timer); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(timer); resolve(); }, 120000);
  });
  await engine.command('prompt', { message: PROMPT }, 60000);
  await donePromise;
  clearInterval(tick);

  let text = '';
  let tools = 0;
  events.forEach((e) => {
    if (e.ch !== 'agent-event') return;
    if (e.payload.type === 'text') text += e.payload.delta;
    if (e.payload.type === 'tool-call') tools++;
  });
  const stats = await engine.stats().catch(() => null);
  console.log('\n── 结果 ──');
  console.log('回复：' + (text.trim() || '（没有文本输出）'));
  console.log('工具调用：' + tools + ' 次');
  if (stats) {
    console.log('tokens：in ' + (stats.tokens && stats.tokens.input) + ' / out ' + (stats.tokens && stats.tokens.output)
      + '，花费约 $' + (typeof stats.cost === 'number' ? stats.cost.toFixed(5) : '?'));
    if (stats.contextUsage) console.log('上下文占用：' + stats.contextUsage.percent + '%');
  }
  const errs = events.filter((e) => e.payload && e.payload.type === 'error');
  if (errs.length) console.log('错误：' + errs.map((e) => e.payload.message).join(' | '));

  engine.stop();
  bridge.stop();
  process.exit(text.trim() ? 0 : 1);
})().catch((e) => {
  console.error('冒烟失败：' + ((e && e.stack) || e));
  process.exit(2);
});
