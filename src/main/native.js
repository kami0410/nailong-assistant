'use strict';
/* 原生能力桥：PowerShell 一次性脚本 + 常驻 worker（输入 / UIA 元素树）
 * 约定：脚本把结果写成单行 `ok <base64 json>` 或 `err <base64 msg>`，
 * 这样完全避开 PowerShell 5.1 的控制台代码页问题。
 */

const path = require('path');
const { execFile, spawn } = require('child_process');

function b64utf8(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }
function unb64(s) { return Buffer.from(String(s || ''), 'base64').toString('utf8'); }

function parseResult(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  if (line.startsWith('ok ')) {
    const raw = unb64(line.slice(3));
    try { return JSON.parse(raw); } catch (e) { return { raw }; }
  }
  if (line.startsWith('err ')) {
    const err = new Error(unb64(line.slice(4)));
    err.native = true;
    throw err;
  }
  throw new Error('本机脚本没有返回可识别的结果：' + line.slice(0, 200));
}

function createNative(opts) {
  const o = opts || {};
  // nativeDir 必须是解包后的真实路径：PowerShell 是外部进程，读不了 app.asar
  const root = o.root || o.nativeDir;
  const nativeDir = o.nativeDir || path.join(root, 'native');
  const log = o.log || { info() {}, warn() {}, error() {}, debug() {} };
  const winScript = path.join(nativeDir, 'win.ps1');

  const PS_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];

  function runScript(script, args, options) {
    const o2 = options || {};
    return new Promise((resolve, reject) => {
      execFile('powershell', PS_ARGS.concat(['-File', script], args || []), {
        windowsHide: true,
        timeout: o2.timeout || 20000,
        maxBuffer: 8 * 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err && !stdout) {
          const msg = String((stderr || err.message || err)).slice(0, 300);
          log.warn('[native] ' + path.basename(script) + ' failed: ' + msg);
          reject(new Error(msg));
          return;
        }
        const text = String(stdout || '').trim();
        try {
          resolve(parseResult(text));
        } catch (e) {
          // 老脚本（blur/pin/deskpos）会输出自己的文本协议，不是错误
          resolve({ raw: text });
        }
      });
    });
  }

  /** 直接跑脚本，不做 ok/err 协议解析（给 pin.ps1 / blur.ps1 这类老脚本用） */
  function runRaw(script, args, options) {
    const o2 = options || {};
    return new Promise((resolve, reject) => {
      execFile('powershell', PS_ARGS.concat(['-File', script], args || []), {
        windowsHide: true,
        timeout: o2.timeout || 20000,
        maxBuffer: 4 * 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(String(stderr || err.message).slice(0, 300)));
          return;
        }
        resolve(String(stdout || '').trim());
      });
    });
  }

  /** 调用 native/win.ps1 */
  function win(action, args, options) {
    const a = ['-Action', action];
    Object.keys(args || {}).forEach((k) => {
      const v = args[k];
      if (v === undefined || v === null) return;
      a.push('-' + k, String(v));
    });
    return runScript(winScript, a, options);
  }

  // ---------------- 常驻 worker ----------------
  function createWorker(scriptName, opts2) {
    const o3 = opts2 || {};
    let proc = null;
    let buf = '';
    let pending = null;
    let queue = [];

    function start() {
      if (proc && !proc.killed) return proc;
      proc = spawn('powershell', PS_ARGS.concat(['-WindowStyle', 'Hidden', '-File', path.join(nativeDir, scriptName)]), {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (line.trim() === '') continue;
          if (pending) {
            const p = pending;
            pending = null;
            try { p.resolve(parseResult(line)); } catch (e) { p.reject(e); }
            pump();
          }
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d) => log.debug('[worker:' + scriptName + '] ' + String(d).trim().slice(0, 400)));
      proc.on('error', (e) => {
        log.error('[worker:' + scriptName + '] spawn error: ' + e.message);
        proc = null;
        if (pending) { pending.reject(new Error('本机脚本启动失败：' + e.message)); pending = null; }
      });
      proc.on('exit', (code) => {
        if (pending) { pending.reject(new Error('本机脚本已退出（code ' + code + '）')); pending = null; }
        proc = null;
      });
      return proc;
    }

    function pump() {
      if (pending || !queue.length) return;
      const job = queue.shift();
      const p = start();
      if (!p || !p.stdin || !p.stdin.writable) {
        job.reject(new Error('本机脚本不可用'));
        pump();
        return;
      }
      pending = job;
      try { p.stdin.write(job.line + '\n'); } catch (e) { pending = null; job.reject(e); }
    }

    /** 发送一条命令；line 必须是 ASCII（中文请先 base64） */
    function send(line, timeoutMs) {
      return new Promise((resolve, reject) => {
        const job = {
          line: line,
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); }
        };
        const timer = setTimeout(() => {
          const i = queue.indexOf(job);
          if (i >= 0) { queue.splice(i, 1); }
          else if (pending === job) { pending = null; pump(); }
          job.reject(new Error('本机脚本超时（' + (timeoutMs || 15000) + 'ms）：' + line.split(' ')[0]));
        }, timeoutMs || 15000);
        if (timer.unref) timer.unref();
        queue.push(job);
        pump();
      });
    }

    /** 只发不等待（输入模拟不需要回执） */
    function fire(line) {
      const p = start();
      if (p && p.stdin && p.stdin.writable) { try { p.stdin.write(line + '\n'); } catch (e) { /* ignore */ } }
    }

    function stop() {
      if (proc) { try { proc.kill(); } catch (e) { /* ignore */ } proc = null; }
      pending = null;
      queue = [];
    }

    return { send, fire, stop, isAlive: () => !!(proc && !proc.killed) };
  }

  const input = createWorker('agent_input.ps1');
  const uia = createWorker('uia.ps1');

  return {
    root,
    nativeDir,
    input,
    uia,
    win,
    runScript,
    runRaw,
    b64utf8,
    unb64,
    parseResult,
    dispose() { input.stop(); uia.stop(); }
  };
}

module.exports = { createNative, parseResult, b64utf8, unb64 };
