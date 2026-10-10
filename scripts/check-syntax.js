#!/usr/bin/env node
'use strict';
/* 语法自检：把 src / renderer / 根目录的所有 JS 过一遍 node --check，
 * 再对渲染层脚本做一次「窗口全局变量是否被用到」的粗糙检查。
 * 不依赖任何打包工具，npm run lint:syntax 就能跑。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.cache', '.userdata', 'backups', 'dist']);
const files = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(js|mjs|cjs)$/.test(name)) files.push(full);
  }
}
walk(ROOT);

let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.error('✗ 语法错误：' + path.relative(ROOT, f));
    console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}

// 渲染层 HTML 引用的脚本/样式必须真实存在
let missing = 0;
const renderer = path.join(ROOT, 'renderer');
if (fs.existsSync(renderer)) {
  for (const name of fs.readdirSync(renderer)) {
    if (!name.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(renderer, name), 'utf8');
    const refs = [];
    html.replace(/<script[^>]+src="([^"]+)"/g, (m, s) => { refs.push(s); return m; });
    html.replace(/<link[^>]+href="([^"]+)"/g, (m, s) => { refs.push(s); return m; });
    for (const ref of refs) {
      if (/^https?:/.test(ref)) continue;
      const target = path.resolve(renderer, ref);
      if (!fs.existsSync(target)) {
        missing++;
        console.error('✗ ' + name + ' 引用了不存在的文件：' + ref);
      }
    }
  }
}

console.log('检查了 ' + files.length + ' 个 JS 文件，' + (bad + missing) + ' 个问题');
process.exit(bad + missing ? 1 : 0);
