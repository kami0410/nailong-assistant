'use strict';
/* 通用 JSON 数据仓：原子写入 + 防抖 + 版本迁移 + 损坏自愈
 * 所有 .userdata/*.json 都走这里，避免半截文件把用户数据写坏。
 */

const fs = require('fs');
const path = require('path');

const WRITE_DELAY = 400;

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

/**
 * @param {string} file 绝对路径
 * @param {object} defaults 默认值
 * @param {object} [opts] { version, migrate(data, fromVersion), onChange, delay }
 */
function createStore(file, defaults, opts) {
  const o = opts || {};
  const version = o.version || 1;
  let data = null;
  let timer = null;
  let dirty = false;

  function migrate(raw) {
    let d = raw;
    const from = Number(d && d.__v) || 0;
    if (from < version && typeof o.migrate === 'function') {
      try { d = o.migrate(d, from) || d; } catch (e) { d = raw; }
    }
    d = d || {};
    d.__v = version;
    return Object.assign({}, defaults, d);
  }

  function load() {
    ensureDir(path.dirname(file));
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return migrate(raw);
    } catch (e) {
      if (e && e.code !== 'ENOENT') {
        // 文件损坏：留个副本，别静默丢数据
        try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
      }
      return Object.assign({ __v: version }, defaults);
    }
  }

  function flush() {
    timer = null;
    if (!dirty) return;
    dirty = false;
    const tmp = file + '.tmp' + process.pid;
    try {
      ensureDir(path.dirname(file));
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
      return false;
    }
    return true;
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(flush, o.delay === undefined ? WRITE_DELAY : o.delay);
    if (timer.unref) timer.unref();
  }

  data = load();

  const api = {
    path: file,
    get all() { return data; },
    get(key, dflt) {
      const v = data[key];
      return v === undefined ? dflt : v;
    },
    set(key, value) {
      if (data[key] === value) return value;
      data[key] = value;
      schedule();
      if (o.onChange) { try { o.onChange(key, value); } catch (e) { /* ignore */ } }
      return value;
    },
    patch(obj) {
      Object.keys(obj || {}).forEach((k) => { data[k] = obj[k]; });
      schedule();
      if (o.onChange) { try { o.onChange(null, obj); } catch (e) { /* ignore */ } }
      return data;
    },
    update(fn) {
      const out = fn(data);
      schedule();
      return out;
    },
    saveNow() { dirty = true; return flush(); },
    reload() { data = load(); return data; },
    dispose() { if (timer) { clearTimeout(timer); flush(); } }
  };
  return api;
}

module.exports = { createStore, ensureDir };
