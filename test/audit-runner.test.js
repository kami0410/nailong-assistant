'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runAuditProcess } = require('../scripts/run-audit');
test('audit runner: failed startup cannot reuse an old successful report', () => {
  let dataDir;
  const result = runAuditProcess((cli, args, options) => {
    dataDir = options.env.NAILONG_DATA_DIR;
    assert.notEqual(dataDir, path.resolve(__dirname, '..'));
    assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
    return { status: 1 };
  });
  assert.equal(result, 1);
  assert.equal(fs.existsSync(dataDir), false);
});
test('audit runner: incomplete reports fail even when Electron exits zero', () => {
  assert.equal(runAuditProcess((cli, args, options) => {
    const cache = path.join(options.env.NAILONG_DATA_DIR, '.cache');
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'audit.json'), '{"problems":[]}');
    return { status: 0 };
  }), 1);
});
