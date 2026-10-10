'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createBridge } = require('../src/main/engines/bridge');
test('extension: actual hooks reread plan mode and respect provider opt-out, protocol and limits', async () => {
  let cfg = { useCustomProvider: false, baseUrl: 'https://fake', key: 'fake', model: 'claude-test', provider: 'anthropic', maxTokens: 1234, contextWindow: 23456 };
  let planMode = false;
  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  const b = createBridge({ toolset: { all: [], get() {} }, services: {}, log: quiet, getModelConfig: () => cfg, getRuntimeFlags: () => ({ planMode }) });
  await b.start();
  const oldBridge = process.env.NAILONG_BRIDGE, oldToken = process.env.NAILONG_TOKEN;
  process.env.NAILONG_BRIDGE = b.url; process.env.NAILONG_TOKEN = b.token;
  try {
    const ext = (await import(pathToFileURL(path.resolve(__dirname, '../pi-ext/nailong.mjs')).href)).default;
    function api() {
      const hooks = {}, providers = [];
      return { hooks, providers, registerTool() {}, registerProvider(name, value) { providers.push(value); }, on(name, fn) { hooks[name] = fn; } };
    }
    const pi = api(); await ext(pi);
    assert.equal(pi.providers.length, 0);
    assert.equal(await pi.hooks.before_agent_start({ systemPrompt: 'base' }), undefined);
    planMode = true;
    const injected = await pi.hooks.before_agent_start({ systemPrompt: 'base' });
    assert.ok(injected.systemPrompt.startsWith('base'));
    assert.match(injected.systemPrompt, /propose_plan/);
    planMode = false;
    assert.equal(await pi.hooks.before_agent_start({ systemPrompt: 'base' }), undefined);
    for (const [provider, expected] of [['anthropic', 'anthropic-messages'], ['gemini', 'google-generative-ai'], ['openai', 'openai-completions']]) {
      cfg = { ...cfg, useCustomProvider: true, provider };
      const p = api(); await ext(p);
      assert.equal(p.providers[0].api, expected);
      assert.equal(p.providers[0].models[0].maxTokens, 1234);
      assert.equal(p.providers[0].models[0].contextWindow, 23456);
    }
  } finally {
    b.stop();
    if (oldBridge === undefined) delete process.env.NAILONG_BRIDGE; else process.env.NAILONG_BRIDGE = oldBridge;
    if (oldToken === undefined) delete process.env.NAILONG_TOKEN; else process.env.NAILONG_TOKEN = oldToken;
  }
});
