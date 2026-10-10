'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const root = process.env.NAILONG_REVIEW_APP || path.resolve(__dirname, '../..');
const evidence = process.env.NAILONG_CATCH_EVIDENCE;
if (!process.env.NAILONG_DATA_DIR || !evidence) throw new Error('Isolated data and evidence are required');
process.env.WIDGET_AUDIT = '1';
fs.writeFileSync(path.join(process.env.NAILONG_DATA_DIR, 'settings.json'), JSON.stringify({ onboardingDone: true, sound: false, privacy: { clipboardHistory: false }, agent: { engine: 'builtin' } }));
const auditPath = path.join(root, 'src/main/audit.js');
require(auditPath);
require.cache[require.resolve(auditPath)].exports = { runAudit: runUI };
require(path.join(root, 'main.js'));
const delay = ms => new Promise(r => setTimeout(r, ms));
async function runUI({ windows, setMode }) {
  fs.mkdirSync(evidence, { recursive: true });
  const result = { checks: [], problems: [], brands: [], states: [], events: [] };
  const originalSend = windows.send;
  windows.send = (kind, channel, payload) => {
    if (kind === 'pet' && channel === 'pet-ping' && ['catch-start', 'catch-end'].includes(payload.action)) result.events.push({ at: Date.now(), ...payload });
    return originalSend(kind, channel, payload);
  };
  const evaluate = code => windows.get('pet').webContents.executeJavaScript(code, true);
  const clickPet = (x = 95, y = 178, button = 'left') => {
    const pet = windows.get('pet');
    pet.show(); pet.focus();
    pet.webContents.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    pet.webContents.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
  };
  async function verify(label, operation) {
    try { await operation(); result.checks.push(label); }
    catch (e) { result.problems.push(label + ': ' + e.stack); }
    result.states.push({ label, state: await evaluate('({catchOn:state.catchOn, mode:state.mode, ping:state.ping})') });
  }
  await verify('clicking the running character completes the catch game', async () => {
    await evaluate('api.settingsSave({sound:true})'); await delay(80);
    windows.show('menu'); await delay(200);
    await windows.get('menu').webContents.executeJavaScript("document.querySelector('[data-mode=catch]').click()", true);
    await delay(1150);
    assert.equal(await evaluate('state.catchOn'), true);
    clickPet();
    await delay(140);
    assert.equal(await evaluate('state.catchOn'), false, 'pointerdown must reach the actual game, not just the tool window');
    assert.equal(await evaluate("!!state.ping && state.ping.text.includes('🎉')"), true);
    assert.equal(await evaluate('state.mode'), 'normal');
    assert.equal(await evaluate("$('bubble').classList.contains('show') && $('bubble').textContent.includes('抓到啦')"), true, 'success must be visible even with a pending reminder');
    result.catchAudio = await evaluate('WidgetAudio.probe()');
    assert.equal(result.catchAudio.scene, 'catchWin');
    assert.ok(result.catchAudio.played.includes('catchWin'), 'Chromium must actually start playing the winning laugh');
    assert.deepEqual(result.catchAudio.errors, []);
    fs.writeFileSync(path.join(evidence, 'catch-win.png'), (await windows.get('pet').webContents.capturePage()).toPNG());
    await evaluate('api.settingsSave({sound:false})');
  });
  await verify('empty space and right click do not count as catches', async () => {
    setMode('catch'); await delay(150);
    clickPet(10, 150); await delay(80); assert.equal(await evaluate('state.catchOn'), true);
    clickPet(95, 178, 'right'); await delay(80); assert.equal(await evaluate('state.catchOn'), true);
    windows.hide('menu');
    clickPet(); await delay(80); assert.equal(await evaluate('state.catchOn'), false);
  });
  await verify('a second round can be caught after the first', async () => {
    setMode('catch'); await delay(1150); clickPet(); await delay(80);
    assert.equal(await evaluate('state.catchOn'), false);
    assert.equal(await evaluate("!!state.ping && state.ping.text.includes('🎉')"), true);
  });
  if (process.env.NAILONG_CATCH_QUICK !== '1') await verify('timeout stops the game and shows a retry message', async () => {
    setMode('catch'); await delay(30300);
    assert.equal(await evaluate('state.catchOn'), false);
    assert.equal(await evaluate('state.mode'), 'normal');
    assert.equal(await evaluate("!!state.ping && state.ping.text.includes('再来一局')"), true);
  });
  setMode('normal');
  await verify('Windows taskbar properties identify the character rather than Electron', async () => {
    for (const kind of ['assistant', 'settings']) windows.show(kind);
    await delay(250);
    const handles = ['assistant', 'settings'].map(kind => ({ kind, hwnd: Number(windows.get(kind).getNativeWindowHandle().readBigUInt64LE()) }));
    const output = await promisify(execFile)('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'window-brand.ps1'), '-Handles', JSON.stringify(handles), '-OutDir', evidence], { windowsHide: true, timeout: 15000 });
    result.brands = JSON.parse(Buffer.from(output.stdout.trim(), 'base64').toString('utf8'));
    for (const brand of result.brands) {
      assert.equal(brand.appId, 'com.nailong.assistant');
      assert.ok(brand.iconResource && brand.iconResource.includes('icon.ico'), 'runtime shell icon resource is required');
      assert.ok(brand.relaunchCommand && brand.displayName, 'pin/relaunch must preserve app identity');
      const icon = brand.iconResource.replace(/,0$/, '');
      assert.deepEqual(fs.readFileSync(icon), fs.readFileSync(path.join(root, 'assets/icon.ico')));
      assert.ok(icon.startsWith(process.env.NAILONG_DATA_DIR + path.sep), 'portable icon must survive outside extracted app resources');
    }
  });
  result.rendererErrors = windows.auditErrors;
  for (const error of result.rendererErrors) result.problems.push(error);
  fs.writeFileSync(path.join(evidence, 'catch-brand-ui.json'), JSON.stringify(result, null, 2));
  for (const problem of result.problems) console.error(problem);
  console.log('CATCH_BRAND_UI_RESULT ' + JSON.stringify({ passed: result.checks.length, failed: result.problems.length }));
  return result;
}
