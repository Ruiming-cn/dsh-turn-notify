import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { createNotifier, type ChildLike, type LogLevel, type SpawnFn } from '../src/notify.ts'

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
  readonly options: unknown
}

/** A spawnable child that records listeners and can settle on demand. */
function childHarness(autoClose: boolean): {
  readonly child: ChildLike
  readonly killCalls: () => number
  emit(event: 'error' | 'close', value: unknown): void
} {
  const listeners = new Map<string, Array<(value: unknown) => void>>()
  let kills = 0
  const child = {
    on(event: string, listener: (value: unknown) => void) {
      const current = listeners.get(event) ?? []
      current.push(listener)
      listeners.set(event, current)
      return child
    },
    kill() {
      kills += 1
      return true
    },
  } as unknown as ChildLike
  const emit = (event: 'error' | 'close', value: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(value)
  }
  if (autoClose) queueMicrotask(() => emit('close', 0))
  return { child, killCalls: () => kills, emit }
}

/** A spawn function plus the calls it received. */
function spawnRecorder(child: ChildLike): { readonly calls: SpawnCall[]; readonly spawn: SpawnFn } {
  const calls: SpawnCall[] = []
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options })
    return child
  }
  return { calls, spawn }
}

test('a push starts powershell with the script and the toast text', () => {
  const harness = childHarness(true)
  const { calls, spawn } = spawnRecorder(harness.child)
  const logs: string[] = []
  const notifier = createNotifier({
    scriptPath: 'C:\\p\\notify.ps1',
    sound: () => true,
    log: (level: LogLevel, message: string) => logs.push(`${level}:${message}`),
    spawnFn: spawn,
  })

  notifier.push({ title: 'DSH · Turn completed', body: 'work\nA: done' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.command, 'powershell.exe')
  assert.deepEqual(calls[0]?.args, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\p\\notify.ps1',
    '-Title',
    'DSH · Turn completed',
    '-Body',
    'work\nA: done',
    '-Sound',
  ])
  assert.deepEqual(calls[0]?.options, { windowsHide: true, stdio: 'ignore' })
  assert.deepEqual(logs, [])
})

test('the sound switch is read at send time', () => {
  const harness = childHarness(true)
  const { calls, spawn } = spawnRecorder(harness.child)
  let sound = false
  const notifier = createNotifier({ scriptPath: 's', sound: () => sound, log: () => {}, spawnFn: spawn })

  notifier.push({ title: 't', body: 'b' })
  sound = true
  notifier.push({ title: 't', body: 'b' })

  assert.equal(calls[0]?.args.includes('-Sound'), false)
  assert.equal(calls[1]?.args.includes('-Sound'), true)
})

test('a non-zero exit is logged', () => {
  const harness = childHarness(false)
  const { spawn } = spawnRecorder(harness.child)
  const logs: string[] = []
  const notifier = createNotifier({
    scriptPath: 's',
    sound: () => false,
    log: (level: LogLevel, message: string) => logs.push(`${level}:${message}`),
    spawnFn: spawn,
  })

  notifier.push({ title: 't', body: 'b' })
  harness.emit('close', 2)
  assert.deepEqual(logs, ['warn:notifier exited with code 2'])
})

test('a spawn error is logged instead of thrown', () => {
  const logs: string[] = []
  const spawn: SpawnFn = () => {
    throw new Error('blocked by policy')
  }
  const notifier = createNotifier({
    scriptPath: 's',
    sound: () => false,
    log: (level: LogLevel, message: string) => logs.push(`${level}:${message}`),
    spawnFn: spawn,
  })

  notifier.push({ title: 't', body: 'b' })
  assert.equal(logs.length, 1)
  assert.match(logs[0] ?? '', /^warn:could not start the notifier: Error: blocked by policy/)
})

test('a hanging notifier is killed after the timeout', async () => {
  const harness = childHarness(false)
  const { spawn } = spawnRecorder(harness.child)
  const logs: string[] = []
  const notifier = createNotifier({
    scriptPath: 's',
    sound: () => false,
    timeoutMs: 5,
    log: (level: LogLevel, message: string) => logs.push(`${level}:${message}`),
    spawnFn: spawn,
  })

  notifier.push({ title: 't', body: 'b' })
  await delay(30)
  assert.equal(harness.killCalls(), 1)
  assert.deepEqual(logs, ['warn:notifier timed out after 5ms'])
  notifier.dispose()
})

test('dispose kills what is running and stops later pushes', () => {
  const harness = childHarness(false)
  const { calls, spawn } = spawnRecorder(harness.child)
  const notifier = createNotifier({ scriptPath: 's', sound: () => false, log: () => {}, spawnFn: spawn })

  notifier.push({ title: 't', body: 'b' })
  notifier.dispose()
  notifier.push({ title: 't2', body: 'b2' })

  assert.equal(calls.length, 1)
  assert.equal(harness.killCalls(), 1)
})
