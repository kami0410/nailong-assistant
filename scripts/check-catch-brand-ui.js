'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-catch-brand-'));
const evidence = path.resolve(process.env.NAILONG_CATCH_EVIDENCE || path.join(root, '.cache/adversarial-review/catch-brand'));
const env = { ...process.env, NAILONG_DATA_DIR: dir, NAILONG_CATCH_EVIDENCE: evidence };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const r = spawnSync(require('electron'), [path.join(root, 'test/fixtures/catch-brand-ui.cjs')], { env, cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.error) throw r.error;
  process.exitCode = r.status === 0 && /CATCH_BRAND_UI_RESULT.*"failed":0/.test(r.stdout || '') ? 0 : 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
