'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const P = require('./paths');
const APP_ID = 'com.nailong.assistant';
function quoteArgument(value) {
  return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
function prepareWindowBranding(app, log) {
  let icon = P.icon;
  try {
    const bytes = fs.readFileSync(P.icon);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20);
    const dir = path.join(P.userData, 'branding');
    fs.mkdirSync(dir, { recursive: true });
    const stable = path.join(dir, 'nailong-' + hash + '-icon.ico');
    if (!fs.existsSync(stable) || !fs.readFileSync(stable).equals(bytes)) {
      const temp = stable + '.' + process.pid + '.tmp';
      try { fs.writeFileSync(temp, bytes); fs.renameSync(temp, stable); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    icon = stable;
  } catch (e) { log.warn('[branding] 持久图标写入失败：' + e.message); }
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  const executable = portable || process.execPath;
  const args = !portable && !app.isPackaged ? [P.code] : [];
  return {
    appId: APP_ID, appIconPath: icon, appIconIndex: 0,
    relaunchCommand: [executable, ...args].map(quoteArgument).join(' '),
    relaunchDisplayName: '奶蛙助手'
  };
}
module.exports = { APP_ID, prepareWindowBranding };
