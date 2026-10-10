'use strict';
/* 文件类工具：读 / 写 / 查 / 整理。全部走绝对路径，受 permissions 保护目录规则约束。 */

const fs = require('fs');
const path = require('path');

const MAX_READ_BYTES = 400 * 1024;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|html|htm|xml|yml|yaml|toml|ini|cfg|conf|log|csv|tsv|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|sh|ps1|bat|cmd|sql|env|gitignore)$/i;

function def(o) {
  return {
    name: o.name, group: o.group || '文件', level: o.level || 'mid',
    description: o.description, parameters: o.parameters || { type: 'object', properties: {} },
    describe: o.describe || (() => o.name), preview: o.preview, run: o.run
  };
}

function abs(p, host) {
  let s = String(p || '').trim();
  if (!s) throw new Error('路径不能为空');
  s = s.replace(/^~(?=[\\/]|$)/, host.paths.home);
  if (!path.isAbsolute(s)) {
    s = path.join(host.paths.desktop, s);
  }
  return path.resolve(s);
}

function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function createFileTools(host) {
  function guard(p) {
    const r = host.guardPath ? host.guardPath(p) : { ok: true };
    if (!r.ok) {
      const err = new Error(r.reason);
      err.blocked = true;
      throw err;
    }
    return p;
  }

  return [
    def({
      name: 'list_dir',
      level: 'low',
      description: '列出文件夹内容（含大小、修改时间、是否文件夹）。不填路径则列桌面。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件夹绝对路径' },
          pattern: { type: 'string', description: '可选通配符，如 *.xlsx' },
          limit: { type: 'integer', description: '最多返回多少项，默认 100' }
        }
      },
      describe: (a) => '列出文件夹 ' + ((a && a.path) || '桌面'),
      async run(args) {
        const a = args || {};
        const dir = guard(abs(a.path || host.paths.desktop, host));
        const st = await fs.promises.stat(dir).catch(() => null);
        if (!st) throw new Error('路径不存在：' + dir);
        if (!st.isDirectory()) throw new Error('这不是文件夹（它是文件，用 read_file）：' + dir);
        const names = await fs.promises.readdir(dir);
        const limit = Math.max(1, Math.min(500, Number(a.limit) || 100));
        const pat = a.pattern ? new RegExp('^' + String(a.pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
        const out = [];
        for (const n of names) {
          if (pat && !pat.test(n)) continue;
          if (out.length >= limit) break;
          const full = path.join(dir, n);
          let s = null;
          try { s = await fs.promises.stat(full); } catch (e) { continue; }
          out.push({ name: n, dir: s.isDirectory(), size: s.size, mtime: s.mtime.toISOString().slice(0, 16).replace('T', ' ') });
        }
        out.sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name, 'zh'));
        const lines = out.map((x) => (x.dir ? '📁 ' : '   ') + x.name + (x.dir ? '/' : '  ' + humanSize(x.size) + '  ' + x.mtime));
        return { ok: true, text: dir + '  共 ' + names.length + ' 项，返回 ' + out.length + '：\n' + lines.join('\n') + (names.length > out.length ? '\n…（还有更多，用 pattern 过滤）' : '') };
      }
    }),

    def({
      name: 'read_file',
      level: 'low',
      description: '读取文本文件内容。可以指定起始行和行数，大文件请分段读。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer', description: '从第几行开始（从 1 开始）' },
          limit: { type: 'integer', description: '最多读多少行，默认 400' }
        },
        required: ['path']
      },
      describe: (a) => '读取文件 ' + (a && a.path),
      async run(args) {
        const a = args || {};
        const file = guard(abs(a.path, host));
        const st = await fs.promises.stat(file).catch(() => null);
        if (!st) throw new Error('文件不存在：' + file);
        if (st.isDirectory()) throw new Error('这是文件夹，用 list_dir：' + file);
        if (st.size > MAX_READ_BYTES && !TEXT_EXT.test(file)) {
          throw new Error('文件太大或不是文本（' + humanSize(st.size) + '）：' + file);
        }
        const raw = await fs.promises.readFile(file);
        const text = raw.toString('utf8');
        const lines = text.split(/\r\n|\r|\n/);
        const off = Math.max(1, Number(a.offset) || 1);
        const lim = Math.max(1, Math.min(2000, Number(a.limit) || 400));
        const slice = lines.slice(off - 1, off - 1 + lim);
        const body = slice.map((l, i) => (off + i) + '\t' + l).join('\n');
        return {
          ok: true,
          text: file + '（共 ' + lines.length + ' 行，' + humanSize(st.size) + '，显示 ' + off + '~' + (off + slice.length - 1) + '）：\n' + body
            + (off - 1 + slice.length < lines.length ? '\n…还有 ' + (lines.length - (off - 1 + slice.length)) + ' 行' : '')
        };
      }
    }),

    def({
      name: 'write_file',
      level: 'mid',
      description: '写文件。mode=overwrite 覆盖（默认）、append 追加、create 仅在不存在时新建。会自动建父目录。改完记得告诉用户改了什么。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['overwrite', 'append', 'create'] }
        },
        required: ['path', 'content']
      },
      describe: (a) => (a && a.mode === 'append' ? '追加到 ' : a && a.mode === 'create' ? '新建 ' : '写入 ') + ((a && a.path) || ''),
      preview: (a) => '目标：' + ((a && a.path) || '') + '\n内容预览：\n' + String((a && a.content) || '').slice(0, 600) + (String((a && a.content) || '').length > 600 ? '\n…（更长）' : ''),
      async run(args) {
        const a = args || {};
        const content = String(a.content === undefined ? '' : a.content);
        if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('内容太大（>4MB），请分次写入');
        const file = guard(abs(a.path, host));
        const mode = a.mode || 'overwrite';
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        if (mode === 'create') {
          await fs.promises.writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
        } else if (mode === 'append') {
          await fs.promises.appendFile(file, content, 'utf8');
        } else {
          await fs.promises.writeFile(file, content, 'utf8');
        }
        const st = await fs.promises.stat(file);
        return { ok: true, text: (mode === 'append' ? '已追加到 ' : '已写入 ') + file + '（现在 ' + humanSize(st.size) + '）' };
      }
    }),

    def({
      name: 'file_info',
      level: 'low',
      description: '查看文件/文件夹的详细信息：大小、创建/修改时间、是否只读、总大小（文件夹会递归统计）。',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      describe: (a) => '查看 ' + (a && a.path) + ' 的信息',
      async run(args) {
        const p = guard(abs((args || {}).path, host));
        const st = await fs.promises.stat(p).catch(() => null);
        if (!st) throw new Error('路径不存在：' + p);
        let extra = '';
        if (st.isDirectory()) {
          let count = 0, total = 0;
          const walk = async (d, depth) => {
            if (depth > 4 || count > 5000) return;
            let names = [];
            try { names = await fs.promises.readdir(d); } catch (e) { return; }
            for (const n of names) {
              const full = path.join(d, n);
              let s = null;
              try { s = await fs.promises.stat(full); } catch (e) { continue; }
              if (s.isDirectory()) await walk(full, depth + 1);
              else { count++; total += s.size; }
            }
          };
          await walk(p, 0);
          extra = '\n其中 ' + count + ' 个文件，合计 ' + humanSize(total);
        }
        return {
          ok: true,
          text: p + '\n类型：' + (st.isDirectory() ? '文件夹' : '文件')
            + (st.isDirectory() ? '' : '（' + humanSize(st.size) + '）')
            + '\n修改时间：' + st.mtime.toLocaleString('zh-CN')
            + '\n创建时间：' + st.birthtime.toLocaleString('zh-CN') + extra
        };
      }
    }),

    def({
      name: 'mkdir',
      level: 'mid',
      description: '创建文件夹（自动创建父目录，已存在不报错）',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      describe: (a) => '新建文件夹 ' + (a && a.path),
      async run(args) {
        const p = guard(abs((args || {}).path, host));
        await fs.promises.mkdir(p, { recursive: true });
        return { ok: true, text: '已创建文件夹 ' + p };
      }
    }),

    def({
      name: 'copy_path',
      level: 'mid',
      description: '复制文件或文件夹。to 可以是目标目录（则保持原名）或完整新路径。',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      describe: (a) => '复制 ' + (a && a.from) + ' → ' + (a && a.to),
      async run(args) {
        const a = args || {};
        const src = guard(abs(a.from, host));
        let dst = guard(abs(a.to, host));
        const st = await fs.promises.stat(dst).catch(() => null);
        if (st && st.isDirectory()) dst = path.join(dst, path.basename(src));
        const sst = await fs.promises.stat(src).catch(() => null);
        if (!sst) throw new Error('源路径不存在：' + src);
        if (dst === src) throw new Error('源和目标是同一个路径');
        await fs.promises.mkdir(path.dirname(dst), { recursive: true });
        await fs.promises.cp(src, dst, { recursive: true, errorOnExist: false, force: true });
        return { ok: true, text: '已复制到 ' + dst };
      }
    }),

    def({
      name: 'move_path',
      level: 'mid',
      description: '移动/重命名文件或文件夹。to 可以是目标目录或完整新路径（改名字就填新名字）。',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      describe: (a) => '移动 ' + (a && a.from) + ' → ' + (a && a.to),
      async run(args) {
        const a = args || {};
        const src = guard(abs(a.from, host));
        let dst = guard(abs(a.to, host));
        const st = await fs.promises.stat(dst).catch(() => null);
        if (st && st.isDirectory()) dst = path.join(dst, path.basename(src));
        await fs.promises.mkdir(path.dirname(dst), { recursive: true });
        try {
          await fs.promises.rename(src, dst);
        } catch (e) {
          if (e.code === 'EXDEV') {
            await fs.promises.cp(src, dst, { recursive: true, force: true });
            await fs.promises.rm(src, { recursive: true, force: true });
          } else { throw e; }
        }
        return { ok: true, text: '已移动到 ' + dst };
      }
    }),

    def({
      name: 'delete_path',
      level: 'high',
      description: '把文件/文件夹送进回收站（不是永久删除，可以还原）。必须经用户确认。',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      describe: (a) => '回收 ' + (a && a.path),
      preview: (a) => '将把下面这个路径移入回收站（可在资源管理器里还原）：\n' + ((a && a.path) || ''),
      async run(args) {
        const p = guard(abs((args || {}).path, host));
        const st = await fs.promises.stat(p).catch(() => null);
        if (!st) throw new Error('路径不存在：' + p);
        const r = await host.recycle([p]);
        if (!r.ok) throw new Error(r.err || '回收失败');
        return { ok: true, text: '已把 ' + p + ' 移入回收站（可在资源管理器里还原）' };
      }
    }),

    def({
      name: 'search_files',
      level: 'low',
      description: '在某个目录下递归搜索文件名（含内容搜索可选）。默认搜桌面，最多 6 层深。',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: '搜索起点目录' },
          name: { type: 'string', description: '文件名关键词（忽略大小写）' },
          contains: { type: 'string', description: '可选：文件内容包含这个文本（只搜文本类文件）' },
          limit: { type: 'integer', description: '最多返回多少条，默认 40' }
        },
        required: ['name']
      },
      describe: (a) => '搜索文件名含「' + ((a && a.name) || '') + '」的文件',
      async run(args) {
        const a = args || {};
        const root = guard(abs(a.root || host.paths.desktop, host));
        const kw = String(a.name || '').toLowerCase();
        const needle = a.contains ? String(a.contains) : '';
        const limit = Math.max(1, Math.min(200, Number(a.limit) || 40));
        const hits = [];
        const walk = async (dir, depth) => {
          if (depth > 6 || hits.length >= limit) return;
          let names = [];
          try { names = await fs.promises.readdir(dir); } catch (e) { return; }
          for (const n of names) {
            if (hits.length >= limit) return;
            if (n === 'node_modules' || n === '.git' || n === '$Recycle.Bin' || n === 'Windows') continue;
            const full = path.join(dir, n);
            let s = null;
            try { s = await fs.promises.stat(full); } catch (e) { continue; }
            if (s.isDirectory()) { await walk(full, depth + 1); continue; }
            if (kw && n.toLowerCase().indexOf(kw) < 0) {
              if (!needle) continue;
            }
            if (needle) {
              if (!TEXT_EXT.test(full) || s.size > 2 * 1024 * 1024) continue;
              let txt = '';
              try { txt = await fs.promises.readFile(full, 'utf8'); } catch (e) { continue; }
              if (txt.indexOf(needle) < 0) continue;
            } else if (!kw) { continue; }
            hits.push(full + '  ' + humanSize(s.size) + '  ' + s.mtime.toISOString().slice(0, 10));
          }
        };
        await walk(root, 0);
        if (!hits.length) return { ok: true, text: '在 ' + root + ' 下没找到匹配的文件' };
        return { ok: true, text: '在 ' + root + ' 下找到 ' + hits.length + ' 个：\n' + hits.join('\n') };
      }
    })
  ];
}

module.exports = { createFileTools, TEXT_EXT, humanSize };
