'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function form(file, save, overrides = {}) {
  const nodes = new Map();
  const events = {};
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', className: '', style: {}, addEventListener() {}, querySelectorAll: () => [] });
    return nodes.get(id);
  };
  const api = new Proxy({
    settingsGet: () => new Promise(() => {}), appInit: () => new Promise(() => {}),
    agentCfgGet: async () => ({ hasKey: false, model: 'fixture-model' }), agentCfgSave: save,
    onAgentConfigChanged: fn => { events.config = fn; },
    ...overrides
  }, { get: (obj, key) => obj[key] || (() => {}) });
  const context = { window: { widget: api }, document: { getElementById: get, querySelectorAll: () => [] }, setTimeout() {}, clearTimeout() {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'renderer', file), 'utf8'), context);
  return { context, get, events };
}
for (const action of ['save', 'detect', 'test']) {
  test('settings ' + action + ' displays save failure and keeps the input key', async () => {
    const { context, get } = form('settings.js', async () => { throw new Error('fixture 写入失败'); });
    await vm.runInContext('initModel()', context);
    get('key').value = 'fixture-input';
    await get(action).onclick();
    assert.match(get('modelStatus').textContent, /写入失败/);
    assert.equal(get('key').value, 'fixture-input');
  });
}
test('settings masks a key only after confirmed encrypted saving', async () => {
  const { context, get } = form('settings.js', async () => ({ hasKey: true, keyPersistence: 'encrypted' }));
  await vm.runInContext('initModel()', context);
  get('key').value = 'fixture-input';
  await get('save').onclick();
  assert.match(get('key').value, /^•+$/);
  assert.match(get('modelStatus').textContent, /加密保存/);
});
test('assistant setup displays save failure rather than hanging at saving', async () => {
  const { context, get } = form('assistant.js', async () => { throw new Error('fixture 加密不可用'); });
  get('cfgBase').value = 'https://fixture.invalid/v1';
  get('cfgKey').value = 'fixture-input';
  await vm.runInContext('saveCfg(true)', context);
  assert.match(get('setupStatus').textContent, /加密不可用/);
  assert.equal(get('cfgKey').value, 'fixture-input');
});
test('assistant connection failure stays visible when its own save broadcasts the new configuration', async () => {
  let notify;
  const config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', hasKey: true, keyPersistence: 'encrypted' };
  const { context, get, events } = form('assistant.js', async () => { notify(config); return config; }, {
    agentTest: async () => ({ ok: false, error: 'fixture 连接失败' })
  });
  notify = events.config;
  get('cfgBase').value = config.baseUrl; get('cfgModel').value = config.model; get('cfgKey').value = 'fixture-input';
  vm.runInContext("show('setup')", context);
  await vm.runInContext('saveCfg(false)', context);
  assert.match(get('setupStatus').textContent, /连接失败/);
  assert.equal(get('v-setup').style.display, 'flex');
  assert.equal(get('v-chat').style.display, 'none');
});
test('preload converts an IPC save error into a rejection for both forms', async () => {
  let exposed;
  const context = { window: { addEventListener() {} }, require: () => ({
    contextBridge: { exposeInMainWorld(name, api) { exposed = api; } },
    ipcRenderer: { invoke: async () => ({ error: 'fixture 加密失败' }), on() {} }, webUtils: {}
  }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), context);
  await assert.rejects(exposed.agentCfgSave({ key: 'fixture-secret' }), /加密失败/);
});
