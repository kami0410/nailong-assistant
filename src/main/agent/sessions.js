'use strict';
/* 会话存档：多轮对话持久化、自动命名、按数量裁剪 */

const MAX_SESSIONS = 50;
const MAX_MESSAGES = 400;

function newId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function titleFrom(messages) {
  const first = (messages || []).find((m) => m.role === 'user');
  if (!first) return '新对话';
  let text = '';
  if (typeof first.content === 'string') text = first.content;
  else if (Array.isArray(first.content)) text = first.content.map((p) => p.text || '').join(' ');
  text = String(text).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 22 ? text.slice(0, 22) + '…' : text) : '新对话';
}

function createSessionStore(store) {
  function list() {
    return (store.get('list', []) || []).map((s) => ({
      id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
      count: (s.messages || []).length, usage: s.usage || null
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(id) {
    return (store.get('list', []) || []).find((s) => s.id === id) || null;
  }

  function raw() { return store.get('list', []) || []; }

  function put(session) {
    const arr = raw().slice();
    const i = arr.findIndex((s) => s.id === session.id);
    const clean = {
      id: session.id,
      title: session.title || titleFrom(session.messages),
      createdAt: session.createdAt || Date.now(),
      updatedAt: Date.now(),
      usage: session.usage || null,
      messages: (session.messages || []).slice(-MAX_MESSAGES)
    };
    if (i >= 0) arr[i] = clean; else arr.push(clean);
    arr.sort((a, b) => b.updatedAt - a.updatedAt);
    store.set('list', arr.slice(0, MAX_SESSIONS));
    return clean;
  }

  function create(meta) {
    const s = {
      id: newId(),
      title: (meta && meta.title) || '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usage: null,
      messages: []
    };
    put(s);
    store.set('current', s.id);
    return s;
  }

  function remove(id) {
    store.set('list', raw().filter((s) => s.id !== id));
    if (store.get('current') === id) store.set('current', null);
    return true;
  }

  function clear() {
    store.set('list', []);
    store.set('current', null);
    return true;
  }

  function current() {
    const id = store.get('current');
    return id ? get(id) : null;
  }

  function setCurrent(id) { store.set('current', id); return true; }

  /** 取当前会话；没有就新建 */
  function currentOrCreate() {
    return current() || create({});
  }

  return { list, get, put, create, remove, clear, current, setCurrent, currentOrCreate, titleFrom };
}

module.exports = { createSessionStore, titleFrom, MAX_SESSIONS };
