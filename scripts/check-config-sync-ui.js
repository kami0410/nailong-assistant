'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-config-sync-'));
const env = { ...process.env, NAILONG_DATA_DIR: data, NAILONG_SYNC_EVIDENCE: process.env.NAILONG_SYNC_EVIDENCE || path.join(root, '.cache/adversarial-review/config-sync') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const phase of ['save', 'restart']) {
    if (phase === 'restart') env.NAILONG_SYNC_RESTART = '1';
    const r = spawnSync(require('electron'), [path.join(root, 'test/fixtures/config-sync-ui.cjs')], { env, cwd: root, encoding: 'utf8', timeout: 45000, windowsHide: true });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    if (r.error) throw r.error;
    if (r.status !== 0 || !/CONFIG_SYNC_RESULT.*"failed":0/.test(r.stdout || '')) { process.exitCode = 1; break; }
  }
} finally { fs.rmSync(data, { recursive: true, force: true }); }
