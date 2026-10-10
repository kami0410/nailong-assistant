'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-harness-'));
process.env.NAILONG_DATA_DIR = dir;
process.env.PI_TELEMETRY = '0';
const root = process.env.NAILONG_REVIEW_APP || path.join(__dirname, '..');
const { createEngineRouter } = require(path.join(root, 'src/main/engines'));
const { createTools } = require(path.join(root, 'src/main/tools'));
test('harness: actual model catalog, effort request, durable selection and unsupported level rejection', { timeout: 40000 }, async () => {
  const requests = [];
  let heldResponse = null, longStarted;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Workspace acceptance sentinel: HARNESS_WORKSPACE_VERIFIED');
  const server = http.createServer((req, res) => {
    let text = ''; req.on('data', b => { text += b; });
    req.on('end', () => {
      requests.push(JSON.parse(text));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (JSON.stringify(requests.at(-1).messages).includes('manual-stop-fixture')) {
        heldResponse = res; res.write(': waiting for manual stop\n\n'); longStarted(); return;
      }
      const base = { id: 'harness-fixture', model: 'fixture-reasoner', object: 'chat.completion.chunk', created: 1 };
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: 'configuration-confirmed' }, finish_reason: null }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const config = { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', key: 'local-fixture', model: 'fixture-chat', provider: 'openai', maxTokens: 1536, temperature: 0.4,
    modelCatalog: [{ id: 'fixture-chat', reasoning: false, vision: false }, { id: 'fixture-reasoner', reasoning: true, vision: true, maxTokens: 1536 }, { id: 'fixture-deepseek', reasoning: true, vision: false, maxTokens: 2048, thinkingFormat: 'deepseek', thinkingLevels: ['off', 'low', 'high', 'max'] }] };
  let agent = { engine: 'pi', piConfig: 'bundled', thinking: 'off', workspace: dir };
  const settings = { agentCfg: () => agent, setKey(k, v) { assert.equal(k, 'agent'); agent = v; fs.writeFileSync(path.join(dir, 'harness-settings.json'), JSON.stringify(v)); }, store: { saveNow: () => true } };
  const host = { log: { info() {}, warn() {}, error() {}, debug() {} } };
  // 旧配置刻意保留极短总时长：真实 pi 任务不能再被这项废弃设置中止。
  const builtin = { toolset: createTools(host), rawConfig: () => config, policy: () => ({ mode: 'readonly', maxRuntimeMs: 1 }), saveConfig(p) { Object.assign(config, p); fs.writeFileSync(path.join(dir, 'harness-model.json'), JSON.stringify({ ...config, key: undefined })); return config; } };
  let done;
  const router = createEngineRouter({ builtin, settings, host, services: {}, log: host.log, getLocale: () => 'zh-CN', emit(ch, v) { if (v && v.type === 'done' && done) done(); } });
  try {
    const models = await router.listPiModels();
    assert.deepEqual(models.filter(m => m.provider === 'nailong').map(m => m.id).sort(), ['fixture-chat', 'fixture-deepseek', 'fixture-reasoner']);
    await router.piSetModel('nailong', 'fixture-reasoner');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'harness-model.json'))).model, 'fixture-reasoner');
    assert.ok((await router.piThinkingLevels()).includes('high'));
    await assert.rejects(router.piSetThinking('max'), /不支持|unsupported/);
    assert.equal(await router.piSetThinking('low'), 'low');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'harness-settings.json'))).thinking, 'low');
    const finished = new Promise(r => { done = r; });
    await router.send('verify configured request');
    await Promise.race([finished, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('request did not complete')), 10000); t.unref(); })]);
    assert.equal(requests[0].model, 'fixture-reasoner');
    assert.match(JSON.stringify(requests[0].messages), /HARNESS_WORKSPACE_VERIFIED/);
    assert.equal(requests[0].reasoning_effort, 'low');
    assert.equal(requests[0].max_tokens ?? requests[0].max_completion_tokens, 1536);
    assert.equal(requests[0].temperature, undefined);
    await router.piSetModel('nailong', 'fixture-chat');
    const chatDone = new Promise(r => { done = r; });
    await router.send('verify temperature on regular chat');
    await chatDone;
    assert.equal(requests[1].temperature, 0.4);
    await router.piSetModel('nailong', 'fixture-deepseek');
    assert.deepEqual(await router.piThinkingLevels(), ['off', 'low', 'high', 'max']);
    await assert.rejects(router.piSetThinking('medium'), /不支持/);
    await router.piSetThinking('max');
    const maxDone = new Promise(r=>{done=r}); await router.send('verify DeepSeek max'); await maxDone;
    assert.deepEqual(requests[2].thinking, { type: 'enabled' });
    assert.equal(requests[2].reasoning_effort, 'max');
    await router.piSetThinking('off');
    const offDone = new Promise(r=>{done=r}); await router.send('verify DeepSeek off'); await offDone;
    assert.deepEqual(requests[3].thinking, { type: 'disabled' });
    assert.equal(requests[3].reasoning_effort, undefined);
    await router.piSetModel('nailong', 'fixture-reasoner');
    await router.piSetThinking('low');
    const first = router.pi.state.proc;
    const exited = new Promise(r => first.once('exit', r)); router.pi.stop(); await exited;
    await router.listPiModels();
    assert.equal(router.pi.model, 'fixture-reasoner');
    assert.equal(router.pi.thinkingLevel, 'low');
    const started = new Promise(r => { longStarted = r; });
    const manualDone = new Promise(r => { done = r; });
    await router.send('manual-stop-fixture');
    await started;
    assert.equal(router.pi.streaming, true);
    assert.equal(router.stop(), true);
    await Promise.race([manualDone, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('manual stop did not settle')), 5000); t.unref(); })]);
    assert.equal(router.pi.streaming, false);
    console.log('legacy maxRuntimeMs=1 does not abort real pi requests; manual stop settles an active stream');
    console.log('workspace context delivered; harness evidence: 3 custom models; DeepSeek max/off payloads verified; selection+effort survive process restart; actual request has low effort, 1536 tokens, 0.4 temperature');
  } finally {
    if (heldResponse) heldResponse.end();
    const proc = router.pi.state.proc;
    const exited = proc ? new Promise(r => proc.once('exit', r)) : Promise.resolve();
    router.pi.stop(); router.bridge.stop(); await exited;
    await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  }
});
