'use strict';
// Test-owned Electron launch with a loopback provider. Never load real user data.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const root = process.env.NAILONG_REVIEW_APP || path.resolve(__dirname, '../..');
const evidence = process.env.NAILONG_UI_EVIDENCE;
if (!process.env.NAILONG_DATA_DIR || !evidence) throw new Error('Isolated data and evidence directories are required');
process.env.WIDGET_AUDIT = '1';
const requests = [];
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', b => { raw += b; });
  req.on('end', () => {
    const body = JSON.parse(raw); requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = { id: 'ui-fixture', object: 'chat.completion.chunk', created: 1, model: body.model };
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: 'ui-fixture-complete' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(process.env.NAILONG_DATA_DIR, 'agent.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', key: 'fake-local-ui-key', provider: 'openai', model: 'ui-chat', maxTokens: 2048, temperature: 0.3, modelCatalog: [{ id: 'ui-chat', reasoning: false, vision: false, maxTokens: 2048 }, { id: 'ui-reasoner', reasoning: true, vision: true, maxTokens: 2048 }] }));
  fs.writeFileSync(path.join(process.env.NAILONG_DATA_DIR, 'settings.json'), JSON.stringify({ onboardingDone: true, sound: true, agent: { engine: 'pi', piConfig: 'bundled', thinking: 'off', workspace: process.env.NAILONG_DATA_DIR, policy: { mode: 'readonly', maxSteps: 3, maxRuntimeMs: 60000 } } }));
  const auditPath = path.join(root, 'src/main/audit.js');
  require(auditPath);
  require.cache[require.resolve(auditPath)].exports = { runAudit: runUI };
  require(path.join(root, 'main.js'));
});
async function runUI({ windows, services, setMode }) {
  const checks = [];
  const exec = (kind, code) => windows.get(kind).webContents.executeJavaScript(code, true);
  const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks.push(label); };
  const shot = async (kind, name) => fs.writeFileSync(path.join(evidence, name + '.png'), (await windows.get(kind).webContents.capturePage()).toPNG());
  fs.mkdirSync(evidence, { recursive: true });
  try {
    windows.show('settings');
    for (let i=0;i<80;i++) { if (await exec('settings', "$('save').onclick && $('base').value.includes('127.0.0.1')")) break; await new Promise(r=>setTimeout(r,50)); }
    check('save visible without scrolling', await exec('settings', "$('save').getBoundingClientRect().bottom < innerHeight && $('save').getBoundingClientRect().height > 0"));
    await shot('settings', 'harness-connection');
    await exec('settings', "document.querySelector('[data-config=models]').click();$('modelSearch').value='reasoner';$('modelSearch').oninput()");
    check('catalog search narrows to one model', await exec('settings', "$('modelCatalogList').querySelectorAll('button').length"), 1);
    await exec('settings', "$('modelCatalogList').querySelector('button').click()");
    check('catalog selection loads actual reasoning metadata', await exec('settings', "$('modelReasoning').value"), 'true');
    await new Promise(r=>setTimeout(r,250));
    check('late kernel initialization does not overwrite the selected profile', await exec('settings', "$('catalogModel').value"), 'ui-reasoner');
    check('search field has the shared visual style', await exec('settings', "parseFloat(getComputedStyle($('modelSearch')).borderRadius)>0"));
    check('profile save is visible without scrolling', await exec('settings', "$('saveModelProfile').getBoundingClientRect().bottom < innerHeight"));
    await shot('settings', 'harness-models');
    await exec('settings', "$('saveModelProfile').onclick()");
    check('profile save commits through the actual encrypted IPC transaction', await exec('settings', "api.agentCfgGet().then(c=>c.model === 'ui-reasoner' && c.hasKey)"));
    check('saving a reasoning profile starts the kernel and enables its effort control', await exec('settings', "!$('thinkingDefault').disabled && Array.from($('thinkingDefault').options).some(o=>o.value==='high')"));
    setMode('assistant');
    await exec('assistant', 'pickModel()');
    await exec('assistant', "$('pickerSearch').value='reasoner';$('pickerSearch').oninput()");
    check('assistant model search narrows to one model', await exec('assistant', "$('pickerList').querySelectorAll('button').length"), 1);
    await shot('assistant', 'harness-model-picker');
    await exec('assistant', "$('pickerList').querySelector('button').onclick()");
    check('selected model is applied to real kernel', await exec('assistant', "api.agentEngine().then(i=>i.pi.model)"), 'ui-reasoner');
    await exec('assistant', 'pickThinking()');
    check('unsupported max effort is absent', await exec('assistant', "!$('pickerList').textContent.includes('最高')"));
    await shot('assistant', 'harness-thinking-picker');
    await exec('assistant', "Array.from($('pickerList').querySelectorAll('button')).find(b=>b.textContent.includes('high')).onclick()");
    check('effort persisted through actual IPC', services.settings.agentCfg().thinking, 'high');
    await exec('assistant', "$('msgInput').value='verify harness';send()");
    for (let i = 0; i < 50; i++) { if (await exec('assistant', "$('msgs').textContent.includes('ui-fixture-complete')")) break; await new Promise(r => setTimeout(r, 100)); }
    check('configured effort reached the actual HTTP request', requests[0].reasoning_effort, 'high');
    check('configured output limit reached the actual HTTP request', requests[0].max_tokens ?? requests[0].max_completion_tokens, 2048);
    await exec('assistant', "toolCard({id:'duplicate-fixture',name:'fixture',args:{a:1}});toolCard({id:'duplicate-fixture',name:'fixture',args:{a:1},running:true});toolResult({id:'duplicate-fixture',name:'fixture',ok:true,text:'done',ms:7})");
    check('one call produces one completed tool card', await exec('assistant', "$('msgs').querySelectorAll('.tool').length"), 1);
    await shot('assistant', 'harness-conversation');
    windows.get('assistant').setSize(760, 780); windows.hide('assistant'); windows.show('assistant');
    check('expanded assistant size survives hide and reopen', windows.get('assistant').getBounds().width, 760);
    await shot('assistant', 'harness-expanded');
    await exec('assistant', "$('workspacePill').onclick()");
    await new Promise(r=>setTimeout(r,100));
    check('workspace shortcut opens runtime controls', await exec('settings', "!$('config-runtime').hidden"));
    await exec('assistant', "api.agentSetModel({provider:'nailong',modelId:'missing-fixture'}).then(r=>{window.__invalidResult=r})");
    check('unknown model returns failure without changing the selection', await exec('assistant', "window.__invalidResult.ok === false && $('modelPill').textContent.includes('ui-reasoner')"));
    await exec('settings', "(async()=>{document.querySelector('[data-config=runtime]').click();await renderEngine();await refreshThinkingControl()})()");
    check('settings reads the effective effort from the kernel', await exec('settings', "$('thinkingDefault').value"), 'high');
    await shot('settings', 'harness-runtime');
    check('MP3 decodes in real Chromium', await exec('pet', "new Promise((resolve,reject)=>{const a=new Audio('../assets/sounds/andy.mp3');const t=setTimeout(()=>reject(new Error('MP3 metadata timeout')),5000);a.onloadedmetadata=()=>{clearTimeout(t);resolve(Number.isFinite(a.duration)&&a.duration>0)};a.onerror=()=>{clearTimeout(t);reject(new Error('MP3 decode error'))};a.load()})"));
    await exec('pet', "WidgetAudio.stop();WidgetAudio.setEnabled(false)");
    setMode('normal'); setMode('assistant');
    check('muted welcome is suppressed', await exec('pet', '!WidgetAudio.probe().playing'));
    check('startup welcome reached actual playback', await exec('pet', "WidgetAudio.probe().played.includes('startup')"));
    setMode('normal');
    await new Promise(r=>setTimeout(r,2600));
    await exec('pet', 'WidgetAudio.setEnabled(true)');
    setMode('assistant');
    await new Promise(r=>setTimeout(r,150));
    check('opening assistant plays Andy once', await exec('pet', "WidgetAudio.probe().scene === 'assistantOpen' && WidgetAudio.probe().played.includes('assistantOpen')"));
    await exec('pet', 'WidgetAudio.stop()');
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.NAILONG_DATA_DIR, 'agent.json')));
    check('UI model selection is durable and plaintext key is absent', cfg.model === 'ui-reasoner' && !cfg.key && !!cfg.keyEnc);
    check('no renderer console errors', windows.auditErrors.length, 0);
    fs.writeFileSync(path.join(evidence, 'harness-ui.json'), JSON.stringify({ checks, requests: requests.length, problems: [] }, null, 2));
    console.log('PASS harness UI: ' + checks.length + ' actual Electron checks; local model request; MP3 decoder; no live account used');
    return { problems: [] };
  } catch (e) {
    fs.writeFileSync(path.join(evidence, 'harness-ui.json'), JSON.stringify({ checks, problems: [e.stack] }, null, 2));
    throw e;
  } finally { server.close(); }
}
