'use strict';
// 用固定的非真实密钥验证 Windows DPAPI，绝不读取用户的运行数据。
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.setPath('userData', path.join(process.env.NAILONG_DATA_DIR, '.userdata'));
app.whenReady().then(() => {
  const root = process.env.NAILONG_REVIEW_APP || path.resolve(__dirname, '../..');
  const { createAgentService } = require(path.join(root, 'src/main/agent-service.js'));
  const service = createAgentService({ host: {}, services: {}, emit() {}, log: { error() {}, warn() {} } });
  const key = 'fixture-dpapi-restart-not-a-real-api-key';
  if (process.argv.includes('--legacy-write')) {
    fs.writeFileSync(path.join(process.env.NAILONG_DATA_DIR, 'agent.json'), JSON.stringify({
      baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', keyEnc: safeStorage.encryptString(key).toString('base64')
    }));
    console.log('Legacy Electron encrypted fixture saved for migration acceptance');
    app.quit();
    return;
  }
  if (process.argv.includes('--write')) {
    const c = service.saveConfig({ baseUrl: 'https://fixture.invalid/v1', key, model: 'fixture-model' });
    assert.equal(c.keyPersistence, 'encrypted');
    assert.equal(fs.readFileSync(path.join(process.env.NAILONG_DATA_DIR, 'agent.json'), 'utf8').includes(key), false);
    assert.match(JSON.parse(fs.readFileSync(path.join(process.env.NAILONG_DATA_DIR, 'agent.json'), 'utf8')).keyEnc, /^dpapi:user:v1:/);
    console.log('Windows DPAPI: encrypted save confirmed, no plaintext key on disk');
  } else {
    assert.equal(service.rawConfig().key, key);
    assert.equal(service.publicConfig().keyPersistence, 'encrypted');
    assert.equal(service.publicConfig().hasKey, true);
    assert.equal(service.rawConfig().model, 'fixture-model');
    console.log('Fresh Electron process: saved key restored and available to the engine');
  }
  // exit 不执行 Chromium 偏好写回：模拟首次保存后突然结束。
  app.exit(0);
}).catch(e => { console.error(e.message); app.exit(1); });
