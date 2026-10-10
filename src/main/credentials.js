'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PREFIX = 'dpapi:user:v1:';

function createCredentials(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const safeStorage = o.safeStorage;
  const run = o.spawnSync || spawnSync;
  function dpapi(operation, base64) {
    // 密钥走标准输入，不出现在命令行、环境变量或临时文件中。
    const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; "
      + "$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); "
      + "$out=[Security.Cryptography.ProtectedData]::" + operation
      + "($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); "
      + '[Console]::Out.Write([Convert]::ToBase64String($out))';
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = run(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      input: base64, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024
    });
    const output = String(r.stdout || '').trim();
    if (r.error || r.status !== 0 || !output || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) {
      // 不转发原生错误输出，避免任何输入片段进入日志或界面。
      throw new Error('Windows DPAPI 凭据处理失败');
    }
    return output;
  }
  return {
    encrypt(key) {
      if (typeof key !== 'string' || !key || Buffer.byteLength(key, 'utf8') > 16384) throw new Error('API 密钥长度无效');
      if (platform === 'win32') return PREFIX + dpapi('Protect', Buffer.from(key, 'utf8').toString('base64'));
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用');
      return safeStorage.encryptString(key).toString('base64');
    },
    decrypt(encoded) {
      if (String(encoded).startsWith(PREFIX)) {
        if (platform !== 'win32') throw new Error('此密钥需要原 Windows 账户');
        return Buffer.from(dpapi('Unprotect', encoded.slice(PREFIX.length)), 'base64').toString('utf8');
      }
      // 保留旧 Electron safeStorage 密文的读取能力；下一次保存升级格式。
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    }
  };
}
module.exports = { createCredentials };
