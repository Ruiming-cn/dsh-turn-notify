# dsh-turn-notify 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 DSH 用户级 Cordis 插件：在轮次完成/目标阻塞/对话中断/出错/等待批准等需要用户下达新指令的时刻，发送 Windows 系统通知（优先 `dsh-notify.exe` 独立通知器的 WinRT Toast，失败降级托盘气泡）。

**Architecture:** 纯 ESM（`.mjs`）插件三模块分层：`decide.mjs`（纯决策逻辑，无 Node/cordis 依赖，可独立单测）→ `scheduler.mjs`（通知调度：completed 串行队列 + 关键事件直发，可注入 fake spawn 单测）→ `index.mjs`（Cordis 入口：`ctx.on('session/event', ..., { global: true })` 监听 + `apply` 返回 disposer）。通知由 `dsh-notify.exe`（C# 编译的独立可执行文件，AUMID 已注册）发出——powershell.exe 脚本宿主会被安全软件拦截；exe 缺失时回退 `notify.ps1`。试点期经 `~/.dsh/profiles/web/cordis.patch.yml` 用 `file:///` URL 引入项目内插件文件，验证后迁移全局时仅改路径。

**Tech Stack:** Node.js（≥18.13，`node:test` / `node:child_process` / ESM）、C#（csc + Windows SDK winmd 编译 dsh-notify.exe）、Windows 10/11 WinRT 通知 API、Cordis 插件协议（`@deepseek-ai/cordis`，仅运行时注入，插件自身仅依赖 Node 内置模块）。

## Global Constraints

- 插件文件全部为纯 ESM（`.mjs`），无构建步骤、无 npm 依赖、不 import 任何 `@deepseek-ai/*` 包（ctx 由 cordis 注入）——保证 src/构建模式、任意目录、未来 GitHub 发布均可用；可 import Node 内置模块（`node:url`/`node:path`/`node:fs`/`node:child_process`）
- Windows 专属：`spawn(...)` 数组传参 + `windowsHide: true`；标题/正文先剥除控制字符（含 `\0`）再入参
- **通知器（2026-08-16 实机验证修订）**：优先使用独立可执行文件 `dsh-notify.exe`（C# 编译、AUMID `dsh-turn-notify` 已注册开始菜单快捷方式、WinRT toast `duration='long'`、失败回退托盘气泡）——powershell.exe 脚本宿主会被安全软件（联想/微软电脑管家）拦截导致 toast 静默丢弃，独立 exe 不受影响。`dsh-notify.exe` 缺失时回退 `powershell.exe + notify.ps1`。scheduler 增加 `exePath` 选项；index.mjs 检测同目录 `dsh-notify.exe` 自动优先
- 事件种类/文案与规格文档一致：`completed | blocked | aborted | error | max-tokens | interrupted | goal-blocked | goal-paused | goal-complete | approval`；标题前缀 `DSH · `；正文会话标识 `会话 <id 尾 6 位> · `
- 多会话隔离：所有状态按 sessionId 键控；`completed` 走串行队列（10s 冷却/会话），关键事件（非 completed）不排队直发
- 根会话过滤：`session.header.parentSession` 存在即跳过
- 通知失败三降级：WinRT Toast → NotifyIcon 气泡 → `ctx.logger.warn`
- 文案为中文；错误消息/blockedReason 截断 120 字符
- 每次任务结束提交一次 git（仓库 `P:\dshTest\dsh-turn-notify`，身份 Ruiming `<2066800241@qq.com>`）

---

### Task 1: 通知脚本 notify.ps1 + 冒烟 smoke.ps1

**Files:**
- Create: `plugin/notify.ps1`
- Create: `plugin/smoke.ps1`

**Interfaces:**
- Produces: `notify.ps1` 参数 `-Title <string> -Body <string> [-Sound]`；退出码 0=成功，1=完全失败（stderr 有错误信息）。`smoke.ps1` 无参数，直接调用 notify.ps1 弹一条测试 toast。

- [ ] **Step 1: 写 notify.ps1**

```powershell
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Body,
  [switch]$Sound
)

$ErrorActionPreference = 'Stop'

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

function Send-Toast {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $xml = "<toast><visual><binding template='ToastGeneric'>"
  $xml += "<text>$(& Esc $Title)</text>"
  $xml += "<text>$(& Esc $Body)</text>"
  $xml += "</binding></visual>"
  if ($Sound) {
    $xml += "<audio src='ms-winsoundevent:Notification.Default'/>"
  } else {
    $xml += "<audio silent='true'/>"
  }
  $xml += '</toast>'
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('dsh-turn-notify').Show($toast)
}

function Send-Balloon {
  Add-Type -AssemblyName System.Windows.Forms
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.Visible = $true
  $icon.ShowBalloonTip(6000, $Title, $Body, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 6
  $icon.Dispose()
}

try {
  Send-Toast
  exit 0
} catch {
  try {
    Send-Balloon
    exit 0
  } catch {
    Write-Error "toast and balloon both failed: $_"
    exit 1
  }
}
```

- [ ] **Step 2: 写 smoke.ps1**

```powershell
param([switch]$Balloon)

$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\notify.ps1" -Title 'DSH 冒烟测试' -Body '这是 dsh-turn-notify 的通知测试。' -Sound
if ($Balloon) {
  & "$PSScriptRoot\notify.ps1" -Title 'DSH 气泡测试' -Body '这是托盘气泡回退路径。'
}
```

- [ ] **Step 3: 运行冒烟**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File P:\dshTest\dsh-turn-notify\plugin\smoke.ps1`
Expected: 屏幕右下角出现 toast「DSH 冒烟测试 / 这是 dsh-turn-notify 的通知测试。」（若有声音则响提示音）；exit 0。

- [ ] **Step 4: 验证回退路径**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File P:\dshTest\dsh-turn-notify\plugin\smoke.ps1 -Balloon`
Expected: 托盘区出现气泡「DSH 气泡测试」。若系统屏蔽气泡（Focus Assist），记录即可，不阻塞。

- [ ] **Step 5: 提交**

```bash
git add plugin/notify.ps1 plugin/smoke.ps1
git commit -m "feat: add Windows notification script with toast/balloon fallback"
```

---

### Task 2: 决策器 decide.mjs（TDD）

**Files:**
- Create: `plugin/decide.mjs`
- Test: `plugin/test.mjs`（本任务先写 decide 部分）

**Interfaces:**
- Produces: `normalizeConfig(raw)` → 规范化配置对象；`createDecider(config, clock = () => Date.now())` → `{ decide(event, session) }`
- `decide(event, session)` → `null` 或 `{ kind, title, body, critical }`，其中 `critical` = kind 不是 `completed`；`session` 仅用 `{ id, header: { parentSession? } }`；`event` 仅用 `{ type, data }`。全部同步、纯函数（状态存于 decider 内部 Map）。

- [ ] **Step 1: 写失败测试（decide 部分）**

在 `plugin/test.mjs` 写入（先只写本任务测试，Task 3 再追加 scheduler 部分）：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDecider } from './decide.mjs'

function session(id = 'session-0123456789abcdef') {
  return { id, header: { id } }
}

function subagentSession() {
  return { id: 'session-child00000001', header: { id: 'session-child00000001', parentSession: 'session-0123456789abcdef' } }
}

function ev(type, data) {
  return { type, data }
}

function runTurn(d, s, sourceKind = 'user', reason = { kind: 'completed' }) {
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: sourceKind } }), s)
  return d.decide(ev('turn/end', { turn: 1, reason }), s)
}

test('completed with user input notifies', () => {
  const d = createDecider({})
  const notice = runTurn(d, session())
  assert.equal(notice.kind, 'completed')
  assert.equal(notice.critical, false)
  assert.equal(notice.title, 'DSH · 轮次完成')
  assert.equal(notice.body, '会话 abcdef · 请查看结果或下达新指令')
})

test('completed without user input is silent', () => {
  const d = createDecider({})
  assert.equal(runTurn(d, session(), 'goal'), null)
  assert.equal(runTurn(d, session(), 'plugin'), null)
})

test('blocked notifies even without user input', () => {
  const d = createDecider({})
  const notice = runTurn(d, session(), 'goal', { kind: 'blocked' })
  assert.equal(notice.kind, 'blocked')
  assert.equal(notice.critical, true)
})

test('aborted by user vs by parent have different bodies', () => {
  const d = createDecider({})
  const byUser = runTurn(d, session(), 'user', { kind: 'aborted', reason: { kind: 'user' } })
  assert.equal(byUser.kind, 'aborted')
  assert.match(byUser.body, /你停止了当前轮次/)
  const byParent = runTurn(d, session(), 'user', { kind: 'aborted', reason: { kind: 'parent' } })
  assert.match(byParent.body, /parent\/hook 取消了轮次/)
})

test('error notifies with code and truncated message', () => {
  const d = createDecider({})
  const long = 'x'.repeat(300)
  const notice = runTurn(d, session(), 'user', { kind: 'error', error: { code: 'E_TEST', message: long } })
  assert.equal(notice.kind, 'error')
  assert.match(notice.body, /E_TEST: x{119}…/)
})

test('max-tokens and interrupted notify', () => {
  const d = createDecider({})
  assert.equal(runTurn(d, session(), 'user', { kind: 'max-tokens' }).kind, 'max-tokens')
  assert.equal(runTurn(d, session(), 'user', { kind: 'interrupted' }).kind, 'interrupted')
})

test('goal phase transitions notify once', () => {
  const d = createDecider({})
  const s = session()
  const block = d.decide(ev('goal/change', { operation: 'block', goal: { phase: 'blocked', blockedReason: '需要用户确认' } }), s)
  assert.equal(block.kind, 'goal-blocked')
  assert.match(block.body, /需要用户确认/)
  // 同一 phase 再发不通知（无转变）
  assert.equal(d.decide(ev('goal/change', { operation: 'edit', goal: { phase: 'blocked', blockedReason: '仍是阻塞' } }), s), null)
  assert.equal(d.decide(ev('goal/change', { operation: 'complete', goal: { phase: 'complete' } }), s).kind, 'goal-complete')
  // create/resume -> active 不通知
  assert.equal(d.decide(ev('goal/change', { operation: 'resume', goal: { phase: 'active' } }), s), null)
})

test('approval/asked notifies with toolName', () => {
  const d = createDecider({})
  const notice = d.decide(ev('approval/asked', { id: 'ask-1', toolName: 'bash' }), session())
  assert.equal(notice.kind, 'approval')
  assert.match(notice.body, /操作：bash/)
})

test('subagent sessions never notify', () => {
  const d = createDecider({})
  const s = subagentSession()
  assert.equal(runTurn(d, s, 'user', { kind: 'blocked' }), null)
  assert.equal(d.decide(ev('approval/asked', { id: 'ask-1', toolName: 'bash' }), s), null)
})

test('completed cooldown is per session with injectable clock', () => {
  let now = 1000
  const d = createDecider({ cooldownMs: 10000 }, () => now)
  const a = session('session-aaaaaaaaaaaa1111')
  const b = session('session-bbbbbbbbbbbb2222')
  assert.equal(runTurn(d, a).kind, 'completed')
  assert.equal(runTurn(d, a), null) // 冷却中
  assert.equal(runTurn(d, b).kind, 'completed') // 会话 B 不受会话 A 冷却影响
  now = 1000 + 10001
  assert.equal(runTurn(d, a).kind, 'completed') // 冷却过期
})

test('notify switches disable kinds', () => {
  const d = createDecider({ notify: { completed: false } })
  assert.equal(runTurn(d, session()), null)
})

test('showSessionTag false removes tag', () => {
  const d = createDecider({ showSessionTag: false })
  assert.equal(runTurn(d, session()).body, '请查看结果或下达新指令')
})

test('control characters are stripped from title and body', () => {
  const d = createDecider({ titlePrefix: 'DSH\u0000X' })
  const notice = runTurn(d, session())
  assert.ok(!notice.title.includes('\u0000'))
  assert.ok(!notice.body.includes('\u0000'))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test plugin/test.mjs`
Expected: FAIL（`ERR_MODULE_NOT_FOUND` / `Cannot find module './decide.mjs'`）。同时确认 Node 版本 ≥ 18.13：`node --version`。

- [ ] **Step 3: 实现 decide.mjs**

```js
// decide.mjs — 纯决策逻辑：事件 → 通知 or null。
// 无 Node/cordis 依赖，可独立单测。状态按 sessionId 键控（多会话隔离）。

const TRUNCATE = 120

export const DEFAULT_CONFIG = {
  notify: {
    completed: true,
    blocked: true,
    aborted: true,
    error: true,
    maxTokens: true,
    interrupted: true,
    goals: true,
    approvals: true,
  },
  cooldownMs: 10000,
  titlePrefix: 'DSH',
  showSessionTag: true,
  previewChars: 60,
}

export function normalizeConfig(raw = {}) {
  return {
    notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    cooldownMs: Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : DEFAULT_CONFIG.cooldownMs,
    titlePrefix: typeof raw.titlePrefix === 'string' && raw.titlePrefix !== '' ? raw.titlePrefix : DEFAULT_CONFIG.titlePrefix,
    showSessionTag: raw.showSessionTag !== false,
    rootSessionsOnly: raw.rootSessionsOnly !== false,
    previewChars: Number.isFinite(raw.previewChars) ? raw.previewChars : DEFAULT_CONFIG.previewChars,
  }
}

/** 剥除控制字符（含 NUL），防止破坏 spawn 参数；保留 \t \n \r（多行预览依赖换行）。 */
function clean(text) {
  return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim()
}

function truncate(text, max = TRUNCATE) {
  const t = clean(text)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 从消息中提取纯文本块（assistant 消息可能含 tool-call 等块）。 */
function textOf(message) {
  if (!message?.content || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

/** 关键事件 = 非 completed：不排队、不受冷却限制。 */
const CRITICAL_KINDS = new Set([
  'blocked', 'aborted', 'error', 'max-tokens', 'interrupted',
  'goal-blocked', 'goal-paused', 'goal-complete', 'approval',
])

/** kind → [标题, 正文]；正文生成器接收事件 data。 */
const MESSAGES = {
  completed: () => ['轮次完成', '请查看结果或下达新指令'],
  blocked: () => ['目标阻塞', '需要你的指示才能继续'],
  aborted: (data) => {
    const byUser = data?.reason?.reason?.kind === 'user'
    return byUser ? ['对话已中断', '你停止了当前轮次'] : ['对话已中止', 'parent/hook 取消了轮次']
  },
  error: (data) => ['轮次出错', `${data?.reason?.error?.code ?? 'UNKNOWN'}: ${truncate(data?.reason?.error?.message ?? '')}`],
  'max-tokens': () => ['达到输出上限', '本轮输出被截断'],
  interrupted: () => ['会话中断', '崩溃恢复，请检查会话'],
  'goal-blocked': (data) => ['目标已阻塞', truncate(data?.change?.goal?.blockedReason ?? '')],
  'goal-paused': () => ['目标已暂停', '需要恢复或编辑目标'],
  'goal-complete': () => ['目标已完成', '请查看结果'],
  approval: (data) => ['等待你批准', `操作：${truncate(data?.toolName ?? '未知')}`],
}

export function createDecider(config, clock = () => Date.now()) {
  const { notify, cooldownMs, titlePrefix, showSessionTag, rootSessionsOnly, previewChars } = normalizeConfig(config)
  const state = new Map() // sessionId -> { hasUserInput, lastUserText, lastAssistantText, lastGoalPhase, lastCompletedAt }

  function sessionState(sessionId) {
    let s = state.get(sessionId)
    if (!s) {
      s = {
        hasUserInput: false,
        lastUserText: undefined,
        lastAssistantText: undefined,
        lastGoalPhase: undefined,
        lastCompletedAt: -Infinity,
      }
      state.set(sessionId, s)
    }
    return s
  }

  /** 问答预览：`问：<截断> / 答：<截断>`（completed 才带答），多行置于正文前。 */
  function buildPreview(s, kind) {
    const ask = s.lastUserText ? `问：${truncate(s.lastUserText, previewChars)}` : ''
    const answer = kind === 'completed' && s.lastAssistantText ? `答：${truncate(s.lastAssistantText, previewChars)}` : ''
    const parts = [ask, answer].filter(Boolean)
    return parts.length > 0 ? `${parts.join('\n')}\n` : ''
  }

  function compose(kind, data, session, s) {
    const [title, body] = MESSAGES[kind](data)
    const tag = showSessionTag && session?.id ? `会话 ${String(session.id).slice(-6)} · ` : ''
    const preview = s ? buildPreview(s, kind) : ''
    return {
      kind,
      title: clean(`${titlePrefix} · ${title}`),
      body: clean(`${tag}${preview}${body}`),
      critical: CRITICAL_KINDS.has(kind),
    }
  }

  function goalNotice(change, session) {
    const s = sessionState(session.id)
    const phase = change?.goal?.phase
    if (phase === s.lastGoalPhase) return null // 无转变
    s.lastGoalPhase = phase
    const kind = phase === 'blocked' ? 'goal-blocked'
      : phase === 'paused' ? 'goal-paused'
        : phase === 'complete' ? 'goal-complete'
          : null
    return kind ? compose(kind, { change }, session) : null
  }

  return {
    decide(event, session) {
      if (!event || !session?.id) return null
      if (rootSessionsOnly && session.header?.parentSession) return null // 子代理静默
      const s = sessionState(session.id)
      switch (event.type) {
        case 'turn/start':
          s.hasUserInput = false
          s.lastUserText = undefined
          s.lastAssistantText = undefined
          return null
        case 'user/message': {
          const sourceKind = event.data?.source?.kind
          if (sourceKind === 'user') {
            s.hasUserInput = true
            if (s.lastUserText === undefined) s.lastUserText = textOf(event.data) // 取首个提问
          }
          return null
        }
        case 'assistant/message': {
          const text = textOf(event.data?.message)
          if (text !== '') s.lastAssistantText = text // 取最后回答
          return null
        }
        case 'turn/end': {
          const kind = event.data?.reason?.kind
          if (kind === 'completed') {
            if (!notify.completed || !s.hasUserInput) return null
            const now = clock()
            if (now - s.lastCompletedAt < cooldownMs) return null
            s.lastCompletedAt = now
            return compose('completed', {}, session, s)
          }
          if (kind === 'blocked') return notify.blocked ? compose('blocked', {}, session, s) : null
          if (kind === 'aborted') return notify.aborted ? compose('aborted', event.data, session, s) : null
          if (kind === 'error') return notify.error ? compose('error', event.data, session, s) : null
          if (kind === 'max-tokens') return notify.maxTokens ? compose('max-tokens', {}, session, s) : null
          if (kind === 'interrupted') return notify.interrupted ? compose('interrupted', {}, session, s) : null
          return null
        }
        case 'goal/change':
          return notify.goals ? goalNotice(event.data, session) : null
        case 'approval/asked':
          // goal/approval 事件不带问答预览（与 brief 契约一致）
          return notify.approvals ? compose('approval', event.data, session) : null
        default:
          return null
      }
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test plugin/test.mjs`
Expected: 13 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add plugin/decide.mjs plugin/test.mjs
git commit -m "feat: add pure decision logic with per-session state and cooldown"
```

---

### Task 3: 调度器 scheduler.mjs（TDD）

**Files:**
- Create: `plugin/scheduler.mjs`
- Test: `plugin/test.mjs`（追加 scheduler 部分）

**Interfaces:**
- Consumes: `notice = { kind, title, body, critical }`（Task 2 产出）
- Produces: `createScheduler(options, spawnFn = spawn)` → `{ push(notice), dispose() }`；`options = { psPath, timeoutMs = 10000, dryRun = false, sound = false, onLog = (level, message) => {} }`
- 语义：`push` 立即返回；`critical` 通知立即 spawn（并行，不被队列阻塞）；非 critical 进串行队列（同时最多 1 个 PS 进程）；`dryRun` 时只调 `onLog('info', ...)` 不 spawn；超时 `child.kill()`；spawn error / 非零退出码 → `onLog('warn', ...)`；`dispose()` 杀运行中进程、清队列。

- [ ] **Step 1: 写失败测试（scheduler 部分，追加到 plugin/test.mjs）**

在 `plugin/test.mjs` **末尾**追加以下代码（import 行 + fakeChild/harness 辅助 + 7 个测试；不要改动既有 14 个 decide 测试）：

```js
import { createScheduler } from './scheduler.mjs'

function fakeChild() {
  const handlers = {}
  return {
    handlers,
    killed: 0,
    on(event, cb) { handlers[event] = cb },
    kill() { this.killed += 1 },
  }
}

function harness() {
  const spawned = []
  const logs = []
  const spawnFn = (...args) => {
    const child = fakeChild()
    spawned.push({ args, child })
    return child
  }
  const scheduler = createScheduler({
    psPath: 'C:/notify.ps1',
    timeoutMs: 20,
    onLog: (level, message) => logs.push({ level, message }),
  }, spawnFn)
  return { scheduler, spawned, logs }
}

test('completed notices run serially', () => {
  const { scheduler, spawned } = harness()
  const n = { kind: 'completed', title: 't', body: 'b', critical: false }
  scheduler.push(n)
  scheduler.push(n)
  assert.equal(spawned.length, 1) // 第二个排队
  const first = spawned[0]
  assert.equal(first.args[0], 'powershell.exe')
  assert.deepEqual(first.args[1].slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
  assert.ok(first.args[1].includes('-Title'))
  first.child.handlers.close(0)
  assert.equal(spawned.length, 2) // 第一个结束后第二个才启动
})

test('critical notices spawn immediately even while queued work runs', () => {
  const { scheduler, spawned } = harness()
  scheduler.push({ kind: 'completed', title: 'a', body: 'b', critical: false })
  scheduler.push({ kind: 'blocked', title: 'c', body: 'd', critical: true })
  assert.equal(spawned.length, 2) // completed 运行中，blocked 仍立即直发
  spawned[0].child.handlers.close(0)
  assert.equal(spawned.length, 2) // 队列已空，不再 spawn
})

test('timeout kills the child', async () => {
  const { scheduler, spawned, logs } = harness()
  scheduler.push({ kind: 'completed', title: 't', body: 'b', critical: false })
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(spawned[0].child.killed, 1)
  assert.ok(logs.some((l) => l.level === 'warn' && /timed out/.test(l.message)))
})

test('spawn error and non-zero exit are logged', () => {
  const { scheduler, spawned, logs } = harness()
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  spawned[0].child.handlers.error(new Error('boom'))
  assert.ok(logs.some((l) => l.level === 'warn' && /spawn failed/.test(l.message)))
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  spawned[1].child.handlers.close(3)
  assert.ok(logs.some((l) => l.level === 'warn' && /code 3/.test(l.message)))
})

test('dryRun logs without spawning', () => {
  const logs = []
  const scheduler = createScheduler({ psPath: 'x', dryRun: true, onLog: (l, m) => logs.push(m) })
  scheduler.push({ kind: 'completed', title: 't', body: 'b', critical: false })
  assert.ok(logs.some((m) => m.includes('[dry-run] completed')))
})

test('dispose kills running child and ignores later pushes', () => {
  const { scheduler, spawned } = harness()
  scheduler.push({ kind: 'completed', title: 't', body: 'b', critical: false })
  scheduler.push({ kind: 'completed', title: 't', body: 'b', critical: false })
  scheduler.dispose()
  assert.equal(spawned[0].child.killed, 1)
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  assert.equal(spawned.length, 1) // dispose 后不再新增 spawn（含关键事件）
})

test('dispose kills inflight critical spawns', () => {
  const { scheduler, spawned } = harness()
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  assert.equal(spawned.length, 2)
  scheduler.dispose()
  assert.equal(spawned[0].child.killed, 1)
  assert.equal(spawned[1].child.killed, 1)
})

test('exePath mode spawns the notifier exe directly', () => {
  const spawned = []
  const scheduler = createScheduler({
    psPath: 'C:/notify.ps1',
    exePath: 'C:/dsh-notify.exe',
    onLog: () => {},
  }, (...args) => {
    const child = fakeChild()
    spawned.push({ args, child })
    return child
  })
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  assert.equal(spawned[0].args[0], 'C:/dsh-notify.exe')
  assert.deepEqual(spawned[0].args[1], ['-Title', 't', '-Body', 'b'])
  spawned[0].child.handlers.close(0)
})

test('exePath mode keeps -Sound flag when enabled', () => {
  const spawned = []
  const scheduler = createScheduler({
    psPath: 'C:/notify.ps1',
    exePath: 'C:/dsh-notify.exe',
    sound: true,
    onLog: () => {},
  }, (...args) => {
    const child = fakeChild()
    spawned.push({ args, child })
    return child
  })
  scheduler.push({ kind: 'blocked', title: 't', body: 'b', critical: true })
  assert.deepEqual(spawned[0].args[1], ['-Title', 't', '-Body', 'b', '-Sound'])
  spawned[0].child.handlers.close(0)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test plugin/test.mjs`
Expected: 新增 7 个测试 FAIL（`Cannot find module './scheduler.mjs'`），既有 14 个仍 PASS。

- [ ] **Step 3: 实现 scheduler.mjs**

```js
// scheduler.mjs — 通知调度：completed 串行队列（10s 冷却由 decide 负责），
// 关键事件直发不被阻塞；超时 kill；dryRun 只记日志。spawnFn 可注入以便测试。

import { spawn } from 'node:child_process'

export function createScheduler(options, spawnFn = spawn) {
  const { psPath, exePath, timeoutMs = 10000, dryRun = false, sound = false, onLog = () => {} } = options
  const queue = []
  const inflight = new Set() // 所有在途 child（含 critical 直发），dispose 时统一终止
  let running = null
  let disposed = false

  function log(level, message) {
    onLog(level, `[turn-notify] ${message}`)
  }

  function buildArgs(notice) {
    // exePath 模式：直接传 -Title/-Body（dsh-notify.exe 自身约定）；
    // 否则回退 powershell.exe -File notify.ps1。
    const prefix = exePath
      ? []
      : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath]
    return [...prefix, '-Title', notice.title, '-Body', notice.body, ...(sound ? ['-Sound'] : [])]
  }

  function run(notice) {
    if (disposed) return null
    const command = exePath ?? 'powershell.exe'
    const child = spawnFn(command, buildArgs(notice), { windowsHide: true })
    inflight.add(child)
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      inflight.delete(child)
      if (running === child) {
        running = null
        pump()
      }
    }
    const timer = setTimeout(() => {
      log('warn', `notification timed out after ${timeoutMs}ms, killing powershell`)
      child.kill()
    }, timeoutMs)
    child.on('error', (error) => {
      log('warn', `notification spawn failed: ${error.message}`)
      finish()
    })
    child.on('close', (code) => {
      if (code !== 0) log('warn', `notification exited with code ${code}`)
      finish()
    })
    return child
  }

  function pump() {
    if (disposed || running !== null || queue.length === 0) return
    running = run(queue.shift())
  }

  return {
    push(notice) {
      if (disposed) return
      if (dryRun) {
        log('info', `[dry-run] ${notice.kind}: ${notice.title} — ${notice.body}`)
        return
      }
      if (notice.critical) {
        run(notice) // 直发并行，不占串行槽位
      } else {
        queue.push(notice)
        pump()
      }
    },
    dispose() {
      disposed = true
      queue.length = 0
      for (const child of inflight) {
        try { child.kill() } catch { /* 已退出 */ }
      }
      inflight.clear()
      running = null
    },
  }
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test plugin/test.mjs`
Expected: 21 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add plugin/scheduler.mjs plugin/test.mjs
git commit -m "feat: add notification scheduler with serial queue and critical fast-path"
```

---

### Task 4: 入口 index.mjs + cordis 集成冒烟

**Files:**
- Create: `plugin/index.mjs`
- Create: `test/harness/cordis.yml`
- Create: `test/harness/logger.mjs`
- Create: `test/harness/emit.mjs`

**Interfaces:**
- Consumes: `createDecider`（Task 2）、`createScheduler`（Task 3）、`notify.ps1` 路径（同目录）
- Produces: Cordis 插件 `export const name = 'turn-notify'`；`export function apply(ctx, config)`；监听 `ctx.on('session/event', (session, event) => {...}, { global: true })`；返回 disposer `() => scheduler.dispose()`；`ctx.logger` 输出格式 `[turn-notify] ...`
- 本任务验证=语法检查 + 真实 cordis 运行时 dryRun 冒烟（用 checkout 的 `vendor/cordis/bin.js`，相对路径引用插件，事件由 emit.mjs 注入）

- [ ] **Step 1: 写 index.mjs**

```js
// index.mjs — dsh-turn-notify：Cordis 插件入口。
// 监听 session/event（global），决策后经 scheduler 发送 Windows 通知。
// 通知器优先 dsh-notify.exe（独立 exe，绕开安全软件对脚本宿主的拦截），
// 缺失时回退 notify.ps1。仅依赖 Node 内置模块与相对模块。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDecider } from './decide.mjs'
import { createScheduler } from './scheduler.mjs'

export const name = 'turn-notify'

export function apply(ctx, config = {}) {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  const psPath = join(dir, 'notify.ps1')
  const exePath = existsSync(join(dir, 'dsh-notify.exe')) ? join(dir, 'dsh-notify.exe') : undefined
  const decider = createDecider(config)
  const scheduler = createScheduler({
    psPath,
    exePath,
    timeoutMs: config.timeoutMs ?? 10000,
    dryRun: config.dryRun === true,
    sound: config.sound !== false, // 提示音默认开启（用户 2026-08-16 要求）
    onLog: (level, message) => ctx.logger?.[level]?.(message),
  })

  ctx.on('session/event', (session, event) => {
    try {
      const notice = decider.decide(event, session) // 子代理过滤/冷却/映射均在 decide 层
      if (notice !== null) scheduler.push(notice)
    } catch (error) {
      ctx.logger?.warn?.(`[turn-notify] listener failed: ${String(error)}`)
    }
  }, { global: true })

  return () => scheduler.dispose()
}
```

- [ ] **Step 2: 写 harness 三件套**

`test/harness/logger.mjs`（把 cordis logger 输出到 console，便于断言）：

```js
// harness 专用：把 logger 消息打印到 stdout。
export const name = 'harness-logger'

export function apply(ctx) {
  ctx.logger.exporter({
    colors: 0,
    export(message) {
      const parts = Array.isArray(message.content) ? message.content : [message.content]
      console.log(`[${message.level}] ${message.name}:`, ...parts)
    },
  })
}
```

`test/harness/emit.mjs`（等全部插件挂载后注入合成会话事件）：

```js
// harness 专用：向 session/event 注入一组合成事件，覆盖
// completed（含用户输入）、blocked、approval/asked 三个场景。
export const name = 'harness-emitter'

export function apply(ctx) {
  void (async () => {
    await ctx.get('loader')?.await()
    const session = { id: 'session-harness-0001', header: { id: 'session-harness-0001' } }
    const emit = (type, data) => ctx.emit('session/event', session, { type, data })
    emit('turn/start', { turn: 1 })
    emit('user/message', { source: { kind: 'user' } })
    emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    emit('turn/start', { turn: 2 })
    emit('turn/end', { turn: 2, reason: { kind: 'blocked' } })
    emit('approval/asked', { id: 'ask-1', toolName: 'bash' })
  })()
}
```

`test/harness/cordis.yml`：

```yaml
- name: './logger.mjs'
- name: '../../plugin/index.mjs'
  config:
    dryRun: true
    showSessionTag: true
    sound: false
    timeoutMs: 10000
- name: './emit.mjs'
```

- [ ] **Step 3: 语法检查**

Run: `node --check plugin/index.mjs`
Expected: 无输出、exit 0。

- [ ] **Step 4: 运行 cordis 集成冒烟**

Run（cwd 必须是 harness 目录）:

```bash
cd P:\dshTest\dsh-turn-notify\test\harness
node "C:\Users\20668\Documents\Codex\2026-08-13\https-github-com-deepseek-ai-deepseek\deepseek-harness\vendor\cordis\bin.js"
```

Expected stdout 依次包含（顺序可能因并行 mount 略有差异，内容必须齐全）：

```
[turn-notify] [dry-run] completed: DSH · 轮次完成 — 会话 s-0001 · 请查看结果或下达新指令
[turn-notify] [dry-run] blocked: DSH · 目标阻塞 — 会话 s-0001 · 需要你的指示才能继续
[turn-notify] [dry-run] approval: DSH · 等待你批准 — 会话 s-0001 · 操作：bash
```

若进程不自动退出，等待 2s 后 Ctrl+C（不视为失败）。若输出缺失/异常，检查 `node --version`（需 ≥18.13）后重跑。

- [ ] **Step 5: 提交**

```bash
git add plugin/index.mjs test/harness/
git commit -m "feat: add cordis plugin entry with integration smoke harness"
```

---

### Task 5: 试点接入 + 实机验证

**Files:**
- Modify: `C:\Users\20668\.dsh\profiles\web\cordis.patch.yml`（追加一个 insert 条目）
- Modify: `README.md`（回填"接入方式"章节）

**Interfaces:**
- Consumes: 前 4 个任务的产出；DSH Web GUI（`http://127.0.0.1:3080`）
- Produces: 实机验证记录（场景 A-E + 冷却 + 多会话），README 接入文档

- [ ] **Step 1: patch 追加插件条目**

在 `C:\Users\20668\.dsh\profiles\web\cordis.patch.yml` 末尾追加：

```yaml
    - id: turn-notify
      name: "file:///P:/dshTest/dsh-turn-notify/plugin/index.mjs"
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
        cooldownMs: 10000
        titlePrefix: 'DSH'
        showSessionTag: true
        sound: false
        timeoutMs: 10000
        rootSessionsOnly: true
```

注意：`name` 必须用 `file:///` URL（Node ESM 不接受盘符裸路径，已实测）。若启动报 `ERR_UNKNOWN_SCHEME`，改用正斜杠形式 `file:///P:/dshTest/dsh-turn-notify/plugin/index.mjs` 并核对盘符大小写。

- [ ] **Step 2: 重启 GUI 并确认插件挂载**

Run: 关闭现有 `http://127.0.0.1:3080` 对应进程（任务管理器/启动器脚本），重新运行 `C:\Users\20668\.dsh\launch-dsh-gui.ps1`（或直接 `node apps/cli/lib/bin.js web`，workdir=checkout）。
Expected: GUI 恢复；控制台/日志无 `turn-notify` 相关报错；`plugin(s) failed to load` 未出现。

- [ ] **Step 3: 实机场景验证（手动清单，每项记录结果）**

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| A | 轮次完成 | GUI 发一条普通消息（如"你好"），等回复完成 | toast「DSH · 轮次完成」 |
| B | 目标阻塞 | 对话中把 agent 带入需要你决策的阻塞点（如依赖缺失的请求），或临时用 `blocked` 场景 | toast「DSH · 目标阻塞」 |
| C | 对话中断 | 长任务运行中点"停止" | toast「DSH · 对话已中断」 |
| D | 出错 | 触发一次工具错误（如请求不存在的文件路径） | toast「DSH · 轮次出错」含错误码 |
| E | 等待批准 | 设置 approval=ask 后执行需批准的写操作 | toast「DSH · 等待你批准」含 toolName |
| F | 子代理静默 | 让 agent 派一个 subagent 干活 | **无** toast |
| G | 冷却 | 快速连发 3 条短消息 | 10s 内仅 1 条 completed toast |
| H | 多会话 | 开两个会话（若 GUI 支持）：会话 1 长任务完成的同时让会话 2 触发一次关键事件（如中断） | 关键事件 toast 不被会话 1 的排队通知阻塞；两条正文含各自会话标识（`会话 xxxxxx`） |

若某场景无 toast：检查 `notify.ps1` 直接运行是否成功（Task 1 冒烟）；确认事件确实触发（GUI 会话轨迹里看 turn/end 原因）；确认 Focus Assist 未抑制。

- [ ] **Step 4: 回填 README 接入章节**

将 `README.md` 中「## 接入方式（试点）」替换为实际内容（patch 条目 + file:/// 说明 + 迁移提示），并更新功能清单为实测结果。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document pilot integration steps and verification results"
```

---

### Task 6: dsh-notify.exe 独立通知器集成（2026-08-16 实机验证新增）

**背景**：Task 5 实机验证发现 powershell.exe 发出的 toast 被安全软件（联想/微软电脑管家）静默拦截（系统通知注册表无记录、Get-StartApps 不认 AUMID）。C# 编译的独立 exe 已实测可正常显示 toast。本任务把 exe 集成进插件，并保留 PS 回退。

**Files:**
- Create: `plugin/dsh-notify.cs`（C# 源码，含完整代码）
- Create: `plugin/dsh-notify.exe`（编译产物，提交入库，使仓库自包含）
- Modify: `plugin/scheduler.mjs`（已按本任务要求更新于 Task 3 代码块：`exePath` 选项 + buildArgs 双模式）
- Modify: `plugin/test.mjs`（追加 2 个 exe 模式测试，代码见 Task 3 测试块）
- Modify: `plugin/index.mjs`（已按本任务要求更新于 Task 4 代码块：existsSync 检测 exe 优先）

**Interfaces:**
- Consumes: `createScheduler` 的 `exePath` 选项（Task 3 已更新）
- Produces: `dsh-notify.exe` 参数契约 `-Title <string> -Body <string> [-Sound]`；退出码 0=成功（toast 或气泡），1=完全失败（stderr 有错误），2=参数错误

- [ ] **Step 1: 写 dsh-notify.cs**

```csharp
// dsh-notify.exe - standalone Windows notifier for dsh-turn-notify.
// WinRT toast via AUMID "dsh-turn-notify" (start-menu shortcut registered),
// falls back to tray balloon, then exits non-zero. No PowerShell involved.
// Build: csc /nologo /nostdlib /target:exe /out:dsh-notify.exe
//   /r:mscorlib.dll /r:System.dll /r:System.Core.dll
//   /r:"<GAC System.Runtime.dll>"
//   /r:System.Windows.Forms.dll /r:System.Drawing.dll
//   /r:System.Runtime.WindowsRuntime.dll
//   /r:"C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.26100.0\Windows.winmd"
//   dsh-notify.cs
using System;
using System.Windows.Forms;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

class DshNotify
{
    [STAThread]
    static int Main(string[] args)
    {
        string title = "", body = "";
        bool sound = false;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "-Title": if (i + 1 < args.Length) title = args[++i]; break;
                case "-Body": if (i + 1 < args.Length) body = args[++i]; break;
                case "-Sound": sound = true; break;
            }
        }
        if (title.Length == 0 || body.Length == 0)
        {
            Console.Error.WriteLine("usage: dsh-notify.exe -Title <title> -Body <body> [-Sound]");
            return 2;
        }
        try
        {
            SendToast(title, body, sound);
            return 0;
        }
        catch (Exception e1)
        {
            try
            {
                SendBalloon(title, body);
                return 0;
            }
            catch (Exception e2)
            {
                Console.Error.WriteLine("toast and balloon failed: " + e1.Message + "; " + e2.Message);
                return 1;
            }
        }
    }

    static void SendToast(string title, string body, bool sound)
    {
        string xml = "<toast duration='long'><visual><binding template='ToastGeneric'>"
            + "<text>" + Escape(title) + "</text>"
            + "<text>" + Escape(body) + "</text>"
            + "</binding></visual>"
            + (sound ? "<audio src='ms-winsoundevent:Notification.Default'/>" : "<audio silent='true'/>")
            + "</toast>";
        XmlDocument doc = new XmlDocument();
        doc.LoadXml(xml);
        ToastNotification toast = new ToastNotification(doc);
        ToastNotificationManager.CreateToastNotifier("dsh-turn-notify").Show(toast);
    }

    static string Escape(string s)
    {
        return System.Security.SecurityElement.Escape(s);
    }

    static void SendBalloon(string title, string body)
    {
        NotifyIcon icon = new NotifyIcon();
        icon.Icon = System.Drawing.SystemIcons.Information;
        icon.Visible = true;
        icon.ShowBalloonTip(8000, title, body, ToolTipIcon.Info);
        System.Threading.Thread.Sleep(8000);
        icon.Dispose();
    }
}
```

- [ ] **Step 2: 编译 dsh-notify.exe**

Run（PowerShell，workdir 任意；GAC System.Runtime 路径以实际为准）：

```powershell
$winmd = "C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.26100.0\Windows.winmd"
$sysruntime = "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Runtime.dll"
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /nostdlib /target:exe /out:"P:\dshTest\dsh-turn-notify\plugin\dsh-notify.exe" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:"$sysruntime" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Runtime.WindowsRuntime.dll /r:"$winmd" "P:\dshTest\dsh-turn-notify\plugin\dsh-notify.cs"
```

Expected: csc exit 0，`plugin/dsh-notify.exe` 生成（约 5.6KB）。

- [ ] **Step 3: 运行通知器冒烟**

Run: `& "P:\dshTest\dsh-turn-notify\plugin\dsh-notify.exe" -Title "冒烟" -Body "dsh-notify.exe 冒烟测试"`
Expected: exit 0；toast 在屏幕右下角显示（duration=long，约 20 秒；如安全软件询问请点信任）。exit 非 0 时检查 stderr。

- [ ] **Step 4: 更新 scheduler/test/index 并全量测试**

`plugin/scheduler.mjs`、`plugin/test.mjs`（追加 2 个 exe 测试）、`plugin/index.mjs` 已按本任务要求更新于 Task 3/4 代码块——按 Task 3 Step 3、Task 3 Step 1（新增 2 个测试）、Task 4 Step 1 的最终代码更新对应文件。

Run: `node --test plugin/test.mjs`
Expected: 23 个测试全部 PASS（14 decide + 9 scheduler）。

- [ ] **Step 5: 提交**

```bash
git add plugin/dsh-notify.cs plugin/dsh-notify.exe plugin/scheduler.mjs plugin/test.mjs plugin/index.mjs
git commit -m "feat: integrate dsh-notify.exe notifier with powershell fallback"
```

- [ ] **Step 6: 确认 AUMID 快捷方式指向 exe**

Run（PowerShell）:

```powershell
$lnk = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\dsh-turn-notify.lnk"
```

Expected: 快捷方式存在且目标为 `P:\dshTest\dsh-turn-notify\plugin\dsh-notify.exe`、AppUserModelID 为 `dsh-turn-notify`（若仍指向 powershell.exe，用调度方提供的 Lnk2.Update 重建——调度方已在本任务前完成，验证即可）。

---

### Task 7: 问答内容预览 + 提示音默认开启（2026-08-16 用户新需求）

**需求**：① 通知带提示音（默认开启，可配置关闭）；② 弹窗正文展示本轮**提问内容**与**回答内容**（各固定字数截断，默认 60 字，可配置）。

**Files:**
- Modify: `plugin/decide.mjs`（已按本任务要求更新于 Task 2 代码块：`previewChars` 配置、`textOf` 提取、`buildPreview` 组装、user/message 记首个提问、assistant/message 记最后回答、turn/start 重置、compose 带预览）
- Modify: `plugin/index.mjs`（已按本任务要求更新于 Task 4 代码块：`sound: config.sound !== false` 默认开）
- Modify: `plugin/test.mjs`（追加预览相关测试，见下）

**Interfaces:**
- Consumes: `createDecider` 现有接口（`decide(event, session)` → notice）
- Produces: notice.body 新格式：`会话 <id尾6> · 问：<截断提问>\n答：<截断回答>\n<正文>`（completed 含答；其他 turn/end 类事件含问不含答；goal/approval 事件无预览）；配置 `previewChars`（默认 60）

- [ ] **Step 1: 追加测试（追加到 plugin/test.mjs 末尾）**

```js
test('completed body includes truncated question and answer preview', () => {
  const d = createDecider({ previewChars: 20 })
  const s = session()
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '请帮我写一份财务分析报告，包含现金流、负债率与营收增长趋势' }] }), s)
  d.decide(ev('assistant/message', { message: { content: [{ type: 'text', text: '好的，以下是财务分析报告正文，包含三大报表核心指标与趋势图说明……' }] } }), s)
  const notice = d.decide(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), s)
  // previewChars=20：truncate 取前 19 字符 + '…'（提问第 19 字符是顿号"、"："请帮我写一份财务分析报告，包含现金流、"；回答："好的，以下是财务分析报告正文，包含三大"）
  assert.match(notice.body, /^会话 abcdef · 问：请帮我写一份财务分析报告，包含现金流、…\n答：好的，以下是财务分析报告正文，包含三大…\n请查看结果或下达新指令$/)
  assert.ok(!notice.body.includes('负债率'))
  assert.ok(!notice.body.includes('趋势图说明'))
})

test('assistant preview takes the last assistant message', () => {
  const d = createDecider({ previewChars: 50 })
  const s = session()
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '问1' }] }), s)
  d.decide(ev('assistant/message', { message: { content: [{ type: 'text', text: '中间回复' }] } }), s)
  d.decide(ev('assistant/message', { message: { content: [{ type: 'text', text: '最终回复' }] } }), s)
  const notice = d.decide(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), s)
  assert.match(notice.body, /答：最终回复/)
  assert.ok(!notice.body.includes('中间回复'))
})

test('blocked notice includes question but not answer', () => {
  const d = createDecider({})
  const s = session()
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我做个决策' }] }), s)
  d.decide(ev('assistant/message', { message: { content: [{ type: 'text', text: '部分回复' }] } }), s)
  const notice = d.decide(ev('turn/end', { turn: 1, reason: { kind: 'blocked' } }), s)
  assert.match(notice.body, /问：帮我做个决策/)
  assert.ok(!notice.body.includes('答：'))
})

test('goal-source turns record no question preview', () => {
  const d = createDecider({})
  const s = session()
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: 'goal', goalId: 'g1', revision: 1, round: 1 }, content: [{ type: 'text', text: '目标续跑' }] }), s)
  const notice = d.decide(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), s)
  assert.equal(notice, null) // goal 源不置 hasUserInput
})

test('tool-call blocks are excluded from preview text', () => {
  const d = createDecider({})
  const s = session()
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '只算文本' }] }), s)
  d.decide(ev('assistant/message', { message: { content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }, { type: 'text', text: '结果文本' }] } }), s)
  const notice = d.decide(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), s)
  assert.match(notice.body, /答：结果文本/)
  assert.ok(!notice.body.includes('bash'))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test plugin/test.mjs`
Expected: 新增 5 个测试 FAIL（预览字段缺失），既有 23 个仍 PASS。

- [ ] **Step 3: 更新 decide.mjs 与 index.mjs**

按 Task 2 代码块（`previewChars`/`textOf`/`buildPreview`/状态记录/compose 带预览）与 Task 4 代码块（`sound: config.sound !== false`）更新 `plugin/decide.mjs` 与 `plugin/index.mjs`。

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test plugin/test.mjs`
Expected: 28 个测试全部 PASS（14 decide + 9 scheduler + 5 preview）。

- [ ] **Step 5: 提交**

```bash
git add plugin/decide.mjs plugin/index.mjs plugin/test.mjs
git commit -m "feat: show question/answer preview in notifications, sound on by default"
```

- [ ] **Step 6: 冒烟验证（弹窗内容与提示音）**

Run: `& "P:\dshTest\dsh-turn-notify\plugin\dsh-notify.exe" -Title "DSH · 轮次完成" -Body "会话 abcdef · 问：请帮我写一份财务分析报告…`n答：好的，以下是财务分析报告正文…`n请查看结果或下达新指令" -Sound`
Expected: exit 0；toast 显示多行正文（问/答预览）且带提示音（用户确认）。

---

## 后续（不在本计划范围）

- 迁移全局：拷贝 `plugin/` 至 `~/.dsh/profiles/web/turn-notify/`，patch 改 `name: "./turn-notify/index.mjs"`，删除本计划追加的 file:/// 条目（新旧条目并存会双弹通知）
- GitHub 发布：补充 LICENSE、CHANGELOG、示例截图；README 补充安装/配置说明
- 可选增强：`agent/error`（turn 外错误）监听、通知点击跳转 GUI（需注册 AUMID）、声音开关按事件类型细分

