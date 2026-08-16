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
