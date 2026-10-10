'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-service-'));
process.env.NAILONG_DATA_DIR = dir;
let agentDeps;
let encryptionAvailable = false;
let decryptFails = false;
const originalLoad = Module._load;
Module._load = function (name, ...rest) {
  if (name === 'electron') return { safeStorage: { isEncryptionAvailable: () => encryptionAvailable, encryptString: s => Buffer.from('encrypted:' + s), decryptString: b => { if (decryptFails) throw new Error('fixture unavailable'); return b.toString().slice(10); } } };
  return originalLoad.call(this, name, ...rest);
};
const agentPath = require.resolve('../src/main/agent/agent');
require(agentPath);
const originalAgent = require.cache[agentPath].exports;
require.cache[agentPath].exports = { createAgent(deps) { agentDeps = deps; return {}; } };
const { createAgentService } = require('../src/main/agent-service');
Module._load = originalLoad;
require.cache[agentPath].exports = originalAgent;
const P = require('../src/main/paths');
const events = [];
const credentials = {
  encrypt(s) { if (!encryptionAvailable) throw new Error('fixture unavailable'); return Buffer.from('encrypted:' + s).toString('base64'); },
  decrypt(s) { if (decryptFails) throw new Error('fixture unavailable'); return Buffer.from(s, 'base64').toString().slice(10); }
};
const service = createAgentService({ credentials, services: {}, host: {}, log: { error() {}, warn() {} }, emit: (channel, value) => events.push({ channel, value }) });
test('builtin service presents plans using the actual plan UI channel', async () => {
  const plan = { title: 'approval', steps: ['inspect'] };
  const approval = agentDeps.confirm({ kind: 'plan', plan });
  assert.deepEqual(events.at(-1), { channel: 'agent-plan', value: plan });
  service.confirm('exec');
  assert.equal(await approval, 'exec');
});
test('builtin service treats a missing confirmation choice as denial', async () => {
  const approval = agentDeps.confirm({ kind: 'tool' });
  service.confirm();
  assert.equal(await approval, 'deny');
});
test('saving a key refuses to claim success when durable encryption is unavailable', () => {
  assert.throws(() => service.saveConfig({ key: 'fixture-key-never-write-plaintext' }), /加密|保存/);
  assert.equal(service.rawConfig().key, '');
  assert.equal(fs.existsSync(P.agent) && fs.readFileSync(P.agent, 'utf8').includes('fixture-key-never-write-plaintext'), false);
  assert.equal(service.publicConfig().keyPersistence, 'none');
});
test('encrypted credentials survive the delayed config-store flush', async () => {
  encryptionAvailable = true;
  service.saveConfig({ key: 'fixture-secret', model: 'fixture-model' });
  await new Promise(resolve => setTimeout(resolve, 500));
  const saved = JSON.parse(fs.readFileSync(P.agent, 'utf8'));
  assert.equal(saved.keyEnc, Buffer.from('encrypted:fixture-secret').toString('base64'));
  assert.equal(saved.key, undefined);
  assert.equal(saved.model, 'fixture-model');
});
const restart = () => createAgentService({ credentials, services: {}, host: {}, log: { error() {}, warn() {} }, emit() {} });
test('a new service instance restores the key after restart without a renderer sending it again', () => {
  encryptionAvailable = true;
  service.saveConfig({ key: 'fixture-restart-secret' });
  assert.equal(restart().rawConfig().key, 'fixture-restart-secret');
});
test('temporary decryption failure preserves the exact ciphertext across boot and other config saves', () => {
  const cipher = JSON.parse(fs.readFileSync(P.agent, 'utf8')).keyEnc;
  decryptFails = true;
  const restarted = restart();
  assert.equal(restarted.publicConfig().keyPersistence, 'unavailable');
  assert.equal(restarted.rawConfig().key, '');
  restarted.saveConfig({ model: 'updated-without-secret' });
  assert.equal(JSON.parse(fs.readFileSync(P.agent, 'utf8')).keyEnc, cipher);
  decryptFails = false;
  assert.equal(restart().rawConfig().key, 'fixture-restart-secret');
});
test('a disk write failure rejects saving and restores the prior usable configuration', () => {
  const before = service.rawConfig();
  fs.renameSync(P.agent, P.agent + '.fixture');
  fs.mkdirSync(P.agent);
  try {
    assert.throws(() => service.saveConfig({ key: 'replacement-not-saved', model: 'not-saved' }), /保存|写入/);
    assert.deepEqual(service.rawConfig(), before);
  } finally {
    fs.rmdirSync(P.agent);
    fs.renameSync(P.agent + '.fixture', P.agent);
  }
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
