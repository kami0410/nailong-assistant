'use strict';
/* 应用自带的 pi agent 目录（bundled 模式）
 *
 * 为什么不直接用机器上的 ~/.pi/agent：
 *   1. 那里的 httpProxy / provider / 扩展是别人（其它工具）配的，会把奶蛙带坏 ——
 *      实测就踩过一次：settings.json 里配了个没开的代理，所有模型请求都变成 "Connection error."
 *   2. 奶蛙有自己的接口配置（Base URL + Key + 模型），没必要让用户去改 pi 的全局配置
 *   3. 行为可预测：出问题只可能是奶蛙自己的配置
 *
 * 这里生成的东西：
 *   settings.json       最小配置：默认 provider/model/档位，不写任何代理
 *   APPEND_SYSTEM.md    给 pi 加上“你是桌面助手不是写代码的”这层身份与红线
 *   sessions/           pi 的会话文件（也可以用 --session-dir 指定）
 *
 * 只写我们自己的文件，每次启动前按内容差异覆盖，不动目录里用户的其它文件（如 mcp.json）。
 */

const fs = require('fs');
const path = require('path');

const SYSTEM_APPEND_ZH = `# 你现在是「奶蛙助手」

你运行在用户的 Windows 桌面里，是用户的**桌面助手**，不是写代码的编程助手。
你的手是本地工具桥提供的那批工具：看屏幕、读无障碍元素树、操作鼠标键盘、读写文件、管日程。

## 工作方式
1. 先看清楚再动手。要知道屏幕上有什么，优先用 \`ui_tree\`（元素树，带 id 和文字，最准）；
   只有需要判断视觉布局（颜色、图标、图片）时才用 \`screenshot\`。
2. 用元素树时直接 \`click_element\` 传 element_id，不要自己算坐标；用截图时才按截图像素给坐标。
3. 一次做一个动作，做完看结果，再决定下一步。别连续盲发多个动作。
4. 能用工具直接办到的（读写文件、改日程、查系统状态），不要绕道去操作图形界面。
5. 用户的日程、待办、番茄钟就是奶蛙自己的功能：要改就直接用 \`schedule_*\` / \`focus_*\` 工具，
   而不是去屏幕上点。用户问"我今天还有什么没做"时也应该查工具而不是猜。
6. 汇报用简体中文，简短：做了什么、结果如何、有没有需要用户决定的事。
   不要复述工具返回的原始数据，不要输出 JSON 或代码块（除非用户要）。

## 红线（不要做，遇到了就停下来告诉用户）
- 不删除用户文件（要删只能走 \`delete_path\` 进回收站，且必须让用户确认）
- 不进行任何付款、下单、转账
- 不替用户发送消息、邮件、评论
- 不修改系统设置（注册表、服务、防火墙、电源策略）
- 不把用户的密钥、密码、隐私内容写进文件或发给外部地址
`;

function readIfExists(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

/** 我们要的键是否已经都在文件里（pi 会重写这个文件，所以只做子集比对，不去和它拉锯） */
function desiredPresent(file, desired) {
  const cur = readIfExists(file);
  if (cur === null) return false;
  let parsed;
  try { parsed = JSON.parse(cur); } catch (e) { return false; }
  return Object.keys(desired).every((k) => JSON.stringify(parsed[k]) === JSON.stringify(desired[k]));
}

function writeIfChanged(file, content, log) {
  const cur = readIfExists(file);
  if (cur === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  if (log) log.info('[pi] 写入 agent 目录文件：' + file);
  return true;
}

/**
 * @param {string} dir     应用自带的 agent 目录
 * @param {object} [opts]  { model, thinking, locale, log }
 * @returns {{dir:string, wrote:string[], settings:object}}
 */
function ensure(dir, opts) {
  const o = opts || {};
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const wrote = [];

  const settings = { defaultProvider: 'nailong' };
  if (o.selectedModel || o.model) {
    const selected = o.selectedModel || 'nailong/' + o.model;
    const slash = selected.indexOf('/');
    settings.defaultProvider = selected.slice(0, slash);
    settings.defaultModel = selected.slice(slash + 1);
  }
  if (o.thinking) settings.defaultThinkingLevel = o.thinking;
  // 刻意不写 httpProxy / 扩展 / 包声明：这个目录只属于奶蛙
  const settingsFile = path.join(dir, 'settings.json');
  if (!desiredPresent(settingsFile, settings)) {
    // pi 自己会往这个文件里补 compaction/retry 之类的键，所以是“合并后再写”而不是覆盖
    let existing = {};
    try { existing = JSON.parse(readIfExists(settingsFile) || '{}') || {}; } catch (e) { existing = {}; }
    const merged = Object.assign({}, existing, settings);
    if (writeIfChanged(settingsFile, JSON.stringify(merged, null, 2) + '\n', o.log)) wrote.push('settings.json');
  }

  const appendFile = path.join(dir, 'APPEND_SYSTEM.md');
  if (writeIfChanged(appendFile, SYSTEM_APPEND_ZH, o.log)) wrote.push('APPEND_SYSTEM.md');

  return { dir: dir, wrote: wrote, settings: settings };
}

/** 只读：看看这个自带目录现在是什么状态（给界面显示） */
function inspect(dir) {
  const settingsFile = path.join(dir, 'settings.json');
  let settings = null;
  let error = '';
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch (e) { error = (e && e.code === 'ENOENT') ? '' : String((e && e.message) || e); }
  return {
    dir: dir,
    exists: fs.existsSync(dir),
    settings: settings,
    settingsFile: settingsFile,
    proxy: (settings && (settings.httpProxy || settings.httpsProxy)) || '',
    error: error
  };
}

module.exports = { ensure, inspect, SYSTEM_APPEND_ZH };
