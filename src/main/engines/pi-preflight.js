'use strict';
/* pi 侧的环境自检：把「明明配好了却发不出去请求」这类坑提前说清楚
 *
 * 最典型的一个：pi 的 agent 目录 settings.json 里配了 httpProxy，而那个代理根本没开。
 * pi 会把它当成 HTTP_PROXY/HTTPS_PROXY 应用到自己所有 HTTP 客户端上，于是每次模型调用
 * 都变成一句含糊的 "Connection error."，用户完全不知道去哪改。
 *
 * 这里只读不写：绝不修改用户的 pi 配置，只把结论告诉界面。
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

function agentDir() {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  return path.join(os.homedir(), '.pi', 'agent');
}

function readSettings(dir) {
  const file = path.join(dir || agentDir(), 'settings.json');
  try {
    return { file: file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { file: file, data: null, error: (e && e.code === 'ENOENT') ? 'missing' : String((e && e.message) || e) };
  }
}

function parseProxy(url) {
  const m = /^(?:https?|socks[45]?):\/\/([^/:@]+)(?::(\d+))?/i.exec(String(url || '').trim());
  if (!m) return null;
  return { host: m[1], port: Number(m[2] || (String(url).indexOf('https') === 0 ? 443 : 80)) };
}

/** TCP 探活：不依赖任何代理库，毫秒级超时 */
function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (e) { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs || 1200);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try { socket.connect(port, host); } catch (e) { finish(false); }
  });
}

/**
 * @param {object} [opts] { agentDir, probe, timeoutMs }
 * @returns {Promise<{agentDir, settingsFile, credentials:{file, ok}, proxy:{configured,url,host,port,reachable}, warnings:string[]}>}
 */
async function preflight(opts) {
  const o = opts || {};
  const dir = o.agentDir || agentDir();
  const probe = o.probe || probeTcp;
  const s = readSettings(dir);

  const credFile = path.join(dir, 'auth.json');
  let credOk = false;
  try { credOk = fs.existsSync(credFile) && Object.keys(JSON.parse(fs.readFileSync(credFile, 'utf8'))).length > 0; } catch (e) { credOk = false; }

  const out = {
    agentDir: dir,
    settingsFile: s.file,
    settingsReadable: !!s.data,
    credentials: { file: credFile, ok: credOk },
    proxy: { configured: false, url: '', host: '', port: 0, reachable: null },
    model: '',
    warnings: []
  };

  if (s.data && s.data.defaultModel) out.model = String(s.data.defaultModel);

  const proxyUrl = s.data && (s.data.httpProxy || s.data.httpsProxy);
  if (proxyUrl) {
    const parsed = parseProxy(proxyUrl);
    out.proxy.configured = true;
    out.proxy.url = String(proxyUrl);
    if (!parsed) {
      out.warnings.push('pi 的 settings.json 里配了 ' + proxyUrl + '，但这不是一个能识别的代理地址，模型请求很可能失败。');
    } else {
      out.proxy.host = parsed.host;
      out.proxy.port = parsed.port;
      const ok = await probe(parsed.host, parsed.port, o.timeoutMs);
      out.proxy.reachable = ok;
      if (!ok) {
        out.warnings.push('pi 配置了代理 ' + proxyUrl + '（来自 ' + s.file + '），但这个代理现在连不上，'
          + '所以 pi 内核发出的模型请求会全部失败（报 "Connection error."）。'
          + '要么把代理开起来，要么把 settings.json 里的 httpProxy 删掉（`pi config` 也能改），'
          + '要么在奶蛙设置里改用「内置引擎」——内置引擎不读 pi 的这个代理设置。');
      }
    }
  }

  if (!out.settingsReadable && s.error && s.error !== 'missing') {
    out.warnings.push('读不了 pi 的 settings.json（' + s.error + '）：' + s.file);
  }

  return out;
}

/** 给界面用的一句话摘要 */
function summarize(pf) {
  if (!pf) return '';
  const bits = [];
  bits.push(pf.credentials.ok ? 'pi 凭据就绪' : 'pi 还没有凭据');
  if (pf.model) bits.push('默认模型 ' + pf.model);
  if (pf.proxy.configured) {
    bits.push('代理 ' + pf.proxy.url + (pf.proxy.reachable === true ? '（通）' : pf.proxy.reachable === false ? '（连不上）' : '（未知）'));
  }
  return bits.join(' · ');
}

/** 判断一条报错是不是这个代理造成的 */
function looksLikeProxyFailure(message) {
  const m = String(message || '');
  return /connection error|fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up/i.test(m);
}

module.exports = { preflight, summarize, looksLikeProxyFailure, agentDir, readSettings, parseProxy, probeTcp };
