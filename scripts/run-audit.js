#!/usr/bin/env node
'use strict';
/* npm run audit —— 无头式界面自检
 * 起一次真实的 Electron，把六个窗口、所有分页、六套主题、七种形态跑一遍，
 * 把溢出/材质丢失/越界的问题写进 .cache/audit.json，并按问题数设置退出码。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function runAuditProcess(spawnImpl = spawnSync) {
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-audit-'));
  const report = path.join(dir, '.cache', 'audit.json');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboardingDone: true, sound: false, privacy: { clipboardHistory: false }, agent: { engine: 'builtin' } }));
  const env = Object.assign({}, process.env, { WIDGET_AUDIT: '1', NAILONG_DATA_DIR: dir });
  delete env.ELECTRON_RUN_AS_NODE;
  let code = 1;
  try {
    const res = spawnImpl(electron, ['.'], { cwd: ROOT, stdio: 'inherit', env, timeout: 90000 });
    if (res.error || res.status === null) throw new Error('Electron 自检未完成：' + ((res.error && res.error.message) || res.signal || '无退出码'));
    const data = JSON.parse(fs.readFileSync(report, 'utf8'));
    if (!Array.isArray(data.problems) || Object.keys(data.windows || {}).length !== 6 || !Array.isArray(data.themeSweep) || data.themeSweep.length !== 6 || !Array.isArray(data.modes) || data.modes.length !== 7) throw new Error('自检报告不完整');
    fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
    fs.copyFileSync(report, path.join(ROOT, '.cache', 'audit.json'));
    code = res.status === 0 ? 0 : 1;
    if (data.problems.length) {
    console.error('\n界面自检发现 ' + data.problems.length + ' 个问题：');
    data.problems.forEach((p) => console.error('  ✗ ' + p));
      code = 2;
    } else if (code === 0) {
      console.log('\n界面自检通过：窗口/分页/主题/形态全部正常。报告见 .cache/audit.json');
    } else {
      console.error('Electron 非正常退出：' + res.status);
    }
  } catch (e) {
    console.error('自检失败：' + e.message);
    code = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return code;
}
if (require.main === module) process.exitCode = runAuditProcess();
module.exports = { runAuditProcess };
