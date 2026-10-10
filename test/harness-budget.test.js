'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge } = require('../src/main/engines/bridge');
test('pi tool budget blocks execution beyond the limit and restores it for a new task', async () => {
  let runs = 0;
  const tool = { name: 'fixture', level: 'low', run: async () => { runs++; return { text: 'ran' }; } };
  const bridge = createBridge({ toolset: { all: [tool], get: () => tool }, log: { warn() {} }, getPolicy: () => ({ mode: 'readonly', maxSteps: 2 }) });
  bridge.resetTask(false);
  assert.equal((await bridge.runTool('fixture', {})).ok, true);
  assert.equal((await bridge.runTool('fixture', {})).ok, true);
  const blocked = await bridge.runTool('fixture', {});
  assert.equal(blocked.ok, false);
  assert.match(blocked.text, /上限/);
  assert.equal(runs, 2);
  bridge.resetTask(false);
  assert.equal((await bridge.runTool('fixture', {})).ok, true);
});
test('pi tools keep working after a day even with an old saved time limit', async (t) => {
  let now = 1000, runs = 0;
  t.mock.method(Date, 'now', () => now);
  const tool = { name: 'fixture', level: 'low', run: async () => { runs++; return 'ran'; } };
  const bridge = createBridge({ toolset: { all: [tool], get: () => tool }, log: { warn() {} }, getPolicy: () => ({ mode: 'readonly', maxRuntimeMs: 60000 }) });
  bridge.resetTask(false); now += 86400000;
  assert.equal((await bridge.runTool('fixture', {})).ok, true);
  assert.equal(runs, 1);
});

test('elapsed time while waiting for approval does not expire a task; manual cancellation still blocks it', async (t) => {
  let now = 1000, runs = 0, approve;
  t.mock.method(Date, 'now', () => now);
  const tool = { name: 'fixture', level: 'mid', run: async () => { runs++; return 'ran'; } };
  const bridge = createBridge({ toolset: { all: [tool], get: () => tool }, log: { warn() {} }, getPolicy: () => ({ mode: 'confirm', maxRuntimeMs: 60000 }), askUser: () => new Promise(r => { approve = r; }) });
  bridge.resetTask(false);
  const waiting = bridge.runTool('fixture', {});
  await Promise.resolve();
  now += 86400000; approve('exec');
  assert.equal((await waiting).ok, true);
  bridge.resetTask(false);
  const cancelled = bridge.runTool('fixture', {});
  await Promise.resolve();
  bridge.cancelPending(); approve('exec');
  assert.equal((await cancelled).ok, false);
  assert.equal(runs, 1);
});
