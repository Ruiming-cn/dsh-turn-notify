import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../src/index.ts'

/** A context stub that records what the entry registers. */
function fakeContext(): { readonly events: string[]; readonly ctx: unknown } {
  const events: string[] = []
  const settings = {
    configure: (policy: unknown) => {
      events.push(`configure:${JSON.stringify(policy)}`)
      return () => {}
    },
  }
  const child = {
    get: (name: string) => (name === 'settings' ? settings : undefined),
    effect: (callback: () => () => void, label?: string) => {
      events.push(`child-effect:${label ?? ''}`)
      return callback()
    },
    fiber: {},
  }
  const ctx = {
    logger: {
      info: (line: string) => events.push(`log:${line}`),
      warn: (line: string) => events.push(`log:${line}`),
    },
    effect: (callback: () => () => void, label?: string) => {
      events.push(`effect:${label ?? ''}`)
      return callback()
    },
    on: (name: string) => {
      events.push(`on:${name}`)
    },
    inject: (deps: readonly string[], callback: (child: unknown) => void) => {
      events.push(`inject:${deps.join('+')}`)
      callback(child)
    },
    fiber: {},
  }
  return { events, ctx }
}

test('the host entry registers its listeners on Windows and refuses elsewhere', () => {
  const { events, ctx } = fakeContext()
  apply(ctx as never, undefined)

  if (process.platform !== 'win32') {
    assert.deepEqual(events, [
      `log:[turn-notify] inactive: Windows toast notifications only (this platform is ${process.platform})`,
    ])
    return
  }

  assert.ok(events.includes('on:session/event'), 'listens to the session event feed')
  assert.ok(events.includes('on:session/disposed'), 'releases per-session state')
  assert.ok(events.includes('effect:dsh-turn-notify: notifier'), 'owns the notifier lifetime')
  assert.ok(events.includes('inject:settings'), 'asks for the settings service')
  assert.ok(events.includes('configure:{"auto":false}'), 'keeps the projected form off its own page')
  assert.ok(events.some((event) => event.startsWith('log:[turn-notify] ready')), 'logs its readiness')
})
