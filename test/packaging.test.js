'use strict';
/* 打包相关的回归测试
 *
 * 这些断言看着“像在看源码”，但对应的都是打包后才会暴露、而且一暴露就是白屏/数据丢失级别的坑：
 *   1. 数据目录落在只读的 app.asar 里 → 什么都写不进去
 *   2. portable 版把数据写在 %TEMP% 解压目录里 → 一关就没了
 *   3. 外部进程（PowerShell / pi 子进程）去读 asar 内的文件 → 直接报找不到
 *   4. auto 模式下预热被误判成“用内置”而跳过 → pi 内核永远起不来
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const P = require(path.join(SRC, 'main', 'paths.js'));

test('打包：数据目录绝不会落在 app.asar 里', () => {
  assert.equal(/app\.asar/.test(P.ROOT), false, 'ROOT 不能是 asar 内部路径：' + P.ROOT);
  // 开发时应当就是源码目录，保持既有数据不搬家
  assert.equal(P.ROOT, ROOT);
});

test('打包：portable 模式下以 PORTABLE_EXECUTABLE_DIR 为准（否则数据会写进 %TEMP%）', () => {
  const src = fs.readFileSync(path.join(SRC, 'main', 'paths.js'), 'utf8');
  const body = src.slice(src.indexOf('function exeDir()'), src.indexOf('function exeDir()') + 600);
  assert.ok(/PORTABLE_EXECUTABLE_DIR/.test(body), 'exeDir() 必须优先看 PORTABLE_EXECUTABLE_DIR');
  const pick = src.slice(src.indexOf('function pickDataRoot()'), src.indexOf('function pickDataRoot()') + 900);
  const iExe = pick.indexOf('if (exe) candidates.push(exe)');
  const iCode = pick.indexOf('if (!PACKAGED) candidates.push(CODE_ROOT)');
  assert.ok(iExe >= 0 && iCode >= 0 && iExe < iCode, 'exe 目录必须排在源码目录之前');
  assert.ok(/isWritable/.test(pick), '每个候选目录都要先试写，否则只读目录会直接崩');
});

test('打包：外部进程要用的资源走解包后的真实路径', () => {
  // native / pi-ext 是给 PowerShell 和 pi 子进程用的，绝不能指向 asar 内部
  assert.equal(/app\.asar[\\/]/.test(P.native + path.sep), false);
  assert.equal(/app\.asar[\\/]/.test(P.piExt + path.sep), false);
  assert.ok(P.unpacked, 'unpacked() 工具函数要保留（将来重新启用 asar 时用得上）');
  assert.equal(P.unpacked(P.native), P.native, '非 asar 路径应当原样返回');
});

test('打包：代码目录与数据目录是两个概念，不能混用', () => {
  assert.ok(P.code, '必须有 code 根（renderer/native/assets/node_modules 都靠它）');
  assert.notEqual(P.code, undefined);
  assert.ok(fs.existsSync(path.join(P.code, 'renderer', 'ui.css')), 'code 根下要能找到 renderer');
  assert.ok(fs.existsSync(path.join(P.native, 'win.ps1')), 'native 目录下要能找到脚本');
  assert.ok(fs.existsSync(path.join(P.piExt, 'nailong.mjs')), 'pi-ext 下要能找到扩展');
});

test('打包：auto 模式预热不能被 activeEngine() 误判掉', () => {
  const src = fs.readFileSync(path.join(SRC, 'main', 'engines', 'index.js'), 'utf8');
  const body = src.slice(src.indexOf('async warmUp()'), src.indexOf('async warmUp()') + 900);
  // 只看代码行：注释里提到 activeEngine() 不算数
  const code = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(/engineSetting\(\) === 'builtin'/.test(code), 'warmUp 应当按“设置”判断，而不是当前生效引擎');
  assert.equal(/activeEngine\(\)/.test(code), false,
    'warmUp 里不能用 activeEngine()：pi 未启动时它返回 builtin，会把预热直接跳过：\n' + code);
});

test('打包：activeEngine() 的优先级正确（已就绪/启动中/失败）', () => {
  const src = fs.readFileSync(path.join(SRC, 'main', 'engines', 'index.js'), 'utf8');
  const body = src.slice(src.indexOf('function activeEngine()'), src.indexOf('function activeEngine()') + 800);
  assert.ok(/if \(pi\.ready\) return pi\.model \? 'pi' : 'builtin'/.test(body), '就绪但没模型要退回内置');
  assert.ok(/if \(pi\.starting\) return 'pi'/.test(body), '启动中就先当 pi，别把消息路由到内置');
});

test('打包：electron-builder 配置能支持“点开即用”', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const b = pkg.build;
  assert.equal(b.asar, false, '这里刻意关掉 asar（外部进程读不了 asar），要留着这个决定');
  const targets = b.win.target.map((t) => t.target);
  assert.ok(targets.indexOf('portable') >= 0, '必须有 portable：双击就跑，不需要装');
  assert.ok(targets.indexOf('nsis') >= 0, '也要有 nsis 安装包');
  assert.equal(b.nsis.deleteAppDataOnUninstall, false, '卸载不能删用户数据');
  assert.ok(b.files.indexOf('pi-ext/**') >= 0, 'pi 扩展必须打进包');
  assert.ok(b.files.indexOf('native/**') >= 0, 'PowerShell 脚本必须打进包');
  assert.ok(b.files.indexOf('!**/scripts/**') >= 0, '开发脚本不该进包');
});
