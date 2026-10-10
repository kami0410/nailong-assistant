'use strict';
/* 所有路径集中在这里
 *
 * 打包后有两个坑必须在这里解决：
 *
 *   1. **数据目录不能落在 app.asar 里**
 *      打包后 __dirname 是 <安装目录>/resources/app.asar/src/main —— 只读。
 *      ROOT 必须换算成真正可写的目录。
 *
 *   2. **portable 版每次运行会解压到 %TEMP% 下的随机目录**
 *      electron-builder 通过 PORTABLE_EXECUTABLE_DIR 告诉我们 exe 在哪。
 *      必须以它为准，否则用户数据会写在临时目录里、一关就没了。
 *
 * 于是这里区分两套根目录：
 *   code —— 代码/资源在哪（renderer / native / assets / pi-ext / node_modules）
 *           打包后在 app.asar 里；**外部进程（PowerShell、pi 子进程）读不了 asar**，
 *           所以需要解包的那几项通过 unpacked() 换成 app.asar.unpacked 的真实路径
 *   ROOT —— 用户数据在哪（可写）：环境变量 → portable exe 目录 → exe 目录 → 源码目录 → %APPDATA%
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CODE_ROOT = path.resolve(__dirname, '..', '..');

// 判定是否「打包后运行」：
//   Electron 里跑源码（electron .）→ process.defaultApp === true
//   纯 Node（单测）→ 没有 electron 版本号，当作开发环境
//   打包后的 exe → 有 electron 版本号且 defaultApp 不是 true
const IN_ELECTRON = !!process.versions.electron;
const DEV = !IN_ELECTRON || process.defaultApp === true;
const PACKAGED = !DEV;

/** 打包后 __dirname 形如 <root>/resources/app.asar/src/main，取 app.asar 的上一级（resources） */
function dirBeforeAsar(dir) {
  const parts = String(dir).split(/[\\/]/);
  const i = parts.indexOf('app.asar');
  if (i > 0) return parts.slice(0, i).join(path.sep);
  return '';
}

/** app.asar 里的文件 → app.asar.unpacked 里的真实路径（外部进程只能读后者） */
function unpacked(p) {
  const s = String(p);
  if (!/[\\/]app\.asar[\\/]/.test(s)) return s;
  return s.replace(/[\\/]app\.asar[\\/]/, path.sep + 'app.asar.unpacked' + path.sep);
}

function exeDir() {
  // portable 版：exe 所在目录由 electron-builder 告诉我们
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  // asar 打包：resources 的上一级就是 exe 目录
  const resources = dirBeforeAsar(__dirname);
  if (resources) return path.dirname(resources);
  // 非 asar 打包：代码在 <exe 目录>/resources/app，往上两层就是 exe 目录
  if (PACKAGED) return path.resolve(CODE_ROOT, '..', '..');
  return '';
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.nailong-write-probe-' + require('crypto').randomBytes(8).toString('hex'));
    fs.writeFileSync(probe, '1', { encoding: 'utf8', flag: 'wx' });
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

function pickDataRoot() {
  const candidates = [];
  if (process.env.NAILONG_DATA_DIR) candidates.push(path.resolve(process.env.NAILONG_DATA_DIR));
  const exe = exeDir();
  if (exe) candidates.push(exe);
  if (!PACKAGED) candidates.push(CODE_ROOT);          // 开发时就是源码目录，行为和以前一致
  candidates.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '奶蛙助手'));
  for (const c of candidates) {
    if (isWritable(c)) return c;
  }
  return path.join(os.tmpdir(), 'nailong-assistant');
}

const ROOT = pickDataRoot();

/** 代码侧资源（需要外部进程读的走 unpacked） */
const nativeDir = unpacked(path.join(CODE_ROOT, 'native'));
const piExtDir = unpacked(path.join(CODE_ROOT, 'pi-ext'));
const rendererDir = path.join(CODE_ROOT, 'renderer');     // Electron 自己读，asar 内没问题
const assetsDir = unpacked(path.join(CODE_ROOT, 'assets'));
const piPkgDir = unpacked(path.join(CODE_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent'));

const P = {
  // ---- 数据侧（可写，用户的东西都在这） ----
  ROOT: ROOT,
  packaged: PACKAGED,
  cache: path.join(ROOT, '.cache'),
  logs: path.join(ROOT, '.cache', 'logs'),
  userData: path.join(ROOT, '.userdata'),
  backups: path.join(ROOT, 'backups'),

  // 用户数据（v2 路径保持不变，升级不丢数据）
  tasks: path.join(ROOT, 'schedule.txt'),
  countdown: path.join(ROOT, 'countdown.txt'),
  state: path.join(ROOT, 'state.json'),
  agent: path.join(ROOT, 'agent.json'),
  petCfg: path.join(ROOT, 'pet.cfg'),
  widgetCfg: path.join(ROOT, 'widget.cfg'),
  popupCfg: path.join(ROOT, 'popup.cfg'),
  settings: path.join(ROOT, 'settings.json'),
  sessions: path.join(ROOT, 'agent-sessions.json'),
  memory: path.join(ROOT, 'agent-memory.json'),
  clipboard: path.join(ROOT, 'clipboard.json'),
  focus: path.join(ROOT, 'focus.json'),
  reminders: path.join(ROOT, 'reminders.json'),
  piSessions: path.join(ROOT, '.userdata', 'pi-sessions'),
  piAgent: path.join(ROOT, '.userdata', 'pi-agent'),
  popupBackdrop: path.join(ROOT, '.cache', 'popup-backdrop.png'),
  asstBackdrop: path.join(ROOT, '.cache', 'asst-backdrop.png'),

  // ---- 代码侧（只读资源） ----
  code: CODE_ROOT,
  native: nativeDir,
  piExt: piExtDir,
  renderer: rendererDir,
  assets: assetsDir,
  piPkg: piPkgDir,
  icon: path.join(assetsDir, 'icon.ico'),
  windowIcon: path.join(assetsDir, 'naifrog', 'icon.png'),
  unpacked: unpacked,

  // 需要备份/导出的用户数据文件
  backupFiles: [
    'schedule.txt', 'countdown.txt', 'state.json', 'agent.json',
    'settings.json', 'agent-memory.json', 'agent-sessions.json',
    'focus.json', 'pet.cfg', 'widget.cfg', 'popup.cfg'
  ]
};

module.exports = P;
