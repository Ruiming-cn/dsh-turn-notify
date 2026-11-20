import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDecider, type EventLike, type SessionLike } from '../src/decide.ts'

const session: SessionLike = { id: 'session-1', header: { cwd: 'D:\\work' } }
const subagent: SessionLike = { id: 'session-2', header: { origin: 'subagent' } }

/** One event with optional data. */
function event(type: string, data?: unknown): EventLike {
  return data === undefined ? { type } : { type, data }
}

/** A `turn/end` event carrying one reason. */
function turnEnd(reason: unknown): EventLike {
  return event('turn/end', { turn: 1, reason })
}

/** An `ask_user_question` tool call with the given raw arguments. */
function askCall(argumentsJson: string): EventLike {
  return event('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'ask_user_question', arguments: argumentsJson })
}

/** A direct human prompt. */
const humanPrompt = event('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] })

test('an ask_user_question call becomes a question notice with the first question', () => {
  const decider = createDecider()
  const notice = decider.decide(
    askCall(JSON.stringify({ questions: [{ header: 'pick', question: 'Which file?' }, { question: 'Second?' }] })),
    session,
  )
  assert.deepEqual(notice, { kind: 'question', group: 'needsInput', detail: 'Which file?' })
})

test('unreadable tool arguments still produce a question notice without detail', () => {
  for (const argumentsJson of ['{not json', '{}']) {
    const decider = createDecider()
    assert.deepEqual(decider.decide(askCall(argumentsJson), session), { kind: 'question', group: 'needsInput', detail: '' })
  }
})

test('a plan review call becomes a plan notice', () => {
  const decider = createDecider()
  const notice = decider.decide(event('tool/call', { name: 'exit_plan_mode', arguments: '{}' }), session)
  assert.deepEqual(notice, { kind: 'plan', group: 'needsInput', detail: '' })
})

test('other tool calls are ignored', () => {
  const decider = createDecider()
  assert.equal(decider.decide(event('tool/call', { name: 'bash', arguments: '{}' }), session), null)
})

test('an approval keeps the tool and the reason apart', () => {
  const decider = createDecider()
  const notice = decider.decide(event('approval/asked', { id: 'a1', toolName: 'Bash', reason: 'installs packages' }), session)
  assert.deepEqual(notice, { kind: 'approval', group: 'needsInput', detail: 'Bash', hint: 'installs packages' })
})

test('an approval without tool or reason is dropped', () => {
  const decider = createDecider()
  assert.equal(decider.decide(event('approval/asked', { id: 'a1' }), session), null)
})

test('a turn nobody asked for does not notify on completion', () => {
  const decider = createDecider()
  decider.decide(event('turn/start', { turn: 1 }), session)
  decider.decide(event('user/message', { role: 'user', source: { kind: 'agent' }, content: [] }), session)
  assert.equal(decider.decide(turnEnd({ kind: 'completed' }), session), null)
})

test('a turn the human asked for notifies on completion with the answer preview', () => {
  const decider = createDecider()
  decider.decide(event('turn/start', { turn: 1 }), session)
  decider.decide(humanPrompt, session)
  decider.decide(event('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'Here is the file.' }] } }), session)
  assert.deepEqual(decider.decide(turnEnd({ kind: 'completed' }), session), {
    kind: 'completed',
    group: 'turnCompleted',
    detail: 'Here is the file.',
  })
})

test('turn/start clears the previous turn state', () => {
  const decider = createDecider()
  decider.decide(event('turn/start', { turn: 1 }), session)
  decider.decide(humanPrompt, session)
  decider.decide(event('turn/start', { turn: 2 }), session)
  assert.equal(decider.decide(turnEnd({ kind: 'completed' }), session), null)
})

test('an error reason carries its code and message', () => {
  const decider = createDecider()
  const notice = decider.decide(turnEnd({ kind: 'error', error: { code: 'RATE_LIMIT', message: 'slow down' } }), session)
  assert.deepEqual(notice, { kind: 'error', group: 'turnProblems', detail: 'RATE_LIMIT: slow down' })
})

test('an error without a message reports only its code', () => {
  const cases: Array<[unknown, string]> = [
    [{ kind: 'error', error: { code: 'ABORTED' } }, 'ABORTED'],
    [{ kind: 'error' }, 'UNKNOWN'],
  ]
  for (const [reason, detail] of cases) {
    const decider = createDecider()
    assert.deepEqual(decider.decide(turnEnd(reason), session), { kind: 'error', group: 'turnProblems', detail })
  }
})

test('problem reasons map to their own kinds', () => {
  const decider = createDecider()
  const kinds = [
    ['blocked', 'blocked'],
    ['max-tokens', 'max-tokens'],
    ['interrupted', 'interrupted'],
  ] as const
  for (const [reason, kind] of kinds) {
    assert.equal(decider.decide(turnEnd({ kind: reason }), session)?.kind, kind)
  }
})

test('an abort distinguishes the human from a parent or hook', () => {
  const causes: Array<[unknown, string]> = [
    [{ kind: 'user' }, 'aborted-user'],
    [{ kind: 'parent' }, 'aborted-other'],
    [{ kind: 'hook', reason: 'stop' }, 'aborted-other'],
  ]
  for (const [cause, kind] of causes) {
    const decider = createDecider()
    assert.equal(decider.decide(turnEnd({ kind: 'aborted', reason: cause }), session)?.kind, kind)
  }
})

test('forked and unknown turn ends are ignored', () => {
  const decider = createDecider()
  assert.equal(decider.decide(turnEnd({ kind: 'forked' }), session), null)
  assert.equal(decider.decide(turnEnd({ kind: 'something-new' }), session), null)
  assert.equal(decider.decide(turnEnd({}), session), null)
})

test('a subagent session never notifies', () => {
  const decider = createDecider()
  decider.decide(event('turn/start', { turn: 1 }), subagent)
  decider.decide(humanPrompt, subagent)
  assert.equal(decider.decide(turnEnd({ kind: 'completed' }), subagent), null)
  assert.equal(decider.decide(askCall(JSON.stringify({ questions: [{ question: 'Why?' }] })), subagent), null)
  assert.equal(decider.decide(event('approval/asked', { toolName: 'Bash' }), subagent), null)
})

test('the same kind collapses inside the dedupe window and returns afterwards', () => {
  let clock = 0
  const decider = createDecider({ now: () => clock })
  const call = askCall(JSON.stringify({ questions: [{ question: 'Which file?' }] }))
  assert.notEqual(decider.decide(call, session), null)
  assert.equal(decider.decide(call, session), null)
  clock = 1999
  assert.equal(decider.decide(call, session), null)
  clock = 2000
  assert.notEqual(decider.decide(call, session), null)
})

test('different kinds do not consume each other’s window', () => {
  let clock = 0
  const decider = createDecider({ now: () => clock })
  assert.notEqual(decider.decide(event('approval/asked', { toolName: 'Bash' }), session), null)
  assert.notEqual(decider.decide(event('tool/call', { name: 'exit_plan_mode' }), session), null)
  clock = 10
  assert.notEqual(decider.decide(event('turn/end', { reason: { kind: 'blocked' } }), session), null)
})

test('forget releases the per-session state', () => {
  const decider = createDecider()
  decider.decide(event('turn/start', { turn: 1 }), session)
  decider.decide(humanPrompt, session)
  decider.forget(session.id)
  assert.equal(decider.decide(turnEnd({ kind: 'completed' }), session), null)
})

test('many sessions stay bounded and keep working', () => {
  const decider = createDecider()
  for (let index = 0; index < 300; index += 1) {
    decider.decide(event('turn/start', { turn: 1 }), { id: `s-${index}` })
  }
  assert.notEqual(decider.decide(event('approval/asked', { toolName: 'Bash' }), session), null)
})

test('malformed events are ignored rather than thrown on', () => {
  const decider = createDecider()
  assert.equal(decider.decide(undefined, session), null)
  assert.equal(decider.decide({ type: '' }, session), null)
  assert.equal(decider.decide(event('tool/call'), session), null)
  assert.equal(decider.decide(event('assistant/message', { message: { content: 'nope' } }), session), null)
  assert.equal(decider.decide(event('approval/asked', 'nope'), session), null)
  assert.equal(decider.decide(event('user/message', { source: undefined }), session), null)
})
