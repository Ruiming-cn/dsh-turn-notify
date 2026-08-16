# dsh-turn-notify 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 DSH 用户级 Cordis 插件：在轮次完成/目标阻塞/对话中断/出错/等待批准等需要用户下达新指令的时刻，通过 PowerShell 发送 Windows 系统通知（WinRT Toast，失败降级托盘气泡）。

**Architecture:** 纯 ESM（`.mjs`）插件三模块分层：`decide.mjs`（纯决策逻辑，无 Node/cordis 依赖，可独立单测）→ `scheduler.mjs`（通知调度：completed 串行队列 + 关键事件直发，可注入 fake spawn 单测）→ `index.mjs`（Cordis 入口：`ctx.on('session/event', ..., { global: true })` 监听 + `apply` 返回 disposer）。`notify.ps1` 负责实际弹窗。试点期经 `~/.dsh/profiles/web/cordis.patch.yml` 用 `file:///` URL 引入项目内插件文件，验证后迁移全局时仅改路径。

**Tech Stack:** Node.js（≥18.13，`node:test` / `node:child_process` / ESM）、Windows PowerShell 5.1（`powershell.exe`）、Windows 10/11 WinRT 通知 API、Cordis 插件协议（`@deepseek-ai/cordis`，仅运行时注入，插件自身零外部依赖）。

## Global Constraints

- 插件文件全部为纯 ESM（`.mjs`），无构建步骤、无 npm 依赖、不 import 任何 `@deepseek-ai/*` 包（ctx 由 cordis 注入）——保证 src/构建模式、任意目录、未来 GitHub 发布均可用
- Windows 专属：`spawn('powershell.exe', args)` 数组传参 + `windowsHide: true`；标题/正文先剥除控制字符（含 `\0`）再入参
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
}

export function normalizeConfig(raw = {}) {
  return {
    notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    cooldownMs: Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : DEFAULT_CONFIG.cooldownMs,
    titlePrefix: typeof raw.titlePrefix === 'string' && raw.titlePrefix !== '' ? raw.titlePrefix : DEFAULT_CONFIG.titlePrefix,
    showSessionTag: raw.showSessionTag !== false,
  }
}

/** 剥除控制字符（含 NUL），防止破坏 spawn 参数。 */
function clean(text) {
  return String(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
}

function truncate(text, max = TRUNCATE) {
  const t = clean(text)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
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
  const { notify, cooldownMs, titlePrefix, showSessionTag } = normalizeConfig(config)
  const state = new Map() // sessionId -> { hasUserInput, lastGoalPhase, lastCompletedAt }

  function sessionState(sessionId) {
    let s = state.get(sessionId)
    if (!s) {
      s = { hasUserInput: false, lastGoalPhase: undefined, lastCompletedAt: 0 }
      state.set(sessionId, s)
    }
    return s
  }

  function compose(kind, data, session) {
    const [title, body] = MESSAGES[kind](data)
    const tag = showSessionTag && session?.id ? `会话 ${String(session.id).slice(-6)} · ` : ''
    return {
      kind,
      title: clean(`${titlePrefix} · ${title}`),
      body: clean(`${tag}${body}`),
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
      const s = sessionState(session.id)
      switch (event.type) {
        case 'turn/start':
          s.hasUserInput = false
          return null
        case 'user/message':
          if (event.data?.source?.kind === 'user') s.hasUserInput = true
          return null
        case 'turn/end': {
          const kind = event.data?.reason?.kind
          if (kind === 'completed') {
            if (!notify.completed || !s.hasUserInput) return null
            const now = clock()
            if (now - s.lastCompletedAt < cooldownMs) return null
            s.lastCompletedAt = now
            return compose('completed', {}, session)
          }
          if (kind === 'blocked') return notify.blocked ? compose('blocked', {}, session) : null
          if (kind === 'aborted') return notify.aborted ? compose('aborted', event.data, session) : null
          if (kind === 'error') return notify.error ? compose('error', event.data, session) : null
          if (kind === 'max-tokens') return notify.maxTokens ? compose('max-tokens', {}, session) : null
          if (kind === 'interrupted') return notify.interrupted ? compose('interrupted', {}, session) : null
          return null
        }
        case 'goal/change':
          return notify.goals ? goalNotice(event.data, session) : null
        case 'approval/asked':
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
Expected: 14 个测试全部 PASS。

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
  assert.equal(spawned.length, 2) // dispose 后不再新增 spawn
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test plugin/test.mjs`
Expected: 新增 6 个测试 FAIL（`Cannot find module './scheduler.mjs'`），既有 14 个仍 PASS。

- [ ] **Step 3: 实现 scheduler.mjs**

```js
// scheduler.mjs — 通知调度：completed 串行队列（10s 冷却由 decide 负责），
// 关键事件直发不被阻塞；超时 kill；dryRun 只记日志。spawnFn 可注入以便测试。

import { spawn } from 'node:child_process'

export function createScheduler(options, spawnFn = spawn) {
  const { psPath, timeoutMs = 10000, dryRun = false, sound = false, onLog = () => {} } = options
  const queue = []
  let running = null
  let disposed = false

  function log(level, message) {
    onLog(level, `[turn-notify] ${message}`)
  }

  function buildArgs(notice) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath, '-Title', notice.title, '-Body', notice.body]
    if (sound) args.push('-Sound')
    return args
  }

  function run(notice) {
    if (disposed) return null
    const child = spawnFn('powershell.exe', buildArgs(notice), { windowsHide: true })
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
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
      if (running !== null) {
        try { running.kill() } catch { /* 已退出 */ }
        running = null
      }
    },
  }
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test plugin/test.mjs`
Expected: 20 个测试全部 PASS。

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
// 零外部依赖：ctx 由 cordis 注入；notify.ps1 与插件同目录。

import { fileURLToPath } from 'node:url'
import { createDecider } from './decide.mjs'
import { createScheduler } from './scheduler.mjs'

export const name = 'turn-notify'

export function apply(ctx, config = {}) {
  const psPath = fileURLToPath(new URL('./notify.ps1', import.meta.url))
  const decider = createDecider(config)
  const scheduler = createScheduler({
    psPath,
    timeoutMs: config.timeoutMs ?? 10000,
    dryRun: config.dryRun === true,
    sound: config.sound === true,
    onLog: (level, message) => ctx.logger?.[level]?.(message),
  })

  ctx.on('session/event', (session, event) => {
    try {
      if (config.rootSessionsOnly !== false && session.header?.parentSession) return
      const notice = decider.decide(event, session)
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
[turn-notify] [dry-run] completed: DSH · 轮次完成 — 会话 r-0001 · 请查看结果或下达新指令
[turn-notify] [dry-run] blocked: DSH · 目标阻塞 — 会话 r-0001 · 需要你的指示才能继续
[turn-notify] [dry-run] approval: DSH · 等待你批准 — 会话 r-0001 · 操作：bash
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

## 后续（不在本计划范围）

- 迁移全局：拷贝 `plugin/` 至 `~/.dsh/profiles/web/turn-notify/`，patch 改 `name: "./turn-notify/index.mjs"`，删除本计划追加的 file:/// 条目（新旧条目并存会双弹通知）
- GitHub 发布：补充 LICENSE、CHANGELOG、示例截图；README 补充安装/配置说明
- 可选增强：`agent/error`（turn 外错误）监听、通知点击跳转 GUI（需注册 AUMID）、声音开关按事件类型细分
