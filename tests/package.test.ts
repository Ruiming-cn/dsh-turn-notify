import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** Read one repository file as text. */
function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

/** Parse one JSON file from the repository. */
function json(relative: string): Record<string, unknown> {
  return JSON.parse(read(relative)) as Record<string, unknown>
}

test('the package manifest is installable as a dsh bundle', () => {
  const manifest = json('../package.json') as {
    name: string
    version: string
    dsh: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
    exports: Record<string, unknown>
    files: string[]
  }
  assert.equal(manifest.name, 'dsh-turn-notify')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.dsh.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client?.platform, 'web')
  assert.deepEqual(manifest.dsh.client?.inject, ['@deepseek-ai/dsh-client-locale'])
  assert.deepEqual(manifest.exports['./client'], { types: './lib/types/client/index.d.ts', default: './lib/client.js' })
})

test('the browser half is a module-loader bundle id that matches the package', (t) => {
  let bundle: string
  try {
    bundle = read('../lib/client.js')
  } catch {
    t.skip('lib/client.js is not built yet — run npm run build')
    return
  }
  assert.match(bundle, /__ModuleLoader__\.load\(\{ id: 'dsh-turn-notify'/)
  assert.match(bundle, /apply: \(\) => apply/)
  assert.match(bundle, /inject: \(\) => inject/)
})

test('every runtime file the plugin needs is published', () => {
  const { files } = json('../package.json') as { files: string[] }
  for (const required of ['lib', 'notify.ps1', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']) {
    assert.ok(files.includes(required), `files must include ${required}`)
  }
})

test('the patch inserts the row this plugin expects', () => {
  const patch = read('../cordis.patch.yml')
  assert.match(patch, /id: turn-notify/)
  assert.match(patch, /name: dsh-turn-notify/)
})

test('the toast script uses the plugin identity and falls back to a balloon', () => {
  const script = read('../notify.ps1')
  assert.match(script, /Windows\.UI\.Notifications\.ToastNotificationManager/)
  assert.match(script, /CreateToastNotifier\('dsh-turn-notify'\)/)
  assert.match(script, /ShowBalloonTip/)
  assert.match(script, /ms-winsoundevent:Notification.Default/)
  assert.match(script, /AllowEmptyString\(\)/)
})

test('both locales carry the name Plugin Manager shows', () => {
  for (const locale of ['en', 'zh']) {
    const meta = (json(`../locale/${locale}.json`) as { meta?: { title?: string; description?: string } }).meta
    assert.ok(meta?.title !== undefined && meta.title !== '', `${locale} meta.title`)
    assert.ok(meta?.description !== undefined && meta.description !== '', `${locale} meta.description`)
  }
})

test('the official runtime packages are peers, not dependencies', () => {
  const manifest = json('../package.json') as {
    dependencies: Record<string, string>
    peerDependencies: Record<string, string>
  }
  assert.deepEqual(Object.keys(manifest.dependencies), ['@deepseek-ai/schemastery'])
  assert.ok('@deepseek-ai/cordis' in manifest.peerDependencies)
  assert.ok(!('@deepseek-ai/cordis' in manifest.dependencies))
})

test('the repository carries the files a release needs', () => {
  for (const required of ['README.md', 'README.zh.md', 'CHANGELOG.md', 'RELEASING.md', 'LICENSE', 'icon.svg']) {
    assert.ok(readFileSync(new URL(`../${required}`, import.meta.url)).length > 0, `${required} is present`)
  }
})
