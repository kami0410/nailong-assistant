'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
// 本测试文件由 node:test 独立进程执行；不读取或改动真实应用数据与全局 pi。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-loop-'));
process.env.NAILONG_DATA_DIR = dir;
process.env.PI_TELEMETRY = '0';
const appRoot = process.env.NAILONG_REVIEW_APP || path.join(__dirname, '..');
const { createEngineRouter } = require(path.join(appRoot, 'src/main/engines'));
const { createTools } = require(path.join(appRoot, 'src/main/tools'));
test('pi loop: real router/child/extension/bridge with local model fixture, image and tool-result round trip', { timeout: 30000 }, async () => {
  const requests = [], events = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw); requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const toolResult = body.messages.some(m => m.role === 'tool');
      const delta = toolResult ? { content: 'fixture-complete' } : { tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'clipboard_get', arguments: '{}' } }] };
      const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: toolResult ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }) + '\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const host = { clipboard: { read: () => 'fixture-clipboard' }, services: {}, log: { info() {}, warn() {}, error() {}, debug() {} } };
  const config = { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', key: 'fixture', model: 'fixture', provider: 'openai', maxTokens: 1024 };
  const builtin = { toolset: createTools(host), rawConfig: () => config, policy: () => ({ mode: 'readonly' }) };
  const settings = { agentCfg: () => ({ engine: 'pi', piConfig: 'bundled' }) };
  let done;
  const settled = new Promise(resolve => { done = resolve; });
  const router = createEngineRouter({ builtin, settings, host, services: {}, log: host.log, version: 'test', getLocale: () => 'zh-CN', emit(ch, payload) { events.push({ ch, payload }); if (payload && payload.type === 'done') done(); } });
  try {
    const image = 'data:image/png;base64,' + fs.readFileSync(path.join(appRoot, 'assets/naifrog/work/coding-strip.png')).toString('base64');
    await router.send('fixture request', { images: [image] });
    await Promise.race([settled, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('fixture did not settle')), 15000); timer.unref(); })]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].tools.length, 54);
    assert.ok(requests[0].messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')));
    assert.ok(requests[1].messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('fixture-clipboard')));
    assert.equal(events.filter(e => e.payload.type === 'text').map(e => e.payload.delta).join(''), 'fixture-complete');
    assert.ok(events.some(e => e.payload.type === 'tool-result' && e.payload.ok));
    console.log('fixture evidence: 54 tools, image delivered, clipboard result returned, streamed reply received; NOT a real provider acceptance');
  } catch (e) {
    console.error('loop error:', e.message, 'pi stderr:', router.pi.stderrTail.join('\n'));
    throw e;
  } finally {
    const proc = router.pi.state.proc;
    const exited = proc ? new Promise(r => proc.once('exit', r)) : Promise.resolve();
    router.bridge.stop(); router.pi.stop();
    await exited;
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
