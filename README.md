<div align="center">

<img src="docs/screens/pet.png" width="170" alt="奶蛙助手">

# 奶蛙助手 · Nailong Assistant

**一只住在你 Windows 桌面上的小奶蛙：日程提醒 · 玻璃日程面板 · AI 电脑助手 · 小游戏**

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4?logo=windows&logoColor=white)](#)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](#)
[![License](https://img.shields.io/badge/License-MIT-3DA639)](LICENSE)
[![Stars](https://img.shields.io/github/stars/wangyiding645/nailong-assistant?style=social)](https://github.com/wangyiding645/nailong-assistant/stargazers)

[简体中文](README.md) · [English](README_EN.md)

</div>

---

## 这是什么？

**奶蛙助手**是一只住在桌面上的像素奶蛙（桌宠）。它不只是卖萌：

- 到点提醒你「该做日程了」，提前 5 分钟预告，完成后和你一起大笑庆祝
- 自带一块**液态玻璃日程面板**：时钟、日历、倒数日、打卡连签
- 会**四种变身**（右键切换）：AI 电脑助手 / 倒计时 / 闹钟 / 抛硬币
- 能和你玩**抓奶蛙**：满屏乱跑，鼠标靠近还会自己转向逃跑
- 你把不要的文件**拖到它身上**，它会问你一句，然后丢进回收站并转圈大笑

> 全部功能离线可用，只有「AI 助手」需要你自备一个 OpenAI 兼容接口的 Key。

---

## ✨ 功能一览

### 🐸 桌宠本体
| 功能 | 说明 |
| --- | --- |
| 多组动画 | 待机 / 左跑 / 右跑 / 挥手 / 大笑 / 失败 / 等待 / 审阅 / 工作（西装敲键盘） |
| 自由拖动 | 按住拖动即可搬家，按拖动方向切换跑步动画，位置自动记忆 |
| 悬停互动 | 鼠标移到身上：挥手 + 展开今日日程；点击：打开面板 |
| 常驻置顶 | 浮在所有窗口之上；`Win + D` 显示桌面后自动回来 |
| 气泡轮播 | 自动轮播今日日程与倒数日，不打扰但随时可瞄一眼 |

### 📅 日程与提醒
- `schedule.txt` 记录日程：`HH:MM|内容`（每天重复）或 `YYYY-MM-DD HH:MM|内容`（仅这一天）
- **到点提醒**：气泡变红闪烁 + 奶蛙跳跃 + 提示音
- **提前预告**：到点前 5 分钟先轻声提醒「5 分钟后：XXX」
- **完成庆祝**：当天全部勾完 → 大笑动画 + 音效

### 🪟 液态玻璃日程面板
- 实时时钟 + 日期（星期/农历节日标注：元旦、情人节、儿童节、国庆……）
- **日历月视图**：一眼看到哪天有日程
- **倒数日 chips**：距离下一个纪念日还有几天
- **勾选打卡**：完成度进度条 + **连续打卡天数（连签）**
- 5 套玻璃主题：奶黄玻璃 / 浅色玻璃 / 琥珀玻璃 / 科技青 / 午夜紫
- 可拖动、位置记忆，背景是实时模糊取样（真·毛玻璃）

### 🎛️ 右键切换形态

<p align="center"><img src="docs/screens/menu.png" width="220" alt="形态菜单"></p>

| 形态 | 能力 |
| --- | --- |
| 🐸 普通形态 | 桌宠 + 日程提醒 |
| 🤖 **奶蛙助手** | 让 AI 帮你操作电脑（见下） |
| ⏳ 倒计时奶娃 | 1/3/5/10/25 分钟快捷 + 自定义；头顶实时计时牌，到点三连音 + 跳跃 |
| ⏰ 闹钟奶娃 | 设定时/分，到点双音循环响铃，点一下奶蛙停止 |
| 🪙 抛硬币奶娃 | 填入两个选项让它替你做决定，旋转 720° + 叮声出结果（也可直接点奶蛙） |
| 🏃 抓奶蛙 | 小游戏：满屏乱跑、撞墙反弹、**鼠标贴到身上会转向逃跑**、计时统计 |

### 🤖 AI 电脑助手（Computer Use）
> 不是"聊天机器人"，是真的能看屏幕、动鼠标键盘的电脑助手。

- **看屏幕**：截图发给多模态模型
- **动手**：单击 / 双击 / 右键 / 输入文字 / 按键（`ctrl+s`、`win+r`…）/ 滚动 / 等待 / 启动应用或网址
- **两种节奏**：`每步确认`（默认，每个动作都等你点「执行」）和 `自动执行`
- **安全设计**：
  - 密钥用 Windows 本机加密存储（Electron `safeStorage`，DPAPI），不写明文、不上传
  - **截图时自动隐藏奶蛙自己的所有窗口** —— 既避免 AI 把自己点关，也避免它算错坐标
  - 内置系统提示词禁止危险操作（删文件、付款、发消息、改系统设置），遇到先问你
- 兼容任何 **OpenAI 格式**接口：官方 OpenAI、DeepSeek、通义、Kimi、本地 Ollama……（默认示例：OpenCode Go + `deepseek-v4.1-flash`）

<p align="center"><img src="docs/screens/panel.png" width="330" alt="日程面板"> <img src="docs/screens/tool.png" width="330" alt="工具面板"></p>

### 🗑️ 拖文件回收
1. 把不要的文件（或文件夹、多个一起）**拖到奶蛙身上**
2. 如果它在**桌面上**，奶蛙会**一路跑过去**停在图标旁边再开口问你（原地不动的只有文件本身 😄）
3. 气泡弹出 `回收「文件名」？` → 点 **回收** → 进回收站（可还原）+ 奶蛙旋转大笑；点取消/超时 → 自己跑回原位

<p align="center"><img src="docs/screens/recycle.png" width="300" alt="回收确认"> <img src="docs/screens/catch.png" width="420" alt="抓奶蛙"></p>

---

## 🚀 快速开始

### 方式一：下载绿色版（推荐）

1. 到 [**Releases**](../../releases) 下载最新 `nailong-assistant-vX.Y.Z-win-x64.zip`
2. 解压到任意目录（**建议放在非系统盘**，例如 `D:\奶蛙助手`）
3. 双击 `奶蛙助手.bat` 启动；建议右键发送到桌面快捷方式

> 免安装、不写注册表；卸载 = 删除文件夹。

### 方式二：从源码运行

```bash
git clone https://github.com/wangyiding645/nailong-assistant.git
cd nailong-assistant
npm install          # 只装 Electron 一个依赖
npm start
```

环境要求：Windows 10/11 + Node.js 18+。

---

## 🤖 配置 AI 助手

打开助手窗口（右键奶蛙 → 奶蛙助手 → ⚙），填入三项并「保存并测试连接」：

| 项 | 示例 |
| --- | --- |
| Base URL | `https://opencode.ai/zen/go/v1`（或 `https://api.openai.com/v1`、`https://api.deepseek.com/v1` …） |
| API Key | 你的 Key（保存后本机加密，界面只显示 `••••••`） |
| 模型名 | 需要支持图片输入，例如 `deepseek-v4.1-flash`、`gpt-4o-mini`、`qwen-vl-max` |

> 💡 支持「每步确认」模式：AI 每想做一个动作都会先展示出来，你点 **执行 / 跳过 / 本任务自动** 再继续。第一次用建议保持默认。

---

## 🧠 技术亮点 & 踩坑记录

<details>
<summary><b>架构</b>（点开）</summary>

- **Electron 44**，无框 + 透明 + 置顶多窗口：桌宠 / 日程面板 / 助手 / 工具 / 形态菜单
- 纯本地数据文件（`schedule.txt`、`countdown.txt`、`state.json`），随时可手工编辑、可 Git 备份
- `preload.js` 统一 contextBridge 暴露 IPC；渲染层零 Node 权限
- `native/*.ps1` 干"系统级脏活"：窗口置顶保序、最小化恢复、DPI 感知输入模拟、壁纸模糊取样、桌面图标坐标、回收站

</details>

<details>
<summary><b>踩过的坑</b>（同行少走弯路）</summary>

1. **透明无框窗口 `setPosition` 会撑大窗口**（每调用一次尺寸 +1px）→ 一律用 `setBounds` 带尺寸移动
2. **PowerShell 5.1 读无 BOM 的 .ps1 会乱码** → 脚本内不写中文，窗口标题等参数由 Node 传参
3. **精灵表里的"半透明白肚子"** 会让壁纸透出来 → 批量把内部 alpha<255 的像素补成不透明
4. **桌面图标列表不在 `Progman` 的直属子窗口里**（Win11）→ 全桌面枚举 `SysListView32` + 向上追溯祖先含 `Progman/WorkerW` 才算数
5. **跨进程读 `LVM_GETITEMRECT`** 时，传给 `SendMessage` 的地址必须是 `VirtualAllocEx 基址 + 偏移`（漏了基址会拿到全 0）
6. **截图会把奶蛙自己拍进去** → 截图瞬间把自身窗口 `setOpacity(0)`，AI 就不会点到面板上了
7. **AI 操作时窗口失焦** → 助手加 📌 图钉：`screen-saver` 层级 + 跨全屏可见 + 看门狗兜底

</details>

---

## 📁 项目结构

```
├─ main.js              主进程：窗口、IPC、AI 循环、抓奶蛙物理、跑位、回收
├─ preload.js           contextBridge 桥接（含文件拖放捕获）
├─ renderer/
│  ├─ pet.js / pet.html      桌宠：动画状态机、气泡、拖动、形态
│  ├─ popup.js / popup.html  玻璃日程面板（列表/日历/添加）
│  ├─ assistant.*            奶蛙助手（设置/对话/工具调用/确认）
│  ├─ tool.*                 倒计时 / 闹钟 / 抛硬币
│  ├─ menu.*                 右键形态菜单
│  └─ logic.js               纯逻辑：日程解析、倒数日、节日
├─ native/             PowerShell 助手（置顶/输入/模糊/桌面坐标/回收站）
├─ assets/             精灵图、音效、图标
└─ docs/screens/       README 截图
```

---

## 🗺️ Roadmap

- [ ] 一键安装包（NSIS）与自动更新
- [ ] 更多形态与小游戏（番茄钟、喝水提醒、桌面宠物互访）
- [ ] 多显示器 / 多 DPI 完善
- [ ] 日程数据支持导入导出（ICS）
- [ ] 英文界面 i18n

欢迎 Issue 许愿 / PR 实现。

---

## ⚠️ 免责声明

- AI 助手会**真实操作你的鼠标键盘**，请先使用「每步确认」模式，并避免让它处理付款、删除等重要操作
- 拖拽回收走的是系统回收站（可还原），但仍请确认后再点「回收」
- 本项目与任何模型服务商无关联，接口费用由你的账号承担

## 🙏 致谢

- 角色动画 / 音效素材：来自作者提供的奶蛙（nailong）素材库；如你是素材原作者并希望调整署名或许可，请开 Issue 联系
- 灵感来自各类桌面宠物、Tamagotchi 与 "computer use" 智能体

## 📄 License

[MIT](LICENSE) © 2026 nailong-assistant contributors

<div align="center"><sub>如果这只小奶蛙让你的桌面更有趣，点个 ⭐ 就是最大的鼓励</sub></div>
