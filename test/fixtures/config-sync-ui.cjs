'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = process.env.NAILONG_REVIEW_APP || path.resolve(__dirname, '../..');
const data = process.env.NAILONG_DATA_DIR;
const evidence = process.env.NAILONG_SYNC_EVIDENCE;
if (!data || !evidence) throw new Error('Test-owned data and evidence are required');
process.env.WIDGET_AUDIT = '1';
const delay = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'fixture-online' } }] }));
  });
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ onboardingDone: true, sound: false, privacy: { clipboardHistory: false }, agent: { engine: 'builtin' } }));
  const auditPath = path.join(root, 'src/main/audit.js');
  require(auditPath); require.cache[require.resolve(auditPath)].exports = { runAudit: runUI };
  require(path.join(root, 'main.js'));
});
async function runUI({ windows, setMode }) {
  const result = { checks: [], problems: [] };
  fs.mkdirSync(evidence, { recursive: true });
  const exec = (kind, code) => windows.get(kind).webContents.executeJavaScript(code, true);
  async function waitFor(kind, code) {
    for (let i = 0; i < 60; i++) { if (await exec(kind, code)) return; await delay(50); }
    assert.equal(await exec(kind, code), true, code);
  }
  async function verify(label, operation) {
    try { await operation(); result.checks.push(label); } catch (e) { result.problems.push(label + ': ' + e.message); }
  }
  try {
    windows.show('settings');
    await waitFor('settings', "typeof $('save').onclick === 'function'");
    if (process.env.NAILONG_SYNC_RESTART === '1') {
      setMode('assistant');
      await verify('a fresh process uses the shared encrypted configuration without setup', async () => {
        await waitFor('assistant', "$('v-chat').style.display === 'flex' && /^•+$/.test($('cfgKey').value) && $('cfgModel').value === 'sync-final'");
        const cfg = await exec('assistant', 'api.agentCfgGet()');
        assert.equal(cfg.hasKey, true); assert.equal(cfg.keyPersistence, 'encrypted'); assert.equal(cfg.model, 'sync-final');
      });
    } else {
      const base = 'http://127.0.0.1:' + server.address().port + '/v1';
      assert.equal(await exec('assistant', "$('v-setup').style.display === 'flex'"), true, 'assistant must start with the empty, already-loaded form');
      await exec('settings', "$('base').value=" + JSON.stringify(base) + ";$('key').value='fake-sync-key';$('model').value='sync-first';$('provider').value='openai';$('modelReasoning').value='false';$('modelVision').value='false';$('modelEffort').value='standard';$('save').onclick()");
      await verify('settings save immediately refreshes the preloaded assistant', async () => {
        await waitFor('assistant', "$('v-chat').style.display === 'flex' && /^•+$/.test($('cfgKey').value) && $('cfgModel').value === 'sync-first'");
        assert.equal(await exec('assistant', "$('cfgBase').value"), base);
      });
      setMode('assistant');
      await verify('opening assistant uses the settings credentials without re-entry', async () => {
        await waitFor('assistant', "$('v-chat').style.display === 'flex'");
        assert.equal(await exec('assistant', "$('setupStatus').className === 'err'"), false);
      });
      await verify('updates while assistant is visible arrive without restarting', async () => {
        await exec('settings', "$('model').value='sync-visible';$('save').onclick()");
        await waitFor('assistant', "$('cfgModel').value === 'sync-visible' && $('v-chat').style.display === 'flex'");
      });
      await verify('reopening reconciles configuration even if a notification was missed', async () => {
        setMode('normal');
        const broadcast = windows.broadcast;
        windows.broadcast = (channel, payload) => { if (channel !== 'agent-config-changed') broadcast(channel, payload); };
        try { await exec('settings', "api.agentCfgSave({model:'sync-reopened'})"); } finally { windows.broadcast = broadcast; }
        setMode('assistant');
        await waitFor('assistant', "$('cfgModel').value === 'sync-reopened' && $('v-chat').style.display === 'flex'");
      });
      await verify('assistant changes refresh settings and retain the encrypted key', async () => {
        await exec('assistant', "(async()=>{await loadCfg();$('cfgModel').value='sync-final';await saveCfg(false)})()");
        await waitFor('settings', "$('model').value === 'sync-final' && /^•+$/.test($('key').value)");
        const cfg = await exec('settings', 'api.agentCfgGet()');
        assert.equal(cfg.hasKey, true); assert.equal(cfg.model, 'sync-final');
        assert.equal('key' in cfg, false); assert.equal('keyEnc' in cfg, false);
        const stored = JSON.parse(fs.readFileSync(path.join(data, 'agent.json')));
        assert.ok(stored.keyEnc); assert.equal('key' in stored, false);
      });
    }
    await delay(750);
    result.rendererErrors = windows.auditErrors;
    result.problems.push(...result.rendererErrors);
    fs.writeFileSync(path.join(evidence, process.env.NAILONG_SYNC_RESTART === '1' ? 'config-sync-restart.png' : 'config-sync.png'), (await windows.get('assistant').webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(evidence, process.env.NAILONG_SYNC_RESTART === '1' ? 'config-sync-restart.json' : 'config-sync.json'), JSON.stringify(result, null, 2));
    for (const problem of result.problems) console.error(problem);
    console.log('CONFIG_SYNC_RESULT ' + JSON.stringify({ passed: result.checks.length, failed: result.problems.length }));
    return result;
  } finally { server.close(); }
}
