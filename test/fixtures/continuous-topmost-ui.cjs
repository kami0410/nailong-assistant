'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { BrowserWindow, screen } = require('electron');
const root = process.env.NAILONG_REVIEW_APP || path.resolve(__dirname, '../..');
const data = process.env.NAILONG_DATA_DIR;
const evidence = process.env.NAILONG_TOPMOST_EVIDENCE;
if (!data || !evidence) throw new Error('Test-owned data and evidence required');
process.env.WIDGET_AUDIT = '1';
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ onboardingDone: true, sound: false, privacy: { clipboardHistory: false }, agent: { engine: 'builtin', policy: { maxRuntimeMs: 60000 } } }));
const auditPath = path.join(root, 'src/main/audit.js');
require(auditPath); require.cache[require.resolve(auditPath)].exports = { runAudit: runUI };
require(path.join(root, 'main.js'));
const delay = ms => new Promise(r => setTimeout(r, ms));
const handle = w => Number(w.getNativeWindowHandle().readBigUInt64LE());
async function runUI({ windows }) {
  const result = { checks: [], problems: [], native: [] };
  fs.mkdirSync(evidence, { recursive: true });
  const pet = windows.get('pet');
  const display = screen.getPrimaryDisplay().bounds;
  const cover = new BrowserWindow({ x: display.x, y: display.y, width: display.width, height: display.height, show: false, backgroundColor: '#e9edf0', webPreferences: { sandbox: true } });
  await cover.loadURL('data:text/html,<html><body style="font-family:sans-serif">Window layering acceptance fixture</body></html>');
  async function check(label, op) { try { await op(); result.checks.push(label); } catch (e) { result.problems.push(label + ': ' + e.message); } }
  async function probe(label) {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'topmost-probe.ps1'), '-Pet', String(handle(pet)), '-Cover', String(handle(cover)), '-FocusCover'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    await delay(1250);
    const native = JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'topmost-probe.ps1'), '-Pet', String(handle(pet)), '-Cover', String(handle(cover))], { encoding: 'utf8', timeout: 10000, windowsHide: true }));
    result.native.push({ label, ...native });
    assert.equal(native.petTopmost, true);
    assert.equal(native.petAboveCover, true);
    assert.equal(native.foreground, handle(cover), 'pet must not steal typing focus');
  }
  try {
    await check('pet stays above a maximized foreground window without stealing focus', async () => { cover.show(); cover.maximize(); cover.focus(); await probe('maximized'); });
    await check('pet stays above a borderless fullscreen window', async () => { cover.setFullScreen(true); cover.focus(); await probe('fullscreen'); });
    cover.setFullScreen(false);
    await check('pet recovers above another topmost window', async () => { cover.setAlwaysOnTop(true, 'screen-saver'); cover.show(); cover.moveTop(); cover.focus(); await probe('competing-topmost'); });
    await check('pet restores a lost native topmost flag', async () => { pet.setAlwaysOnTop(false); cover.moveTop(); cover.focus(); await probe('topmost-restored'); });
    await check('hidden pet remains hidden', async () => { pet.hide(); await delay(1300); assert.equal(pet.isVisible(), false); pet.showInactive(); });
    cover.hide();
    await check('settings remove the duration input and describe manual stopping', async () => {
      windows.show('settings');
      await delay(300);
      const contents = windows.get('settings').webContents;
      assert.equal(await contents.executeJavaScript("document.getElementById('maxRuntime') === null && document.getElementById('taskDurationHint').textContent.includes('不设总时长')"), true);
      await contents.executeJavaScript("document.querySelector('[data-page=perm]').click()");
      await delay(300);
      assert.equal(await contents.executeJavaScript("document.getElementById('p-perm').getBoundingClientRect().height > 0 && document.getElementById('taskDurationHint').getBoundingClientRect().height > 0"), true);
      fs.writeFileSync(path.join(evidence, 'continuous-work-settings.png'), (await contents.capturePage()).toPNG());
    });
    await check('window recreation retains topmost protection', async () => {
      // 主应用关闭桌宠会退出；使用同一个生产窗口工厂的独立实例验证重建。
      const { createWindows } = require(path.join(root, 'src/main/windows'));
      const manager = createWindows({ app: require('electron').app, log: { warn() {}, debug() {} }, settings: {} });
      const first = manager.createPet(); await delay(500); first.destroy();
      const recreated = manager.createPet(); await delay(500);
      assert.equal(recreated.isVisible(), true); assert.equal(recreated.isAlwaysOnTop(), true);
      cover.show(); cover.moveTop(); cover.focus(); await delay(1250);
      const native = JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'topmost-probe.ps1'), '-Pet', String(handle(recreated)), '-Cover', String(handle(cover))], { encoding: 'utf8', timeout: 10000, windowsHide: true }));
      try { result.native.push({ label: 'recreated', ...native }); assert.equal(native.petTopmost, true); assert.equal(native.petAboveCover, true); } finally { manager.dispose(); }
    });
    result.problems.push(...windows.auditErrors);
    fs.writeFileSync(path.join(evidence, 'continuous-topmost.json'), JSON.stringify(result, null, 2));
    console.log('CONTINUOUS_TOPMOST_RESULT ' + JSON.stringify({ passed: result.checks.length, failed: result.problems.length }));
    result.problems.forEach(p => console.error(p));
    return result;
  } finally { cover.destroy(); }
}
