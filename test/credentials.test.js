'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentials } = require('../src/main/credentials');
test('Windows credentials use a durable DPAPI envelope and send secrets only through stdin', () => {
  let call;
  const c = createCredentials({ platform: 'win32', spawnSync(exe, args, opts) { call = { exe, args, opts }; return { status: 0, stdout: 'Y2lwaGVy' }; } });
  assert.equal(c.encrypt('fixture-private-key'), 'dpapi:user:v1:Y2lwaGVy');
  assert.equal(call.opts.input, Buffer.from('fixture-private-key').toString('base64'));
  assert.equal(call.opts.windowsHide, true);
  assert.equal(JSON.stringify(call.args).includes('fixture-private-key'), false);
  assert.equal(call.opts.env, undefined);
});
test('DPAPI decrypt restores Unicode and does not use Electron Local State', () => {
  const c = createCredentials({ platform: 'win32', spawnSync(exe, args, opts) {
    assert.equal(opts.input, 'Y2lwaGVy');
    return { status: 0, stdout: Buffer.from('fixture-中文-key').toString('base64') };
  } });
  assert.equal(c.decrypt('dpapi:user:v1:Y2lwaGVy'), 'fixture-中文-key');
});
test('legacy Electron-encrypted keys remain readable', () => {
  const c = createCredentials({ platform: 'win32', safeStorage: { decryptString(b) { assert.equal(b.toString(), 'old-cipher'); return 'fixture-old-key'; } } });
  assert.equal(c.decrypt(Buffer.from('old-cipher').toString('base64')), 'fixture-old-key');
});
test('native encryption errors reject without returning captured secret output', () => {
  const c = createCredentials({ platform: 'win32', spawnSync() { return { status: 1, stderr: 'fixture-private-key' }; } });
  assert.throws(() => c.encrypt('fixture-private-key'), e => /DPAPI/.test(e.message) && !e.message.includes('fixture-private-key'));
});
test('a Windows ciphertext is not silently reinterpreted on another platform', () => {
  const c = createCredentials({ platform: 'linux' });
  assert.throws(() => c.decrypt('dpapi:user:v1:Y2lwaGVy'), /Windows/);
});
