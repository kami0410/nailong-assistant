# 奶蛙助手 · 架构

> 一句话：**pi 当大脑（而且是自带的那一套），奶蛙当手和脸。**
> 复杂推理、模型接入、上下文管理交给 pi（跑在独立子进程里，用奶蛙自己的配置，不碰 `~/.pi`）；
> 看屏幕、动鼠标、读写文件、管日程这些真正碰系统的事，留在 Electron 主进程里，
> 通过一个只有本机能访问的工具桥暴露给 pi。

---

## 1. 进程与信任边界

```
┌──────────────────────────── Electron 主进程（Node，CommonJS） ────────────────────────────┐
│                                                                                          │
│  main.js                        启动装配、形态切换、定时循环（提醒/专注/剪贴板/前台窗口）      │
│  ├── src/main/windows.js        6 个窗口：桌宠 / 面板 / 助手 / 工具 / 形态菜单 / 设置        │
│  ├── src/main/store.js          原子写入 + 防抖 + 损坏自愈的 JSON 仓                        │
│  ├── src/main/log.js            分级日志 + 滚动 + 崩溃兜底                                 │
│  ├── src/main/services.js       日程 / 倒数日 / 专注 / 记忆 / 剪贴板 / 提醒引擎 / 统计        │
│  ├── src/main/native.js         PowerShell 桥（一次性脚本 + 常驻 worker）                   │
│  ├── src/main/host.js           截图・无障碍树・输入・窗口・系统信息（工具真正执行的地方）     │
│  ├── src/main/pet-actions.js    抓奶蛙物理、跑去桌面图标、拖文件回收                         │
│  ├── src/main/audit.js          无头界面自检（npm run audit）                              │
│  │                                                                                       │
│  ├── src/main/engines/bridge.js ★ 本地工具桥（127.0.0.1 + 随机 token）                     │
│  ├── src/main/engines/pi.js     ★ pi 子进程引擎（RPC 行协议 + 事件归一）                    │
│  ├── src/main/engines/index.js  ★ 双内核路由（pi / 内置，一套对外接口）                     │
│  ├── src/main/engines/pi-agent-dir.js  自带 agent 目录（不当机器上 pi 的跟屁虫）          │
│  ├── src/main/engines/pi-preflight.js  启动前自检（代理/凭据/目录）                        │
│  ├── src/main/engines/pi-history.js    pi 转录 → 界面条目                                │
│  └── src/main/agent-service.js  内置引擎（零依赖的轻量 agent 循环）                         │
│                                                                                          │
│  preload.js                     contextBridge：渲染层唯一通道（无 Node 权限）               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        │ IPC                                    │ HTTP(127.0.0.1) + x-nailong-token
        ▼                                        ▼
┌─────────────────────┐              ┌──────────────────────────────────────────────┐
│ 8 个渲染进程         │              │ pi 子进程（Electron-as-Node，与本机 pi 隔离）   │
│ 纯 HTML/CSS/JS       │              │ PI_CODING_AGENT_DIR=.userdata/pi-agent       │
│ 无 Node 权限         │              │ pi --mode rpc                                │
│ CSP: default-src     │              │   --no-builtin-tools   ← 不要 pi 的 read/bash │
│      'none'          │              │   --no-extensions      ← 不要用户其它扩展     │
└─────────────────────┘              │   -e pi-ext/nailong.mjs ← 只要奶蛙的手        │
                                     │                                              │
                                     │  自己的配置目录（不读 ~/.pi）：                 │
                                     │   ├─ settings.json    provider/模型/档位      │
                                     │   ├─ APPEND_SYSTEM.md 「你是桌面助手」+ 红线   │
                                     │   └─ sessions/        会话文件                │
                                     │                                              │
                                     │  nailong.mjs 启动时：                         │
                                     │   1. 拉 /catalog → 把 54 个工具注册成 pi 工具  │
                                     │   2. 调 /config → registerProvider('nailong') │
                                     │   3. 每个工具 execute → POST /tool 回主进程执行│
                                     └──────────────────────────────────────────────┘
```

### 为什么 pi 要跑在子进程里

| 好处 | 说明 |
| --- | --- |
| 崩溃隔离 | pi 挂了，桌宠、日程、番茄钟照常工作，界面自动退回内置引擎 |
| ABI 无关 | pi 的依赖不进 Electron 主进程，不用管 Node ABI / 原生模块 |
| 协议是一等公民 | `pi --mode rpc` 是官方文档化的契约，升级时坏在哪一眼能看见 |
| 可切换 | 设置里一键切回内置引擎，不重启应用 |

### 为什么工具不能也搬进 pi

截图要 `desktopCapturer`、无障碍树要有 UI 线程的消息泵、模拟输入要走 DPI 感知的 Win32、
回收站要 Shell API —— 这些能力天然属于 Electron 主进程。与其把 pi 改造成会操作电脑的
东西，不如让它通过一个窄接口调用我们已经测过的实现。

---

## 2. 工具桥（src/main/engines/bridge.js）

| 端点 | 方法 | 作用 |
| --- | --- | --- |
| `/health` | GET | 存活探测，返回工具总数 |
| `/catalog` | GET | 工具清单（含 JSON Schema），pi 扩展据此注册工具 |
| `/config` | GET | 当前 Base URL / 模型 / Key，给 pi 扩展注册 provider 用 |
| `/tool` | POST | 执行一个工具，返回 `{ok, text, images[]}` |
| `/notify` | POST | 让 pi 侧能弹系统通知 |
| `/log` | POST | pi 侧的日志回流到主日志 |

安全约束：

- 只 `listen(0, '127.0.0.1')`，端口随机，**不对外网暴露**
- 每次启动生成 24 字节随机 token，放在 `x-nailong-token` 头里，用 `timingSafeEqual` 比对
- 路径写死在白名单里，不接受任意路径调用
- 权限判定复用 `agent/permissions.js`：**换内核不放水**。桥里决定 allow/ask/deny，
  `ask` 就走和内置引擎完全相同的用户确认条
- `cancelPending()`：用户点停止时把所有挂着的确认一次性否掉，否则 pi 的 tool call 会一直悬着
- 屏蔽 `--no-extensions`：用户自己的 pi 扩展不会被加载进来，避免第三方代码在我们的进程边上跑

---

## 3. pi 内核的配置目录：自带，而不是借用

奶蛙**自带一套独立的 pi 配置**，默认不去读机器上的 `~/.pi/agent`：

```
settings.agent.piConfig = 'bundled' | 'system'     默认 bundled

bundled（默认）  PI_CODING_AGENT_DIR = <应用目录>/.userdata/pi-agent
                 ├─ settings.json      只写 defaultProvider/defaultModel/档位；**绝不写代理**
                 ├─ APPEND_SYSTEM.md   身份与红线（“你是桌面助手，不是编程助手”）
                 └─ sessions/          pi 的会话文件
                 凭据：来自奶蛙设置（Base URL + Key + 模型）→ 扩展注册成 provider「nailong」

system           不设 PI_CODING_AGENT_DIR，用机器上 pi 自己的配置与登录
                 （能用已登录的订阅，但也会连带它的代理/扩展/偏好）
```

为什么不直接借用机器上的 pi：

1. **别人的配置会把奶蛙带坏**。实测踩过一次：`~/.pi/agent/settings.json` 里配了个没开的
   `httpProxy`，pi 会把它当成 `HTTP_PROXY`/`HTTPS_PROXY` 应用到自己的 HTTP 客户端上，
   于是每次模型调用都只回一句含糊的 `Connection error.`
2. **凭据应该来自奶蛙自己**。用户填的是 Base URL + API Key + 模型，不需要再去改 pi 的全局配置
3. **行为可预测**。出问题只可能是奶蛙自己的配置，排查范围小一个量级

对应地，`engines/pi-preflight.js` 会先自检再启动：读当前生效的 agent 目录，
检查代理是否配了、主机端口是否真能连，并把结论翻译成人话（哪个文件、哪个端口、三条修复路径）。
自检结果会出现在启动日志、设置窗、以及助手窗收到连接错误的时候。

### 计划模式是怎么做的

pi 本身没有 RPC 级的 plan 命令（那是扩展提供的）。奶蛙自己实现了一套，不依赖任何第三方扩展：

1. `propose_plan` 是奶蛙自己的工具（`level: low`）——审批本身就是确认，不该再叠一层权限弹窗
2. 扩展在 `before_agent_start` 里**每轮重新问一次桥**要不要计划模式，要就往系统提示后面追加一段指令
   （所以开关是热的：设置里改完下一次对话就生效，不用重启 pi）
3. 内置引擎走自己的 `buildSystemPrompt({ planMode })`
4. 用户在助手窗的计划卡片上选「批准 / 改一下 / 不行」，结果回给模型；
   **拒绝时工具返回 `ok:false`**，避免模型把"被拒绝"当成"已完成"继续动手

### 界面多语言

`renderer/i18n.js` 是个零依赖小字典：HTML 上加 `data-i18n` / `data-i18n-title` / `data-i18n-ph`，
初始化时 `setLocale(设置里的语言) → applyDom()`；JS 里拼句子用 `t('key', { n: 3 })`。
**缺 key 会原样回退**（不会变空白），所以可以一条条补。

界面自检会统计"有 `data-i18n` 却没被翻译"的元素并当成问题报出来；
测试还会校验 HTML/JS 里出现的每个 key 词典里都有、且中英 key 集合一致——不然这种事只能靠人肉翻页面。

应用添加 MCP 服务器时默认写 `exposure: direct`，便于直接声明工具。pi 的 codemode/deferred 也能通过搜索、描述与加载机制发现工具；不能概括为“模型看不到”。MCP 扩展本身仍需启用用户扩展开关。具体以随包 pi 的 `docs/mcp.md` 为准。

### 写入策略：不跟 pi 抢文件

pi 启动后会把 `settings.json` 规范化（补上自己的 `compaction`/`retry` 等键）。
所以奶蛙写入前做的是**子集校验**：我们要的键都在就不写；缺了才合并写回，
并保证不抹掉 pi 自己的键。实测连续两次启动的写入次数为 0。

---

## 4. 工具层（src/main/tools/）

54 个工具，分 7 组；每个工具声明 `level`（`low` 只读 / `mid` 改动 / `high` 高危）。
分布：电脑操作 19 / 文件 9 / 系统 11 / 日程 6 / 专注 4 / 记忆 2 / 助手 3。

其中 `view_image` 是 v3.2 新加的：读一张本地图片交给模型看（用户说「看下这张截图」时用），
比「先 launch 打开图片再 screenshot」准确得多，也不会把别的窗口拍进来。

| 组 | 代表工具 | 说明 |
| --- | --- | --- |
| 电脑操作 | `screenshot` `ui_tree` `find_element` `click_element` `click` `type_text` `press_key` `drag` `launch` `focus_window` `window_action` `screen_info` | 坐标以截图像素为准，桥内自动换算成物理像素 |
| 文件 | `read_file` `write_file` `list_dir` `file_info` `mkdir` `copy_path` `move_path` `delete_path` `search_files` | `delete_path` 只进回收站，且永远要确认 |
| 系统 | `run_command` `clipboard_*` `system_info` `list_processes` `set_volume` `set_brightness` `lock_screen` `notify_user` `web_fetch` | 命令走 PowerShell `-EncodedCommand`，避开引号地狱 |
| 日程 | `schedule_list` `schedule_add` `schedule_done` `schedule_remove` `countdown_*` | **AI 直接改用户的日程表**，这是和普通聊天助手的分水岭 |
| 专注 | `focus_start` `focus_status` `focus_stop` `stats_overview` | 番茄钟与统计 |
| 记忆 | `remember` `recall` | 跨会话长期记忆 |
| 奶蛙助手 | `ask_user` `think` | 反问用户 / 写草稿 |

**无障碍元素树是精度的关键**：`native/uia.ps1` 是个常驻 worker，把 Windows UI Automation
的元素（角色、名称、值、精确边界、是否可用）dump 成带 id 的紧凑文本；模型可以
`click_element(e37)`，而不是猜像素坐标。截图只在需要判断视觉布局时才用。

---

## 4. 数据与存储

全部是本地纯文本 / JSON，可手改、可 git、可直接备份：

| 文件 | 内容 |
| --- | --- |
| `schedule.txt` | 日程，一行一条，`HH:MM|内容|repeat=…;alarm=…;prio=…;tag=…` |
| `countdown.txt` | 倒数日 `YYYY-MM-DD|名称` |
| `state.json` | 打卡记录、连签、音效开关（v2 路径不变，升级不丢数据） |
| `settings.json` | 主题、快捷键、权限策略、提醒/番茄参数 |
| `agent.json` | 接口配置（Key 用 Windows DPAPI 加密） |
| `agent-memory.json` | 长期记忆 |
| `focus.json` | 番茄钟记录 |
| `clipboard.json` | 剪贴板历史（可关） |
| `.userdata/pi-sessions/` | pi 内核的会话文件（JSONL） |

`store.js` 保证：先写临时文件再 `rename`（断电不会写坏），写坏的文件自动改名留档，
读取时按版本号迁移。

---

## 5. 双内核路由（src/main/engines/index.js）

```
settings.agent.engine = 'auto' | 'pi' | 'builtin'
   auto    → pi 能起来就用 pi，起不来（没装/启动失败）静默退回内置
   pi      → 只用 pi；起不来就报错，不偷偷降级
   builtin → 只用内置引擎
```

路由器对 IPC 层完全透明：`send / stop / confirm / newSession / loadSession / usage …`
方法名和内置引擎一模一样，所以换内核不需要动 UI 代码。差异点在：

- **会话**：pi 侧用 `--session-dir .userdata/pi-sessions`，`new_session` / `switch_session` /
  `clone` / `fork` / `rename` 直接映射；内置引擎用 `agent-sessions.json`
- **结束语义**：内置引擎的 `send()` 一直到任务做完才返回；pi 的 `prompt` 一被接受就返回，
  真正结束看 `agent_settled` 事件。助手窗因此按 `res.engine` 决定要不要继续转圈
- **带图提问**：pi 的 `prompt` 支持 `images`，所以「📷 附图」在 pi 下是真正把图发过去
- **历史回放**：pi 的历史是 `AgentMessage[]`，由 `engines/pi-history.js` 转成和内置引擎
  同一套 UI 条目（含 thinking 与工具结果回填），所以两个内核共用同一份渲染代码

### pi 的能力矩阵（都在界面上有入口）

| 能力 | RPC 命令 | 界面入口 |
| --- | --- | --- |
| 选模型 | `get_available_models` / `set_model` / `cycle_model` | 助手窗「🧠 模型」 |
| 推理档位 | `get_available_thinking_levels` / `set_thinking_level` | 助手窗「💭 思考」 |
| 压缩上下文 | `compact` / `set_auto_compaction` | 助手窗「⋯ → 压缩上下文」+ 设置 |
| 自动重试 | `set_auto_retry` | 设置 → 模型 |
| 会话树 / 分支 | `switch_session` / `clone` / `fork` / `get_tree` / `set_session_name` | 助手窗「🗂 历史会话」「⋯ → 复制当前会话」 |
| 命令与技能 | `get_commands` | 助手窗「⋯ → pi 的命令与技能」（子代理、council、skills 从这里进） |
| 运行中插话 | `prompt` + `streamingBehavior` | 助手窗：它干活时发送键变成「插入」，说的话会插到当前任务里 |
| 从这里重来 | `get_fork_messages` / `fork` / `clone` | 助手窗「⋯ → 从某条消息重来」「历史会话 → 会话结构」 |
| 计划模式 | ——（自研工具 + 系统提示注入） | 设置 → 模型 → 计划模式；助手窗出计划卡片等你批准 |
| MCP 服务器 | ——（读 `<agent-dir>/mcp.json`） | 设置 → 模型 → MCP 服务器（粘贴 Claude Desktop 片段即可） |
| pi 资源开关 | ——（`--no-mcp` / `--no-skills` / `--no-context-files` / `--skill <path>`） | 设置 → 模型 → pi 资源开关 |
| 用量与花费 | `get_session_stats` | 助手窗右下角 + 设置 → 数据 |
| MCP / 子代理 / 第三方扩展 | ——（靠启动参数） | 设置 → 模型 →「同时加载你自己的 pi 扩展」（默认关） |

> **默认只加载奶蛙自己的扩展**（`--no-extensions`）。要 MCP / 子代理就在设置里显式打开，
> 代价是信任面扩大到所有你装过的 pi 包；权衡写在 [SECURITY.md](SECURITY.md#5-pi-内核的信任面)。

---

## 7. 事件归一

pi 的 RPC 事件被翻译成助手窗原本就在吃的形状，UI 基本不用改：

| pi 事件 | 归一后 |
| --- | --- |
| `message_update.assistantMessageEvent.text_delta` | `{type:'text', delta}` |
| `…thinking_delta` | `{type:'thinking', delta}` → 折叠成「💭 思考」卡片 |
| `tool_execution_start` | `{type:'tool-call', name, args}` |
| `tool_execution_end` | `{type:'tool-result', ok, ms, text, images[]}` |
| `agent_start` | `{type:'status'}` |
| `agent_settled` | `{type:'done', reply, aborted}` |
| `message_update.usage` | `agent-usage` 频道 |

行协议实现要点（踩过的坑写在代码注释里）：

- **只按 `\n` 切**，绝不能用 `readline`：`U+2028`/`U+2029` 是 JSON 字符串里的合法字符
- 命令带 `id`，**按 id 关联响应而不是按顺序**
- `agent_end` 不等于结束：重试、压缩恢复、排队消息都可能接着跑，`agent_settled` 才是终点
- 扩展里**不要用全局 `fetch`**：pi 进程会接管它，打本机 HTTP 直接 `fetch failed`，
  改 `node:http` 才行
- 子进程启动要带 `ELECTRON_RUN_AS_NODE=1`，否则 `electron.exe` 会当成「启动一个应用」立刻退出

---

## 8. 界面自检（npm run audit）

界面这种东西靠肉眼盯六个窗口 × 六套主题 × 十七个分页一定会漏。`src/main/audit.js` 会：

1. 依次显示每个窗口，注入探针读取：视口、`backdrop-filter`、圆角、渐变、关键元素尺寸
2. 逐个点开隐藏分页（面板的日历/统计/添加、工具的四个页签、设置的六个页）
3. 六套主题在六个窗口分别检查，确认 `body.className` 真的切过去了
4. 七种形态（普通/助手/专注/倒计时/闹钟/硬币/抓奶蛙）逐个切换并核对桌宠实际状态
5. **只报真被裁掉的元素**：会先找最近的 `overflow != visible` 祖先，可滚动的跳过，
   被 `hidden` 裁掉的才算问题

结果写进 `.cache/audit.json`，有问题退出码为 2，可以直接进 CI。

---

## 9. 打包：两个根目录

打包后最容易出人命的地方在这里，所以单开一节。

```
代码根（只读）  <exe 目录>/resources/app/          ← 打包后
                （开发时就是源码目录）
                renderer / native / assets / pi-ext / node_modules

数据根（可写）  找第一个能写的：
                NAILONG_DATA_DIR → PORTABLE_EXECUTABLE_DIR → exe 所在目录
                → 源码目录（开发时） → %APPDATA%\奶蛙助手（兜底）
                schedule.txt / settings.json / .userdata（含 pi-agent、pi-sessions）/ .cache
```

两个具体坑：

1. **数据不能落在 `app.asar` 里**。打包后 `__dirname` 是 `<安装目录>/resources/app.asar/src/main`，
   那是只读的，`ROOT` 必须先换算成可写的目录。每个候选目录都先试写一个探针文件，
   写不进去就换下一个。
2. **portable 版每次运行会解压到 `%TEMP%` 下的随机目录**。
   如果不认 `PORTABLE_EXECUTABLE_DIR`，用户的数据就会写在临时目录里、一关就没了。
   所以它排在最前面。

### 为什么关掉 asar

asar 不压缩（只是把文件拼成一个包，省的是文件数量），但会让**外部进程读不到里面的文件**：

- `native/*.ps1` 是 PowerShell 在读
- `pi-ext/nailong.mjs` 与 pi 自己的 CLI 是 pi 子进程在读
- 扩展里的 `import { Type } from 'typebox'` 是 jiti 在解析

打开 asar 就得为这三条各准备一套 `app.asar.unpacked` 路径映射，一旦漏一处就是
“打包后才出现、开发环境永远复现不了”的 bug。关闭 asar 便于外部进程读取真实文件，但会增加散文件数量、复制和扫描开销，也使资源更易改动。压缩包体积、安装体积与启动性能不能据此断言完全不变。 `paths.js` 里保留了 `unpacked()` 工具函数，
将来真要用 asar 可以直接接上。

### 产物

| 命令 | 产物 | 说明 |
| --- | --- | --- |
| `npm run dist:portable` | `nailong-assistant-<ver>-win-x64-portable.exe`（~133MB） | 免安装：双击就跑，数据落在它旁边 |
| `npm run dist:installer` | `nailong-assistant-<ver>-win-x64.exe`（~134MB） | 安装向导（NSIS，非管理员安装），卸载不删用户数据 |
| `npm run dist` | 两个都出 | |

体积大部分是 pi 的依赖（125MB）。用户选了把 pi 打进包，所以代价已经计入。

> 国内构建如果卡在下载 electron / nsis，设两个镜像：
> `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`
> `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

---

## 10. 目录速查

```
main.js                     入口：装配 + 形态 + 定时循环
preload.js                  contextBridge 桥
pi-ext/nailong.mjs          pi 扩展：注册工具 + 注册 provider
renderer/                   6 个窗口的 HTML/CSS/JS + ui.css（Liquid Glass 设计系统）
src/shared/                 纯逻辑（主进程与渲染层共用，零依赖）
  logic.js repeat.js task.js nl.js pomodoro.js stats.js
src/main/                   主进程模块（见上方进程图）
  engines/                  ★ 双内核：bridge / pi / index / pi-history / pi-agent-dir / pi-preflight
  agent/                    内置引擎：多协议适配、工具循环、权限、用量、记忆、提示词
  tools/                    54 个工具（两个内核共用同一份实现）
native/                     PowerShell：输入模拟 / UI Automation / 窗口 / 系统 / 桌面坐标 / 回收站 / 毛玻璃
test/                       node:test 测试（逻辑 / 引擎 / 工具 / 桥 / 声音）
scripts/                    语法自检、界面自检
```

## 11. 质量闸门

| 命令 | 做什么 |
| --- | --- |
| `npm run lint:syntax` | 所有 JS 过 `node --check`，并校验 HTML 引用的资源真的存在 |
| `npm test` | 154 个用例；包括真实 pi 子进程配合本地模型夹具的图像、工具结果、流式回复回路。真实服务商尚需验证 |
| `npm run audit` | 起真实 Electron，检查 36 个窗口/主题组合、23 个独立操作步骤、6 个英语标签页面、7 个模式状态；检测裁切、未样式化输入、登记翻译 key 缺失及渲染器错误；不代表所有维度的笛卡尔积 |
| `npm run smoke:pi` | 真起一次**自带** pi 内核：验证 54 个工具注册；给了接口配置就真发一句，验证流式与用量 |
| `npm run check` | 前两项 |

打包后还可以跑一次真机验证（这是唯一能抳到“只在打包后才出现”的错误的办法）：

```bash
cd dist/win-unpacked
WIDGET_AUDIT=1 ./奶蛙助手.exe    # 看 .cache/logs/app.log 里的 [pi] 与 [audit] 行
```
