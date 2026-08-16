# dsh-turn-notify 设计文档

- 日期：2026-08-14
- 状态：已批准（用户逐节确认）
- 作者：Ruiming

## 1. 背景与目标

DSH（DeepSeek Harness）运行在 Web GUI 中，用户经常在浏览器最小化/切到其他窗口时等待 agent 工作。当 agent 完成一轮、目标阻塞、对话被中断、轮次出错等**需要用户下达新指令**的时刻，用户无从感知。

目标：一个 DSH 插件，在这些时刻向操作系统（Windows 10/11）发送原生通知（Toast，失败降级托盘气泡）。

触发时机（用户已确认全部启用）：

1. 轮次完成（`turn/end: completed`，仅用户直接发起的轮次）
2. 目标阻塞 / 暂停 / 完成（`goal/change` 状态转变）
3. 对话中断 / 中止（`turn/end: aborted`）
4. 轮次出错 / 达到输出上限（`turn/end: error / max-tokens`）
5. 等待批准（`approval/asked`）

## 2. 部署策略

| 阶段 | 形态 |
|---|---|
| 试点（当前） | 项目仓库 `P:\dshTest\dsh-turn-notify`，`cordis.patch.yml` 用绝对路径引入插件 |
| 迁移 | 验证通过后拷贝插件文件至 `~/.dsh/profiles/web/turn-notify/`，patch 路径改为相对，代码零改动 |
| 发布（可选） | 功能稳定后发布至 GitHub（项目本身已是 git 仓库，`main` 分支，身份 Ruiming `<2066800241@qq.com>`） |

## 3. 事实基础（DSH 事件面）

- `session/event`（作用域事件，`{ global: true }` 监听所有会话）携带全部会话事件：
  - `turn/end: { turn, reason }`，reason.kind ∈ `completed | aborted(reason: user/parent/hook/disposed/legacy) | blocked | error(code+message) | max-tokens | interrupted`
  - `goal/change: { operation, goal: { phase: active|paused|blocked|complete, blockedReason?, ... }, roundsStarted }`
  - `approval/asked: { id, toolName, ... }`（后随 `approval/decided`）
  - `user/message` 的 `source.kind`：`user`（人类直接输入）| `plugin`（注入上下文）| `goal`（goal 续跑轮次）| `model` | `tool`
- 子代理会话的 `session.header.parentSession` 存在、`delegationDepth ≥ 1`；根会话无 `parentSession`
- 插件协议：Cordis 插件（`export const name` / `export function apply(ctx, config)`）；补丁层 `cordis.patch.yml` 的 `- insert:` 条目可插入任意插件文件
- 用户级文件放在 `~/.dsh/profiles/web/` 下可解析 `@deepseek-ai/*`（`profiles/node_modules` 回退）；纯 ESM（`.mjs`）在构建模式（`node apps/cli/lib/bin.js web`）无需 tsx 即可加载

## 4. 架构与组件

### 4.1 文件布局

```
P:\dshTest\dsh-turn-notify\          （试点；迁移时整体移至 ~/.dsh/profiles/web/turn-notify/）
├── plugin\
│   ├── index.mjs                    # Cordis 插件：事件监听 + 决策器 + 通知调度（~150 行）
│   ├── notify.ps1                   # Windows 通知脚本（WinRT Toast + 气泡回退，~45 行）
│   ├── test.mjs                     # node:test 单元测试（决策逻辑 + dryRun 调度）
│   └── smoke.ps1                    # 手动冒烟：直接弹一条测试通知
├── docs\superpowers\specs\          # 设计文档
└── README.md
```

### 4.2 数据流

```
session/event (global 监听)                goal/change ─┐
        │  turn/end ──┐                   approval/asked┘
        ▼             ▼
  ┌─────────────────────────────┐
  │ index.mjs  决策器（纯函数）   │  decide(event, ctx, config)
  │  ├─ 根会话过滤                │  → null | {kind, title, body}
  │  ├─ 事件→文案映射             │
  │  └─ 冷却去抖（普通完成）       │
  └──────────┬──────────────────┘
             ▼ (fire-and-forget)
  spawn powershell.exe -NoProfile -ExecutionPolicy Bypass notify.ps1
             │  10s 超时 / 失败降级
             ▼
  WinRT Toast（进操作中心）──失败──▶ NotifyIcon 气泡──失败──▶ ctx.logger.warn
```

### 4.3 插件协议

```js
export const name = 'turn-notify'
export function apply(ctx, config) {
  ctx.on('session/event', (session, event) => {
    const notice = decide(event, { session, config })
    if (notice) void notify(notice, config)   // 不阻塞事件分发
  }, { global: true })
}
```

- 不注入任何服务——纯监听；事件分发为 emit 模式，通知延迟不影响 agent 循环
- 每次通知 spawn 独立 PowerShell 进程（~1-2s 冷启动，可接受；不引入常驻进程池，YAGNI）

## 5. 事件映射与文案

| 事件 | 条件 | kind | 标题 | 正文 |
|---|---|---|---|---|
| `turn/end` | reason `completed` 且本轮含用户直接输入（`user/message` source.kind==='user'） | `completed` | DSH · 轮次完成 | 请查看结果或下达新指令 |
| `turn/end` | reason `blocked` | `blocked` | DSH · 目标阻塞 | 需要你的指示才能继续 |
| `turn/end` | reason `aborted`（reason.kind==='user'） | `aborted` | DSH · 对话已中断 | 你停止了当前轮次 |
| `turn/end` | reason `aborted`（其他） | `aborted` | DSH · 对话已中止 | parent/hook 取消了轮次 |
| `turn/end` | reason `error` | `error` | DSH · 轮次出错 | `code: message`（截断 120 字符） |
| `turn/end` | reason `max-tokens` | `max-tokens` | DSH · 达到输出上限 | 本轮输出被截断 |
| `turn/end` | reason `interrupted` | `interrupted` | DSH · 会话中断 | 崩溃恢复，请检查会话 |
| `goal/change` | 转变到 `blocked` | `goal-blocked` | DSH · 目标已阻塞 | `blockedReason`（截断 120） |
| `goal/change` | 转变到 `paused` | `goal-paused` | DSH · 目标已暂停 | 需要恢复或编辑目标 |
| `goal/change` | 转变到 `complete` | `goal-complete` | DSH · 目标已完成 | 请查看结果 |
| `approval/asked` | 任意 | `approval` | DSH · 等待你批准 | 操作：`toolName` |

## 6. 过滤规则（先于映射）

1. **根会话**：`session.header.parentSession` 不存在；子代理静默
2. **completed 用户驱动判定**：监听器每次只收到单个事件（无历史），故插件按会话维护 open-turn 标记：`turn/start` 时重置 `hasUserInput=false`；`user/message` 时若 `source.kind === 'user'` 置 `hasUserInput=true`；`turn/end` 时消费该标记。goal 续跑轮次（source.kind==='goal'）与注入上下文（'plugin'）不置位，天然被排除
3. **goal 转变判定**：按会话维护 `Map<sessionId, lastGoalPhase>`，仅 phase 变化时通知（`create→active`、`resume→active`、`edit`、`clear` 不通知）
4. **冷却**：`completed` 类 10s 冷却（`cooldownMs`）；`blocked/aborted/error/max-tokens/interrupted/goal-*/approval` 不过冷却
5. `approval/asked` 与 GUI 弹窗并存——默认开（用户已确认），可用 `notify.approvals: false` 关闭

## 7. 配置项

```yaml
config:
  notify:
    completed: true
    blocked: true
    aborted: true
    error: true
    maxTokens: true
    interrupted: true
    goals: true
    approvals: true
  cooldownMs: 10000        # completed 冷却
  titlePrefix: 'DSH'       # 通知标题前缀
  sound: false             # 是否播放提示音（默认静默）
  timeoutMs: 10000         # PowerShell 调用超时
  rootSessionsOnly: true
  dryRun: false            # 只打日志不 spawn（测试/调试）
```

## 8. 通知实现与错误处理

### 8.1 notify.ps1（`param(-Title, -Body, -Sound)`）

1. **主路径 WinRT Toast**：`[Windows.UI.Notifications.ToastNotificationManager]` + `ToastGeneric` 模板（标题+正文）；文本经 `[System.Security.SecurityElement]::Escape()` XML 转义防注入；`-Sound` 时带 `Notification.Default` 音效，否则 `silent="true"`；AppID 用 `dsh-turn-notify`（未注册 AUMID 时归 "PowerShell" 名下，可接受）
2. **回退路径托盘气泡**：`System.Windows.Forms.NotifyIcon.ShowBalloonTip`（6 秒后 Dispose），仅当 WinRT 抛异常时走
3. **全失败**：非零退出码 + stderr → 插件 `ctx.logger.warn`

### 8.2 index.mjs 调度健壮性

- `spawn('powershell.exe', args)` 数组传参（无 shell 拼接，无注入面）；`windowsHide: true` 不闪窗
- 通知**串行队列**（同时最多 1 个 PS 进程）；`timeoutMs` 超时 `child.kill()`
- 标题/正文剥除控制字符（含 `\0`，否则 Node spawn 抛错）；decide 全程 try/catch，监听器永不抛
- 冷却状态为内存 Map（进程重启重置，可接受）；插件 dispose 时清队列与定时器
- `dryRun: true` 只打日志不 spawn

## 9. 测试与试点验收

| 层 | 内容 | 判定 |
|---|---|---|
| 单测 | `node:test` 跑 `decide()`：各 reason、goal 转变、approval、子会话过滤、非用户驱动轮次、冷却去抖（可注入时钟） | 全部通过 |
| 调度测试 | `dryRun` 模式：队列 / 超时 / 失败日志路径（假 spawn） | 全部通过 |
| 冒烟 | `smoke.ps1` 手动弹一条 toast + 一条气泡 | 肉眼可见 |
| 试点接入 | patch 指向项目路径插件（绝对路径），重启 GUI | 插件挂载无报错 |
| 实机场景 | A. 完成：简单任务 → toast；B. 中断：运行中点停止 → toast；C. 出错：断网/错误提示 → toast；D. 批准：approval=ask 触发 `approval/asked` → toast；E. 子代理：跑 subagent 任务 → **无**通知 | 全过 |
| 冷却验证 | 快速连续发 3 条消息 → 10s 内仅 1 条 completed toast | 符合 |

## 10. 试点部署形态

插件文件留在项目仓库；`cordis.patch.yml` 用绝对路径 `P:/dshTest/dsh-turn-notify/plugin/index.mjs` 引入。验证通过后迁移：拷贝文件至 `~/.dsh/profiles/web/turn-notify/`、patch 改相对路径，**代码零改动**。
