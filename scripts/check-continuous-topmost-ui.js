'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-topmost-'));
const env = { ...process.env, NAILONG_DATA_DIR: data, NAILONG_TOPMOST_EVIDENCE: process.env.NAILONG_TOPMOST_EVIDENCE || path.join(root, '.cache/adversarial-review/continuous-topmost') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const result = spawnSync(require('electron'), [path.join(root, 'test/fixtures/continuous-topmost-ui.cjs')], { cwd: root, env, encoding: 'utf8', timeout: 60000, windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  process.exitCode = result.status === 0 && /CONTINUOUS_TOPMOST_RESULT.*"passed":7,"failed":0/.test(result.stdout || '') ? 0 : 1;
} finally { fs.rmSync(data, { recursive: true, force: true }); }
