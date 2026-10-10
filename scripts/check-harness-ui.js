#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-harness-ui-'));
const env = { ...process.env, NAILONG_DATA_DIR: dir, NAILONG_UI_EVIDENCE: path.join(root, '.cache/adversarial-review/previews') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const exe = process.env.NAILONG_UI_EXE || require('electron');
  const r = spawnSync(exe, [path.join(root, 'test/fixtures/harness-ui.cjs')], { env, cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.error) throw r.error;
  const completed = /PASS harness UI: 25 actual Electron checks;/.test(r.stdout || '');
  if (r.status === 0 && !completed) throw new Error('Harness UI did not produce the expected 25-check completion evidence');
  process.exitCode = r.status === 0 && completed ? 0 : 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
