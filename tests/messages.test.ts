import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Notice } from '../src/decide.ts'
import { detectLanguage, render } from '../src/messages.ts'

/** One notice of the given kind. */
function notice(kind: Notice['kind'], detail = '', hint?: string): Notice {
  return { kind, group: 'needsInput', detail, ...(hint === undefined ? {} : { hint }) }
}

test('a Chinese question toast carries the session label and the question', () => {
  const rendered = render(notice('question', '选哪个文件？'), 'my-project', 'zh')
  assert.equal(rendered.title, 'DSH · 等待你回答')
  assert.equal(rendered.body, 'my-project\n问：选哪个文件？')
})

test('an English completion toast carries the answer preview', () => {
  const rendered = render(notice('completed', 'The file is at src/a.ts.'), 'my-project', 'en')
  assert.equal(rendered.title, 'DSH · Turn completed')
  assert.equal(rendered.body, 'my-project\nA: The file is at src/a.ts.')
})

test('an approval toast labels the tool and the reason', () => {
  const rendered = render(notice('approval', 'Bash', 'installs packages'), 'work', 'zh')
  assert.equal(rendered.body, 'work\n操作：Bash\n原因：installs packages')
})

test('each problem kind has its own English title', () => {
  const titles = (['error', 'blocked', 'aborted-user', 'aborted-other', 'max-tokens', 'interrupted'] as const).map(
    (kind) => render(notice(kind, 'X'), 'w', 'en').title,
  )
  assert.deepEqual(titles, [
    'DSH · Turn failed',
    'DSH · Waiting for your direction',
    'DSH · Stopped',
    'DSH · Aborted',
    'DSH · Output limit reached',
    'DSH · Session interrupted',
  ])
})

test('long detail is cut to its budget with an ellipsis', () => {
  const rendered = render(notice('question', '字'.repeat(200)), 'w', 'zh')
  const line = rendered.body.split('\n')[1] ?? ''
  assert.equal(Array.from(line).length, '问：'.length + 100)
  assert.ok(line.endsWith('…'))
})

test('truncation never splits a surrogate pair', () => {
  const rendered = render(notice('question', '😀'.repeat(200)), 'w', 'zh')
  const line = rendered.body.split('\n')[1] ?? ''
  assert.equal(Array.from(line).length, '问：'.length + 100)
  assert.ok([...line].every((character) => character !== '\uFFFD'))
  assert.ok(line.endsWith('😀…'))
})

test('control characters and line breaks collapse into one line', () => {
  const rendered = render(notice('error', 'boom\u0000\n\t second   line'), 'w', 'en')
  assert.equal(rendered.body, 'w\nError: boom second line')
})

test('an empty session label does not leave a blank first line', () => {
  const rendered = render(notice('blocked'), '', 'en')
  assert.equal(rendered.body, 'The agent needs your direction to continue')
})

test('the approval fallback is used when the tool is unknown', () => {
  assert.equal(render(notice('approval'), 'w', 'en').body, 'w\nAn action needs your approval')
})

test('the language follows the machine locale', () => {
  assert.equal(detectLanguage('zh-CN'), 'zh')
  assert.equal(detectLanguage('zh-Hant-TW'), 'zh')
  assert.equal(detectLanguage('en-US'), 'en')
  assert.equal(detectLanguage('de-DE'), 'en')
})
