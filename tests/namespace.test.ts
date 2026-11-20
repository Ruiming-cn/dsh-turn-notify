import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickNamespace } from '../src/client/namespace.ts'

/** A namespace view whose schema mentions the four settings fields. */
function ours(ns: string): { ns: string; schema: unknown } {
  return {
    ns,
    schema: {
      type: ['object', 'null'],
      properties: {
        needsInput: { type: 'boolean', default: true, 'x-cordis': { volatile: true } },
        turnCompleted: { type: 'boolean' },
        turnProblems: { type: 'boolean' },
        sound: { type: 'boolean' },
      },
    },
  }
}

test('the namespace that declares every field is ours', () => {
  const foreign = { ns: 'better-sidebar', schema: { properties: { autoOpenJobs: { type: 'boolean' } } } }
  assert.equal(pickNamespace([foreign, ours('turn-notify')]), 'turn-notify')
})

test('a partial schema is not ours', () => {
  const partial = { ns: 'x', schema: { properties: { sound: { type: 'boolean' } } } }
  assert.equal(pickNamespace([partial]), undefined)
})

test('missing or empty input yields no namespace', () => {
  assert.equal(pickNamespace(undefined), undefined)
  assert.equal(pickNamespace([]), undefined)
  assert.equal(pickNamespace([{ ns: '' }]), undefined)
  assert.equal(pickNamespace([{ ns: 42, schema: {} }]), undefined)
  assert.equal(pickNamespace([{ schema: {} }]), undefined)
})

test('a schema that cannot be serialized is skipped, not thrown on', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(pickNamespace([{ ns: 'cyclic', schema: cyclic }]), undefined)
  assert.equal(pickNamespace([{ ns: 'cyclic', schema: cyclic }, ours('turn-notify')]), 'turn-notify')
})
