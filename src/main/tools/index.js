'use strict';
/* 工具注册表：把所有工具拼起来，提供按名查找、分类、以及给设置界面用的清单 */

const { createComputerTools } = require('./computer.js');
const { createFileTools } = require('./files.js');
const { createSystemTools } = require('./system.js');
const { createProductivityTools } = require('./productivity.js');

const GROUPS = ['电脑操作', '文件', '系统', '日程', '专注', '记忆', '奶蛙助手'];

function createTools(host) {
  const all = [].concat(
    createComputerTools(host),
    createFileTools(host),
    createSystemTools(host),
    createProductivityTools(host)
  );
  const byName = {};
  all.forEach((t) => {
    if (byName[t.name]) throw new Error('工具重名：' + t.name);
    byName[t.name] = t;
  });
  return {
    all,
    byName,
    get(name) { return byName[name] || null; },
    /** 给设置界面/提示词用的精简清单 */
    catalog() {
      return all.map((t) => ({ name: t.name, group: t.group, level: t.level, description: t.description }));
    },
    /** 应用「禁用某些工具」的配置 */
    applyDisabled(disabled) {
      const off = disabled || {};
      all.forEach((t) => { t.enabled = !off[t.name]; });
      return all.filter((t) => t.enabled);
    },
    stats() {
      const byGroup = {};
      all.forEach((t) => { byGroup[t.group] = (byGroup[t.group] || 0) + 1; });
      return { total: all.length, byGroup };
    }
  };
}

module.exports = { createTools, GROUPS };
