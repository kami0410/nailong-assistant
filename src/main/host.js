'use strict';
/* Host：把 Electron 能力 + 原生脚本 + 业务服务打包成工具层能用的统一接口。
 * 工具只认这个对象，因此工具本身可以被单测替换。 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const providers = require('./agent/providers.js');

const MAX_SENT_WIDTH = 1400;

function createHost(deps) {
  const { app, screen, desktopCapturer, clipboard, Notification, shell, native, services, log } = deps;
  const P = deps.paths;
  let lastShot = null;

  const home = process.env.USERPROFILE || os.homedir();
  const paths = {
    root: P.ROOT,
    code: P.code,
    home: home,
    desktop: path.join(home, 'Desktop'),
    downloads: path.join(home, 'Downloads'),
    documents: path.join(home, 'Documents')
  };

  // ---------------------------------------------------------- 截图
  /** monitor: 'cursor'（默认）| 'primary' | '1' | '2'…（第几个显示器，从 1 开始） */
  function pickDisplay(monitor, cursor) {
    const m = String(monitor === undefined || monitor === null ? '' : monitor).trim().toLowerCase();
    if (m === 'primary' || m === 'main') return screen.getPrimaryDisplay();
    if (/^\d+$/.test(m)) {
      const all = screen.getAllDisplays();
      const i = parseInt(m, 10) - 1;
      if (all[i]) return all[i];
      log.warn('[host] 没有第 ' + m + ' 个显示器，改用鼠标所在的那块');
    } else if (m && m !== 'cursor') {
      log.warn('[host] 不认识的显示器：' + m + '（用鼠标所在的那块）');
    }
    return screen.getDisplayNearestPoint(cursor || screen.getCursorScreenPoint());
  }

  async function screenshot(opts) {
    const o = opts || {};
    const overlays = (deps.overlayWindows ? deps.overlayWindows() : []).filter((w) => w && !w.isDestroyed() && w.isVisible());
    overlays.forEach((w) => { try { w.setOpacity(0); } catch (e) { /* ignore */ } });
    try {
      const cursor = screen.getCursorScreenPoint();
      const disp = pickDisplay(o.monitor, cursor);
      const scale = disp.scaleFactor || 1;
      const physW = Math.round(disp.size.width * scale);
      const physH = Math.round(disp.size.height * scale);
      const targetW = Math.min(MAX_SENT_WIDTH, physW);
      const targetH = Math.max(1, Math.round(physH * targetW / physW));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: targetW, height: targetH } });
      if (!sources || !sources.length) throw new Error('没有取到屏幕画面');
      let src = sources.find((s) => String(s.display_id) === String(disp.id));
      if (!src) src = sources[0];
      let img = src.thumbnail;
      let sentW = img.getSize().width;
      let sentH = img.getSize().height;
      const scaleX = physW / sentW;
      const scaleY = physH / sentH;
      let cropX = 0, cropY = 0;

      if (o.region) {
        const m = /^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(String(o.region).trim());
        if (m) {
          const rx = Math.max(0, parseInt(m[1], 10));
          const ry = Math.max(0, parseInt(m[2], 10));
          const rw = Math.max(1, parseInt(m[3], 10));
          const rh = Math.max(1, parseInt(m[4], 10));
          const cx = Math.min(rx, sentW - 1), cy = Math.min(ry, sentH - 1);
          cropX = cx * scaleX;
          cropY = cy * scaleY;
          img = img.crop({
            x: cx, y: cy,
            width: Math.min(rw, sentW - cx),
            height: Math.min(rh, sentH - cy)
          });
          sentW = img.getSize().width;
          sentH = img.getSize().height;
        }
      }

      const jpg = img.toJPEG(o.quality || 74);
      const dataUrl = 'data:image/jpeg;base64,' + jpg.toString('base64');
      // Windows 混合 DPI 桌面的原点不能直接乘当前屏幕的 scaleFactor。
      const origin = screen.dipToScreenPoint
        ? screen.dipToScreenPoint({ x: disp.bounds.x, y: disp.bounds.y })
        : { x: Math.round(disp.bounds.x * scale), y: Math.round(disp.bounds.y * scale) };
      lastShot = { physW, physH, sentW, sentH, scaleX, scaleY, cropX, cropY,
        originX: origin.x, originY: origin.y,
        dataUrl, at: Date.now(), display: disp.id };
      return lastShot;
    } finally {
      overlays.forEach((w) => { if (w && !w.isDestroyed()) { try { w.setOpacity(1); } catch (e) { /* ignore */ } } });
    }
  }

  async function afterShot() {
    try {
      if (!deps.autoScreenshot || deps.autoScreenshot()) {
        const s = await screenshot({});
        return [s.dataUrl];
      }
    } catch (e) {
      log.warn('[host] afterShot failed: ' + e.message);
    }
    return [];
  }

  // ---------------------------------------------------------- 原生
  function input(cmd) { native.input.fire(cmd); }
  function pause(ms) { return new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }); }

  async function windowList() {
    const r = await native.win('win-list');
    return r.windows || [];
  }

  async function focusHwndFor(title) {
    if (!title) return 0;
    const list = await windowList();
    const hit = list.find((w) => w.title && w.title.toLowerCase().indexOf(String(title).toLowerCase()) >= 0);
    return hit ? hit.hwnd : 0;
  }

  async function uiTree(opts) {
    const o = opts || {};
    const hwnd = await focusHwndFor(o.windowTitle);
    const r = await native.uia.send('tree ' + (o.depth || 8) + ' ' + (o.limit || 260) + ' ' + (hwnd || 0), 25000);
    return { window: r.window, count: r.count, nodes: r.nodes || [] };
  }

  async function findElement(opts) {
    const o = opts || {};
    const hwnd = await focusHwndFor(o.windowTitle);
    const r = await native.uia.send('find ' + native.b64utf8(o.text || '') + ' ' + (hwnd || 0), 25000);
    return r.nodes || [];
  }

  async function elementAction(kind, id, text) {
    const cmd = kind === 'setvalue' ? ('setvalue ' + id + ' ' + native.b64utf8(text || '')) : (kind + ' ' + id);
    return native.uia.send(cmd, 15000);
  }

  const windowControl = (action, params) => native.win(action, params, { timeout: 30000 });
  const systemInfo = () => native.win('sysinfo', {}, { timeout: 25000 });

  function runCommand(command, cwd, timeout) {
    const script = [
      '$ErrorActionPreference = "Continue"',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      "Set-Location -LiteralPath '" + String(cwd || home).replace(/'/g, "''") + "' -ErrorAction Stop",
      command
    ].join('\n');
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], {
        windowsHide: true,
        timeout: timeout || 30000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'buffer'
      }, (err, stdout, stderr) => {
        const dec = (b) => {
          if (!b) return '';
          const buf = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
          // PowerShell 在 -EncodedCommand 下按控制台代码页输出，优先按 UTF-8 解，失败则退回 gbk 近似
          return buf.toString('utf8');
        };
        resolve({
          code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
          stdout: dec(stdout),
          stderr: dec(stderr) || (err && err.killed ? '' : ''),
          timedOut: !!(err && err.killed)
        });
      });
    });
  }

  function launch(target) {
    return new Promise((resolve, reject) => {
      const t = String(target || '').trim();
      if (!t) return reject(new Error('要打开什么？'));
      if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) {
        shell.openExternal(t).then(resolve).catch(reject);
        return;
      }
      if (fs.existsSync(t) && !/\.(exe|com)$/i.test(t)) {
        shell.openPath(t).then(error => error ? reject(new Error('打开失败：' + error)) : resolve(true), reject);
        return;
      }
      const proc = spawn(t, [], { windowsHide: true, detached: true, stdio: 'ignore' });
      proc.once('error', err => reject(new Error('打开失败：' + err.message)));
      proc.once('spawn', () => { proc.unref(); resolve(true); });
    });
  }

  function recycle(list) {
    const arr = (Array.isArray(list) ? list : []).filter(Boolean);
    if (!arr.length) return Promise.resolve({ ok: 0, fail: 0, err: '没有路径' });
    const b64 = arr.map((p) => Buffer.from(p, 'utf8').toString('base64')).join(',');
    return native.runScript(path.join(P.native, 'recycle.ps1'), ['-B64', b64], { timeout: 60000 })
      .then((out) => ({ ok: (out && out.ok) || 0, fail: (out && out.fail) || 0, err: (out && out.err) || '' }))
      .catch((e) => ({ ok: 0, fail: arr.length, err: String(e.message || e).slice(0, 160) }));
  }

  function guardPath(p) {
    let rp;
    try { rp = path.resolve(String(p)); } catch (e) { return { ok: false, reason: '路径无效' }; }
    // 解析已存在的祖先，连尚未创建的目标也不能经 junction 绕进受保护目录。
    function canonical(file) {
      let current = path.resolve(file);
      const suffix = [];
      while (!fs.existsSync(current) && path.dirname(current) !== current) {
        suffix.unshift(path.basename(current)); current = path.dirname(current);
      }
      try { return path.join(fs.realpathSync(current), ...suffix); } catch (e) { return path.resolve(file); }
    }
    rp = canonical(rp);
    const lower = rp.toLowerCase();
    const roots = [P.ROOT, P.code].filter(Boolean).map(p => canonical(p).toLowerCase());
    if (roots.some(root => lower === root || lower.startsWith(root + path.sep))) return { ok: false, reason: '这是奶蛙自己的目录，不能动' };
    const sys = /^[a-z]:\\(windows|program files( \(x86\))?|programdata)(\\|$)/i;
    if (sys.test(rp)) return { ok: false, reason: '系统目录受保护：' + rp };
    if (/^[a-z]:\\$/i.test(rp)) return { ok: false, reason: '不能直接操作盘符根目录' };
    return { ok: true };
  }

  async function screenInfo() {
    const [list, r] = await Promise.all([windowList(), native.win('screen-info', {}, { timeout: 15000 }).catch(() => ({ screens: [] }))]);
    const cursor = screen.getCursorScreenPoint();
    const disp = screen.getDisplayNearestPoint(cursor);
    const fg = list.find((w) => w.foreground);
    return {
      screens: (r.screens || []).map((s) => ({ w: s.w, h: s.h, x: s.x, y: s.y, primary: s.primary })),
      scale: disp.scaleFactor,
      cursor: { x: cursor.x, y: cursor.y },
      foreground: fg ? { title: fg.title, pid: fg.pid, hwnd: fg.hwnd } : null,
      windows: list
    };
  }

  return {
    app, log, native, services, paths, screen, shell, pickDisplay,
    MAX_SENT_WIDTH,
    screenshot, afterShot, pause, input,
    uiTree, findElement, elementAction, windowControl, windowList, screenInfo, systemInfo,
    runCommand, launch, recycle, guardPath,
    lastShot: () => lastShot,
    b64utf8: native.b64utf8,
    unb64: native.unb64,
    /** 读一张本地图片给模型看（走 Electron 的 nativeImage，顺带按长边缩放省 token） */
    readImageFile(file, maxSide) {
      const nativeImage = deps.nativeImage;
      if (!nativeImage) return { ok: false, error: '当前环境拿不到 nativeImage' };
      let img;
      try { img = nativeImage.createFromPath(String(file)); } catch (e) { return { ok: false, error: String(e.message || e) }; }
      if (!img || img.isEmpty()) return { ok: false, error: '这个文件不是能识别的图片（支持 png/jpg/gif/bmp/webp/ico）' };
      const size = img.getSize();
      const cap = Math.max(200, Math.min(4096, Number(maxSide) || 1400));
      const longest = Math.max(size.width, size.height);
      let out = { width: size.width, height: size.height, scaled: false };
      if (longest > cap) {
        const k = cap / longest;
        img = img.resize({ width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)), quality: 'good' });
        const s2 = img.getSize();
        out.width = s2.width;
        out.height = s2.height;
        out.scaled = true;
      }
      const isPng = /\.png$/i.test(String(file));
      const buf = isPng ? img.toPNG() : img.toJPEG(78);
      out.mime = isPng ? 'image/png' : 'image/jpeg';
      out.bytes = buf.length;
      out.dataUrl = 'data:' + out.mime + ';base64,' + buf.toString('base64');
      out.ok = true;
      return out;
    },
    clipboard: {
      read: () => clipboard.readText(),
      write: (t) => clipboard.writeText(String(t || '')),
      readImageSize: () => { const i = clipboard.readImage(); return i.isEmpty() ? null : i.getSize(); }
    },
    notifyNative(title, body) {
      try {
        if (Notification && Notification.isSupported && Notification.isSupported()) {
          const n = new Notification({ title: String(title || '奶蛙助手'), body: String(body || ''), silent: true });
          n.on('click', () => { if (deps.onNotificationClick) deps.onNotificationClick(); });
          n.show();
          return true;
        }
      } catch (e) { log.warn('[notify] ' + e.message); }
      return false;
    },
    playSystemSound(mode) {
      if (!services.settings.getKey('sound', true)) return Promise.resolve({ played: false });
      return native.win('sound', { B64: Buffer.from(path.join(P.assets, 'sounds', 'laugh.wav')).toString('base64') }, { timeout: 12000 }).catch((e) => {
        log.debug('[sound] 大笑播放失败：' + e.message);
        return { played: false };
      });
    },
    fetchImpl: deps.fetchImpl,
    providers
  };
}

module.exports = { createHost };
