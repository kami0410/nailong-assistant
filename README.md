<div align="center">

<img src="docs/screens/pet.png" width="160" alt="奶蛙助手">

# 奶蛙助手 · Nailong Assistant

**一只住在你桌面上的奶蛙，会看屏幕、会用鼠标键盘 —— 它是你的 AI 电脑助手，顺便还是个桌宠。**

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4?logo=windows&logoColor=white)](#)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](#)
[![License](https://img.shields.io/badge/License-MIT-3DA639)](LICENSE)
[![Release](https://img.shields.io/github/v/release/wangyiding645/nailong-assistant?color=orange)](../../releases)
[![Stars](https://img.shields.io/github/stars/wangyiding645/nailong-assistant?style=social)](https://github.com/wangyiding645/nailong-assistant/stargazers)

[简体中文](README.md) · [English](README_EN.md)

</div>

---

## 🤖 核心：奶蛙助手（AI Computer Use）

> 市面上大多数"AI 助手"只能陪你聊天。**奶蛙助手能真的动你的电脑。**

它把你的桌面截图发给多模态大模型，模型想好下一步，再由奶蛙**真实地**移动鼠标、点击、打字、按快捷键、滚动页面、启动程序 —— 每一步都执行、截图、判断、继续，直到把事情做完。

**说人话就是**：你说"帮我把微信里没读的消息数报给我"，它会自己打开微信、找红点、数给你听。

### 它能做哪些操作

| 工具 | 说明 |
| --- | --- |
| 📷 `screenshot` | 截取当前屏幕并"看懂"（坐标以截图像素为准） |
| 🖱 `click` / `dblclick` / `rightclick` | 在屏幕任意坐标单击 / 双击 / 右键 |
| ⌨️ `type` | 向当前焦点输入任意文字（中文也 OK，走剪贴板粘贴） |
| ⚡ `key` | 按键与组合键：`enter`、`esc`、`ctrl+s`、`win+r`、`alt+tab`、`f5`… |
| 🖲 `scroll` | 滚轮上/下滚动 |
| ⏳ `wait` | 等待界面加载（毫秒） |
| 🚀 `launch` | 启动应用或打开网址：`notepad`、`explorer`、`https://…` |

### 三步用起来

1. **唤出**：右键奶蛙 → **🤖 奶蛙助手**（奶蛙会立刻换上"西装敲笔记本"的工作形象 🤵）
2. **填接口**：点右上角 **⚙**，**只填 Base URL 和 API Key 就能用** → **保存并测试连接**
3. **开口使唤**：在输入框写下你的需求 → 发送

> ✅ **最简配置就两项**：`Base URL` + `API Key`。
> 模型名**留空会自动检测** —— 奶蛙会去 `/models` 里挑一个支持图片输入的模型并自动填好（也可手动指定）。

> 💡 每次做完一个动作，模型都会**自动收到一张新截图**确认结果，不需要你手动截屏。
> 想额外附一张"当前屏幕"给它，点一下 **📷 附带截图** 开关即可。

### 接口配置（任意 OpenAI 兼容服务）

| 字段 | 必填 | 说明 | 例子 |
| --- | --- | --- | --- |
| **Base URL** | ✅ | OpenAI 格式的接口根地址 | `https://api.openai.com/v1` · `https://api.deepseek.com/v1` · `https://dashscope.aliyuncs.com/compatible-mode/v1` · `http://localhost:11434/v1`(Ollama) |
| **API Key** | ✅ | 服务商的 Key | `sk-…`（保存后本机加密，界面只显示 `••••••`） |
| **模型名** | ⬜ 可留空 | **留空 = 自动检测**；手动填则须支持图片输入（多模态） | `gpt-4o-mini`、`qwen-vl-max`、`gemini-2.0-flash`、`deepseek-v4-flash-vision-exp`… |

### 两种执行节奏

| 模式 | 行为 | 适合 |
| --- | --- | --- |
| 🛡 **每步确认**（默认） | AI 想做的每个动作都会先弹出来，你点 **执行 / 跳过 / 本任务自动** 才继续 | 第一次用、敏感操作 |
| ⚡ **自动执行** | 一口气把任务做完，你只看它表演 | 信任后的重复任务 |

- **跳过**：让它换个思路（AI 会知道你拒绝了这一步）
- **本任务自动**：本次任务剩下的步骤不再问，下次任务恢复确认
- 随时 **停止** 中断，**清空** 开一段新对话

### 界面元素速查

| 元素 | 作用 |
| --- | --- |
| 📌 **图钉** | 钉住窗口：锁定最高层级（能压住全屏应用）+ 被最小化会自动回来。跑长任务时建议开着 |
| 📷 附带截图 | 发送消息时额外附带一张当前屏幕 |
| 每步确认 / 自动执行 | 切换上面说的两种节奏 |
| ⚙ | 修改接口配置 |
| ✕ | 收起窗口（右键奶蛙可再次唤出；AI 任务不会因此中断） |

### 用法示例（直接照抄）

| 场景 | 你说 |
| --- | --- |
| 看屏幕报信息 | 「看一下屏幕，告诉我现在打开的软件在做什么」 |
| 打开并登录网站 | 「打开 https://example.com，帮我填上邮箱 xxx@qq.com」 |
| 整理窗口 | 「把记事本打开，写上'明天 9 点开会'，然后保存到桌面叫 备忘.txt」 |
| 重复操作 | 「在浏览器里把当前页面的标题复制下来，用记事本记下来」 |
| 查资料 | 「打开百度，搜'今天的天气'，把结果念给我」 |
| 让它自己判断 | 「看看我屏幕上有没有报错弹窗，有的话念给我听，然后点掉」 |

### 安全设计（为什么敢让它动电脑）

- 🔐 **密钥不出本机**：用 Windows 本机 DPAPI（Electron `safeStorage`）加密保存，不写明文、不联网上传；界面上永远显示为 `••••••`
- 🕶 **截图时自动隐身**：截屏瞬间把奶蛙的所有窗口设为全透明 —— 既防止 AI"看到自己"算错坐标，也防止它把自己的面板点关掉
- 🧭 **每步可拦**：默认每步都要你点「执行」，随时可「跳过」或「停止」
- 🚫 **内置红线**：系统提示词明确禁止删除文件、付款、发送消息、改系统设置等危险操作，遇到会先停下来问你
- 🗂 **动作全记录**：每一步动作都会以 `▶ 点击 (x,y)` 的形式留在对话里，可回查

### 常见问题

<details>
<summary><b>连接失败 / 403 / 400？</b></summary>

- 确认 Base URL 填的是**根地址**（程序会自动补 `/chat/completions`）
- 有些网关要求特定的 `User-Agent` / 会话头，或限制了地区，换官方接口试试
- 报错信息会原样显示在窗口里，按提示改
</details>

<details>
<summary><b>模型名要自己填吗？</b></summary>

不用。**只填 Base URL 和 API Key**，点保存时奶蛙会请求 `<Base URL>/models`，优先挑带 `vision / vl / 4o / gemini / qwen / flash` 等关键词的多模态模型并自动填入。
如果你的服务商没有 `/models` 接口（少数网关），它会提示你手动填一个。
</details>

<details>
<summary><b>AI 说"看不到画面"或点错位置？</b></summary>

- 模型**必须支持图片输入**，纯文本模型（如 `deepseek-chat`）不行
- 坐标以截图像素为准；程序已做 DPI 缩放换算，但若你改了系统缩放比例，重启一次即可
</details>

<details>
<summary><b>为什么截图里看不到奶蛙？</b></summary>

这是故意的 —— 截图时奶蛙会把自己藏起来，这样 AI 不会把奶蛙当成要操作的目标。
</details>

<details>
<summary><b>费钱吗？</b></summary>

每次动作会带一张压缩后的截图（1280 宽 JPEG），步骤越多花费越高。
建议先用「每步确认」摸清一个任务的步数，再决定要不要自动化。费用由你的接口账号承担。
</details>

---

## 🐸 顺便，它还是只好桌宠

| 功能 | 说明 |
| --- | --- |
| 多组动画 | 待机 / 左跑 / 右跑 / 挥手 / 大笑 / 失败 / 等待 / 审阅 / **工作（西装敲键盘，开助手时自动换上）** |
| 自由拖动 | 按住拖动搬家，按方向切换跑步动画，位置自动记忆 |
| 悬停互动 | 鼠标放上去：挥手 + 展开今日日程；点击：打开面板 |
| 常驻置顶 | 浮在所有窗口之上；`Win + D` 显示桌面后自动回来 |
| 气泡轮播 | 自动轮播今日日程与倒数日 |

### 📅 日程与提醒
- `schedule.txt`：`HH:MM|内容`（每天）或 `YYYY-MM-DD HH:MM|内容`（仅这天）
- 到点：气泡变红闪烁 + 跳跃 + 提示音；**提前 5 分钟**轻声预告；当天全部完成 → 大笑庆祝

### 🪟 液态玻璃日程面板
- 实时时钟 + 日历月视图（节日标注）、倒数日 chips、勾选打卡、**连签天数**
- 5 套玻璃主题，背景是实时模糊取样（真·毛玻璃），可拖动、位置记忆

<p align="center"><img src="docs/screens/panel.png" width="320" alt="日程面板"> <img src="docs/screens/tool.png" width="320" alt="工具面板"></p>

### 🎛️ 右键切换形态

<p align="center"><img src="docs/screens/menu.png" width="200" alt="形态菜单"></p>

| 形态 | 能力 |
| --- | --- |
| 🤖 奶蛙助手 | 上面那位 |
| ⏳ 倒计时奶娃 | 1/3/5/10/25 分钟快捷 + 自定义；头顶计时牌，到点三连音 + 跳跃 |
| ⏰ 闹钟奶娃 | 设定时/分，到点双音循环响铃，点奶蛙停止 |
| 🪙 抛硬币奶娃 | 填两个选项让它替你做决定，旋转 720° 出结果（也可直接点奶蛙） |
| 🏃 抓奶蛙 | 小游戏：满屏乱跑、撞墙反弹、**鼠标贴上来会转向逃跑**、计时统计 |

### 🗑️ 拖文件回收
把文件（或文件夹、多个一起）**拖到奶蛙身上** → 如果在桌面上，奶蛙会**一路跑过去**停在图标旁问你 `回收「文件名」？` → 确认后进回收站（可还原）+ 旋转大笑；取消 → 自己跑回原位。

<p align="center"><img src="docs/screens/recycle.png" width="280" alt="回收确认"> <img src="docs/screens/catch.png" width="400" alt="抓奶蛙"></p>

---

## 🚀 快速开始

### 方式一：下载绿色版（推荐）

1. 到 [**Releases**](../../releases) 下载 `nailong-assistant-vX.Y.Z-win-x64.exe`（免安装单文件）
2. 双击即用；想固定位置就把它放进 `D:\奶蛙助手` 之类的目录

### 方式二：从源码运行

```bash
git clone https://github.com/wangyiding645/nailong-assistant.git
cd nailong-assistant
npm install     # 只装 Electron
npm start
```

环境：Windows 10/11 + Node.js 18+。

---

## 🧠 技术亮点 & 踩坑记录

<details>
<summary><b>架构</b></summary>

- **Electron 44**，无框 + 透明 + 置顶多窗口：桌宠 / 日程面板 / 助手 / 工具 / 形态菜单
- 纯本地数据文件（`schedule.txt`、`countdown.txt`、`state.json`），手工可编辑、Git 可备份
- `preload.js` contextBridge 暴露 IPC；渲染层零 Node 权限
- AI 循环在**主进程**：`screenshot → tool_call → 执行 → 回传截图 → 再决策`，函数调用格式为标准 OpenAI tools
- `native/*.ps1` 负责系统脏活：窗口置顶保序、最小化恢复、DPI 感知输入模拟、壁纸模糊取样、桌面图标坐标、回收站

</details>

<details>
<summary><b>踩过的坑（同行少走弯路）</b></summary>

1. **透明无框窗口 `setPosition` 会撑大窗口**（每次 +1px）→ 一律 `setBounds` 带尺寸移动
2. **PowerShell 5.1 读无 BOM 的 .ps1 会乱码** → 脚本保持 ASCII，标题等参数由 Node 传参
3. **精灵表"半透明白肚子"** 会透出壁纸 → 批量把内部 alpha<255 的像素补成不透明
4. **Win11 桌面图标列表不在 `Progman` 直属子窗口** → 全桌面枚举 `SysListView2` + 祖先含 `Progman/WorkerW` 才算
5. **跨进程 `LVM_GETITEMRECT`** 的缓冲区地址必须是 `VirtualAllocEx 基址 + 偏移`（漏基址会拿到全 0）
6. **截图会把奶蛙自己拍进去** → 截图瞬间 `setOpacity(0)` 隐藏自身窗口
7. **AI 操作时助手窗口失焦** → 📌 图钉：`screen-saver` 层级 + 跨全屏可见 + 看门狗兜底

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

- [ ] 更多助手能力：读剪贴板、批量重命名、定时任务
- [ ] 一键安装包（NSIS）与自动更新
- [ ] 更多形态与小游戏（番茄钟、喝水提醒）
- [ ] 多显示器 / 多 DPI 完善
- [ ] 英文界面 i18n

欢迎 Issue 许愿 / PR 实现。

---

## ⚠️ 免责声明

- 奶蛙助手会**真实操作你的鼠标键盘**，请先用「每步确认」模式，并避免让它处理付款、删除等重要操作
- 拖拽回收走系统回收站（可还原），仍请确认后再点「回收」
- 本项目与任何模型服务商无关联，接口费用由你的账号承担

## 🙏 致谢

- 角色动画 / 音效素材来自奶蛙（nailong）素材库；如你是原作者并希望调整署名或许可，请开 Issue
- 灵感来自各类桌面宠物、Tamagotchi 与 "computer use" 智能体

## 📄 License

[MIT](LICENSE) © 2026 wangyiding645

<div align="center"><sub>如果这只小奶蛙让你的桌面更有趣（或者真的帮你干了活），点个 ⭐ 就是最大的鼓励</sub></div>
