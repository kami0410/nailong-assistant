'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-key-restart-'));
const env = { ...process.env, NAILONG_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
try {
  const exe = require('electron');
  const fixture = path.resolve(__dirname, '../test/fixtures/key-restart.cjs');
  const moved = path.join(data, 'moved-directory');
  for (const mode of ['--legacy-write', '--read', '--write', '--moved-read']) {
    const movedRead = mode === '--moved-read';
    if (movedRead) {
      fs.mkdirSync(moved);
      fs.copyFileSync(path.join(data, 'agent.json'), path.join(moved, 'agent.json'));
    }
    const run = spawnSync(exe, [fixture, movedRead ? '--read' : mode], {
      env: { ...env, NAILONG_DATA_DIR: movedRead ? moved : data }, windowsHide: true, encoding: 'utf8', timeout: 30000
    });
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0);
  }
  console.log('PASS: real Windows legacy read, DPAPI migration, abrupt-exit restart and moved-directory recovery');
} finally {
  assert.ok(path.resolve(data).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(data).startsWith('nailong-key-restart-'));
  fs.rmSync(data, { recursive: true, force: true });
}
