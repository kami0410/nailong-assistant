'use strict';
/* MCP 服务器配置管理（pi 读 <agent-dir>/mcp.json）
 *
 * 格式与 Claude Desktop / Cursor 一致，所以用户可以直接把现成的片段贴进来：
 *   { "mcpServers": {
 *       "filesystem": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","."] },
 *       "docs":       { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" } }
 *   } }
 *
 * 只读写我们自己的 agent 目录（bundled 模式）。system 模式下那是用户自己的 ~/.pi/agent，
 * 不替用户改，只给提示。
 *
 * 纯逻辑部分（解析/校验/增删）不碰进程，方便单测。
 */

const fs = require('fs');
const path = require('path');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function emptyConfig() { return { mcpServers: {} }; }

/** 解析并校验一段 JSON；返回 {ok, config} 或 {ok:false, error} */
function parseConfig(text) {
  if (!text || !String(text).trim()) return { ok: true, config: emptyConfig() };
  let raw;
  try { raw = JSON.parse(String(text)); }
  catch (e) { return { ok: false, error: '不是合法 JSON：' + ((e && e.message) || e) }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '顶层应该是一个对象' };
  const servers = raw.mcpServers;
  if (servers === undefined) return { ok: true, config: emptyConfig() };
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return { ok: false, error: 'mcpServers 应该是一个对象' };
  const out = {};
  Object.keys(servers).forEach((name) => {
    const v = servers[name];
    if (!v || typeof v !== 'object' || Array.isArray(v)) { out[name] = {}; return; }
    out[name] = v;
  });
  return { ok: true, config: { mcpServers: out } };
}

function serialize(config) {
  const servers = (config && config.mcpServers) || {};
  return JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
}

/** 给界面看的一份摘要 */
function describe(config) {
  const servers = (config && config.mcpServers) || {};
  return Object.keys(servers).sort().map((name) => {
    const v = servers[name] || {};
    let type = '未配置';
    let target = '';
    if (v.url) { type = 'http'; target = String(v.url); }
    else if (v.command) {
      type = 'stdio';
      target = String(v.command) + (Array.isArray(v.args) && v.args.length ? ' ' + v.args.map((a) => String(a)).join(' ') : '');
    }
    const exposure = String(v.exposure || 'codemode');
    return {
      name: name,
      type: type,
      target: target,
      enabled: v.enabled !== false,
      exposure: exposure,
      // codemode/deferred 要靠对应扩展才可达；奶蛙默认不加载扩展，所以这种要提示
      exposureNeedsExtension: exposure === 'codemode' || exposure === 'deferred',
      description: v.description ? String(v.description) : '',
      needsOAuth: !!(v.url && !(v.headers && Object.keys(v.headers).length)),
      raw: v
    };
  });
}

/** 合并一个新的服务器定义（name + 该服务器的配置对象） */
function upsert(config, name, def) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) {
    return { ok: false, error: '服务器名只能用字母数字和 . _ -（1~64 个字符），现在是「' + n + '」' };
  }
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { ok: false, error: '这个服务器的配置应该是一个对象' };
  if (def.args !== undefined && !Array.isArray(def.args)) return { ok: false, error: 'args 应该是数组' };
  // 先合并再校验：改已有服务器时只给要改的字段就够了（比如只改 args），
  // 不逼用户把 command/url 重写一遍。
  const merged = Object.assign({}, next_exposure_default(), config.mcpServers[n] || {}, def);
  if (!merged.command && !merged.url && !merged.type) {
    return { ok: false, error: '至少要写 command（本地进程）或 url（远程 http）之一' };
  }
  if (merged.command && merged.url) {
    return { ok: false, error: 'command 和 url 只能留一个：要换传输方式，把旧的那个显式删掉（先删再加）' };
  }
  const next = Object.assign({}, config);
  next.mcpServers = Object.assign({}, config.mcpServers);
  next.mcpServers[n] = merged;
  return { ok: true, config: next };
}

/** 新服务器的默认值：direct（不依赖任何扩展，pi 默认的 codemode 要靠 codemode 扩展才可达，
 *  而奶蛙默认 --no-extensions 把它关着，结果就是「服务器连上了但模型看不到工具」） */
function next_exposure_default() { return { exposure: 'direct' }; }

function remove(config, name) {
  const next = Object.assign({}, config);
  next.mcpServers = Object.assign({}, config.mcpServers);
  delete next.mcpServers[String(name || '')];
  return next;
}

function setEnabled(config, name, enabled) {
  const n = String(name || '');
  if (!config.mcpServers[n]) return config;
  const next = Object.assign({}, config);
  next.mcpServers = Object.assign({}, config.mcpServers);
  next.mcpServers[n] = Object.assign({}, next.mcpServers[n], { enabled: !!enabled });
  return next;
}

/**
 * 从一段粘贴内容里抽出服务器定义。用户可能贴三种东西：
 *   1. 带外层的：{ "mcpServers": { "fs": {...}, "docs": {...} } }
 *   2. 单条配置：{ "command": "npx", "args": [...] }  （名字要另外填）
 *   3. 不带外层的映射：{ "fs": {...}, "docs": {...} }
 */
function extractEntry(pasted) {
  let raw;
  try { raw = JSON.parse(String(pasted || '')); }
  catch (e) { return { ok: false, error: '不是合法 JSON：' + ((e && e.message) || e) }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '顶层应该是一个对象（mcpServers 或单条配置）' };
  }

  // 情况 1：带外层
  if (raw.mcpServers !== undefined) {
    const r = parseConfig(JSON.stringify(raw));
    if (!r.ok) return r;
    const names = Object.keys(r.config.mcpServers);
    if (!names.length) return { ok: false, error: 'mcpServers 里面是空的' };
    if (names.length === 1) return { ok: true, name: names[0], single: r.config.mcpServers[names[0]] };
    return { ok: true, multi: r.config.mcpServers };
  }

  // 情况 2：本身就是一条配置（有传输方式字段）
  if (raw.command || raw.url || raw.type) return { ok: true, single: raw };

  // 情况 3：不带外层的映射，值都是对象
  const keys = Object.keys(raw);
  const allObjects = keys.length > 0 && keys.every((k) => raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k]));
  if (allObjects) {
    if (keys.length === 1) return { ok: true, name: keys[0], single: raw[keys[0]] };
    return { ok: true, multi: raw };
  }

  return { ok: false, error: '没解析出服务器：需要 command（本地进程）或 url（远程 http）之一' };
}

// ---------------------------------------------------------------- 落盘

function read(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const r = parseConfig(text);
    if (!r.ok) return { ok: false, error: r.error, config: emptyConfig(), raw: text };
    return { ok: true, config: r.config, raw: text };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, config: emptyConfig(), raw: '' };
    return { ok: false, error: String((e && e.message) || e), config: emptyConfig(), raw: '' };
  }
}

function write(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp' + process.pid;
  fs.writeFileSync(tmp, serialize(config), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

module.exports = {
  NAME_RE,
  emptyConfig, parseConfig, serialize, describe, upsert, remove, setEnabled, extractEntry,
  read, write
};
