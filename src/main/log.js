'use strict';
/* 分级日志：控制台 + 滚动文件。生产环境只留最近若干天，避免 .userdata 无限膨胀。 */

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function createLogger(opts) {
  const o = opts || {};
  const dir = o.dir;
  const level = LEVELS[o.level || 'info'] || 20;
  const maxBytes = o.maxBytes || 2 * 1024 * 1024;
  const maxFiles = o.maxFiles || 5;
  let file = dir ? path.join(dir, (o.name || 'app') + '.log') : null;
  let queue = [];
  let flushing = false;

  function rotate() {
    if (!file) return;
    try {
      const st = fs.statSync(file);
      if (st.size < maxBytes) return;
      for (let i = maxFiles - 1; i >= 1; i--) {
        const from = file + '.' + i;
        const to = file + '.' + (i + 1);
        try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (e) { /* ignore */ }
      }
      try { fs.renameSync(file, file + '.1'); } catch (e) { /* ignore */ }
    } catch (e) { /* 文件不存在就是好事 */ }
  }

  function flush() {
    if (flushing || !queue.length || !file) { queue = []; return; }
    flushing = true;
    const batch = queue.join('\n') + '\n';
    queue = [];
    try {
      if (dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ } }
      rotate();
      fs.appendFileSync(file, batch, 'utf8');
    } catch (e) { /* ignore */ }
    flushing = false;
  }

  let flushTimer = null;
  function schedule() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 500);
    if (flushTimer.unref) flushTimer.unref();
  }

  function write(lvl, args) {
    if (LEVELS[lvl] < level) return;
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    const msg = args.map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    const line = '[' + hh + '][' + lvl + '] ' + msg;
    if (lvl === 'error' || lvl === 'warn') console.error(line); else console.log(line);
    queue.push(line);
    schedule();
  }

  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    flush,
    get file() { return file; },
    tail(n) {
      if (!file) return '';
      try {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        return lines.slice(-(n || 200)).join('\n');
      } catch (e) { return ''; }
    }
  };
}

/** 兜底：任何未捕获异常都写进日志，别让用户面对一个静默死掉的桌宠 */
function installCrashHandlers(log) {
  process.on('uncaughtException', (e) => {
    log.error('uncaughtException', e);
  });
  process.on('unhandledRejection', (e) => {
    log.error('unhandledRejection', e);
  });
}

module.exports = { createLogger, installCrashHandlers, LEVELS };
