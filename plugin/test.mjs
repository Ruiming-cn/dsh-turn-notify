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
  assert.equal(notice.body, '会话 abcdef\n请查看结果或下达新指令')
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

test('goal paused transition notifies', () => {
  const d = createDecider({})
  const s = session()
  const pause = d.decide(ev('goal/change', { operation: 'pause', goal: { phase: 'paused' } }), s)
  assert.equal(pause.kind, 'goal-paused')
  assert.equal(pause.critical, true)
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

test('completed body includes truncated question and answer preview', () => {
  const d = createDecider({ previewChars: 20 })
  const s = session()
  d.decide(ev('turn/start', { turn: 1 }), s)
  d.decide(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '请帮我写一份财务分析报告，包含现金流、负债率与营收增长趋势' }] }), s)
  d.decide(ev('assistant/message', { message: { content: [{ type: 'text', text: '好的，以下是财务分析报告正文，包含三大报表核心指标与趋势图说明……' }] } }), s)
  const notice = d.decide(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), s)
  // previewChars=20：truncate 取前 19 字符 + '…'（提问第 19 字符是顿号"、"："请帮我写一份财务分析报告，包含现金流、"；回答："好的，以下是财务分析报告正文，包含三大"）
  assert.match(notice.body, /^会话 abcdef\n问：请帮我写一份财务分析报告，包含现金流、…\n答：好的，以下是财务分析报告正文，包含三大…\n请查看结果或下达新指令$/)
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
