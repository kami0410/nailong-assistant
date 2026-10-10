#!/usr/bin/env node
'use strict';
/* 一键打包：npm run dist / dist:portable / dist:installer
 *
 * 为什么要包一层：
 *   1. 把国内镜像显式设进环境变量。`.npmrc` 已经配了同名键，但包一层更保险
 *      （比如有人用 yarn/pnpm，或者直接调 electron-builder）。
 *   2. 海外网络一个 NAILONG_NO_MIRROR=1 就能切回官方源，不用改文件。
 *   3. 打包前先跑一遍语法自检与测试，免得把坏版本打出去。
 *   4. 打完把产物大小和校验和列出来，方便和 Release 对账。
 *
 * 用法：
 *   npm run dist                 两个都打（portable + nsis）
 *   npm run dist:portable        只打免安装版
 *   npm run dist:installer       只打安装包
 *   NAILONG_NO_MIRROR=1 npm run dist    走官方源
 *   NAILONG_SKIP_CHECK=1 npm run dist   跳过打包前的自检
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

const MIRRORS = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/'
};

function targetFromArgv() {
  const a = process.argv.slice(2);
  if (a.indexOf('--portable') >= 0) return ['portable'];
  if (a.indexOf('--nsis') >= 0 || a.indexOf('--installer') >= 0) return ['nsis'];
  return ['nsis', 'portable'];
}

function buildEnv() {
  const env = Object.assign({}, process.env);
  if (process.env.NAILONG_NO_MIRROR === '1') {
    delete env.ELECTRON_MIRROR;
    delete env.ELECTRON_BUILDER_BINARIES_MIRROR;
    delete env.npm_config_electron_mirror;
    delete env.npm_config_electron_builder_binaries_mirror;
    return { env, mirrored: false };
  }
  Object.keys(MIRRORS).forEach((k) => { env[k] = env[k] || MIRRORS[k]; });
  // npm 会把 .npmrc 的键变成 npm_config_*，这里也一起兜住
  env.npm_config_electron_mirror = env.npm_config_electron_mirror || MIRRORS.ELECTRON_MIRROR;
  env.npm_config_electron_builder_binaries_mirror = env.npm_config_electron_builder_binaries_mirror || MIRRORS.ELECTRON_BUILDER_BINARIES_MIRROR;
  return { env, mirrored: true };
}

function bin(name) {
  const local = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? name + '.cmd' : name);
  return fs.existsSync(local) ? local : name;
}

// 注意：不要用 shell:true —— process.execPath 在 Windows 上可能带着空格
// （典型的 "C: / Program Files / nodejs / node.exe"），交给 cmd 会直接被拆成两半，
// 实测报错是「'C:\Program' 不是内部或外部命令」。.cmd 脚本改走 cmd /c 显式调用。
function run(cmd, args, env) {
  let file = cmd;
  let argv = args;
  if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) {
    file = process.env.ComSpec || 'cmd.exe';
    argv = ['/d', '/s', '/c', cmd].concat(args);
  }
  const r = spawnSync(file, argv, { cwd: ROOT, env, stdio: 'inherit' });
  return r.status === 0;
}

function human(bytes) {
  return (bytes / 1048576).toFixed(0) + ' MB';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const targets = targetFromArgv();
  const { env, mirrored } = buildEnv();

  console.log('── 打包前检查 ──');
  console.log('  目标：' + targets.join(' + '));
  console.log('  镜像：' + (mirrored ? '国内（npmmirror）' : '官方源'));
  if (mirrored) {
    console.log('        ' + MIRRORS.ELECTRON_MIRROR);
    console.log('        ' + MIRRORS.ELECTRON_BUILDER_BINARIES_MIRROR);
  }

  if (process.env.NAILONG_SKIP_CHECK !== '1') {
    if (!run(process.execPath, [path.join(ROOT, 'scripts', 'check-syntax.js')], env)) {
      console.error('语法自检没过，先别打包。');
      process.exit(1);
    }
    if (!run(process.execPath, ['--test', 'test/**/*.test.js'], env)) {
      console.error('测试没过，先别打包（要跳过用 NAILONG_SKIP_CHECK=1）。');
      process.exit(1);
    }
  } else {
    console.log('  （按 NAILONG_SKIP_CHECK=1 跳过了自检）');
  }

  console.log('\n── 开始打包 ──');
  const args = ['--win', ...targets, '--x64'];
  if (!run(bin('electron-builder'), args, env)) {
    console.error('\n打包失败。国内网络如果卡在下载，确认 .npmrc 里的镜像键还在，或者手动指定：');
    console.error('  ELECTRON_BUILDER_BINARIES_MIRROR=' + MIRRORS.ELECTRON_BUILDER_BINARIES_MIRROR + ' npm run dist');
    process.exit(1);
  }

  console.log('\n── 产物 ──');
  let files = [];
  try {
    files = fs.readdirSync(OUT).filter((f) => f.endsWith('.exe')).sort();
  } catch (e) { /* ignore */ }
  if (!files.length) {
    console.log('  没找到 exe，去 dist/ 看一眼');
    return;
  }
  files.forEach((f) => {
    const full = path.join(OUT, f);
    console.log('  ' + f);
    console.log('    ' + human(fs.statSync(full).size) + '  sha256=' + sha256(full));
  });
  console.log('\n免安装版可以直接双击；数据会存在它旁边。');
}

main();
