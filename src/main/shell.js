'use strict';
/* 托盘 / 全局快捷键 / 开机自启 —— 「商用级」必备的系统集成入口 */

const { app, Tray, Menu, globalShortcut, shell: electronShell } = require('electron');
const fs = require('fs');

const P = require('./paths.js');

function createShell(deps) {
  const { log, services, windows, onOpenAssistant, onTogglePanel, onOpenSettings, onQuit, onFocusStart } = deps;
  let tray = null;
  const registered = {};

  function hotkeys() {
    return Object.assign(
      { assistant: 'CommandOrControl+Alt+N', panel: 'CommandOrControl+Alt+Z', focus: 'CommandOrControl+Alt+F' },
      services.settings.getKey('hotkeys', {})
    );
  }

  function applyHotkeys() {
    Object.keys(registered).forEach((k) => {
      try { globalShortcut.unregister(registered[k]); } catch (e) { /* ignore */ }
      delete registered[k];
    });
    const map = hotkeys();
    const actions = {
      assistant: onOpenAssistant,
      panel: onTogglePanel,
      focus: onFocusStart
    };
    Object.keys(map).forEach((name) => {
      const accel = map[name];
      if (!accel) return;
      try {
        const ok = globalShortcut.register(accel, () => {
          log.info('[hotkey] ' + name);
          const fn = actions[name];
          if (fn) fn();
        });
        if (ok) registered[name] = accel;
        else log.warn('[hotkey] 注册失败（可能被别的软件占用）：' + accel);
      } catch (e) {
        log.warn('[hotkey] ' + name + ' 注册异常：' + e.message);
      }
    });
    return registered;
  }

  function trayImage() {
    try {
      const nativeImage = require('electron').nativeImage;
      // 托盘用 ico 在 Windows 上最稳
      const img = nativeImage.createFromPath(P.icon);
      if (!img.isEmpty()) return img;
    } catch (e) { /* ignore */ }
    return undefined;
  }

  function trayMenu() {
    const focus = services.focus.status();
    return Menu.buildFromTemplate([
      { label: '奶蛙助手', icon: trayImage(), enabled: false },
      { type: 'separator' },
      { label: '打开对话助手', click: onOpenAssistant },
      { label: '打开日程面板', click: onTogglePanel },
      {
        label: focus.phase === 'idle' ? '开始专注（25 分钟）' : '专注中… ' + Math.ceil(focus.remainMs / 60000) + ' 分钟后结束',
        click: () => onFocusStart()
      },
      { label: '设置…', click: onOpenSettings },
      { type: 'separator' },
      { label: '数据目录', click: () => electronShell.openPath(P.ROOT) },
      { label: '查看日志', click: () => electronShell.openPath(P.logs) },
      { type: 'separator' },
      { label: '退出奶蛙', click: onQuit }
    ]);
  }

  function createTray() {
    if (tray) return tray;
    const img = trayImage();
    if (!img) { log.warn('[tray] 没有可用的图标，跳过托盘'); return null; }
    try {
      tray = new Tray(img);
    } catch (e) {
      log.warn('[tray] 创建失败：' + e.message);
      return null;
    }
    tray.setToolTip('奶蛙助手');
    tray.setContextMenu(trayMenu());
    tray.on('click', () => onTogglePanel());
    tray.on('double-click', () => onOpenAssistant());
    return tray;
  }

  function refreshTray() {
    if (!tray) return;
    try { tray.setContextMenu(trayMenu()); } catch (e) { /* ignore */ }
  }

  function applyAutoStart() {
    const on = !!services.settings.getKey('autoStart', false);
    try {
      app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [] });
      log.info('[autostart] ' + (on ? '已开启' : '已关闭'));
    } catch (e) {
      log.warn('[autostart] 设置失败：' + e.message);
    }
    return on;
  }

  function autoStartEnabled() {
    try { return !!app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
  }

  function dispose() {
    try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
    if (tray) { try { tray.destroy(); } catch (e) { /* ignore */ } tray = null; }
  }

  return { createTray, refreshTray, applyHotkeys, applyAutoStart, autoStartEnabled, dispose, hotkeys };
}

module.exports = { createShell };
