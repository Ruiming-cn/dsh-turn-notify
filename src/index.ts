/**
 * dsh-turn-notify Host entry.
 *
 * Listens to one Session event feed and turns two families of facts into
 * Windows toasts: the moments the agent blocks on the human, and the moments a
 * turn ends. Each family has its own switch, read at send time, so a change in
 * Settings applies to the next notification without reloading the plugin.
 */
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Volatile } from '@deepseek-ai/cordis'
// Type-only: brings the DSH Session services and event names into this program.
import type {} from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { createDecider, type EventLike, type NoticeGroup, type SessionLike } from './decide.ts'
import { detectLanguage, render } from './messages.ts'
import { createNotifier, type LogLevel } from './notify.ts'

/** Cordis plugin name; also the browser bundle id. */
export const name = 'turn-notify'

/** Host configuration, validated at activation by the Loader. */
export interface Config {
  /** Toast for approvals, questions and plan reviews. */
  needsInput: Volatile<boolean>
  /** Toast when a turn the human asked for completes. */
  turnCompleted: Volatile<boolean>
  /** Toast when a turn ends in an error, abort, block, output limit or interruption. */
  turnProblems: Volatile<boolean>
  /** Play the notification sound. */
  sound: Volatile<boolean>
}

/** Live fields are what Settings edits; every one of them updates in place. */
export const Config = z.object({
  needsInput: z.boolean().default(true).volatile(),
  turnCompleted: z.boolean().default(true).volatile(),
  turnProblems: z.boolean().default(true).volatile(),
  sound: z.boolean().default(true).volatile(),
})

/** The slice of the Settings service this plugin configures. */
interface SettingsService {
  configure(presentation: { auto?: boolean }, owner: unknown): () => void
}

/**
 * Read one switch.
 *
 * A live field exposes `get()`; a plain configuration value is the boolean
 * itself. Reads happen per notification, which is what makes the Settings page
 * take effect immediately.
 */
function toggle(field: unknown, fallback: boolean): boolean {
  const holder = field as { get?: () => unknown } | undefined
  if (typeof holder?.get === 'function') {
    const current = holder.get()
    return typeof current === 'boolean' ? current : fallback
  }
  return typeof field === 'boolean' ? field : fallback
}

/** Which switch owns a notice group. */
function enabled(config: Config | undefined, group: NoticeGroup): boolean {
  if (group === 'needsInput') return toggle(config?.needsInput, true)
  if (group === 'turnCompleted') return toggle(config?.turnCompleted, true)
  return toggle(config?.turnProblems, true)
}

/** First body line: the workspace folder, or the tail of the Session id. */
function sessionLabel(session: SessionLike): string {
  const cwd = (session.header as { cwd?: unknown } | undefined)?.cwd
  if (typeof cwd === 'string' && cwd !== '') return basename(cwd)
  return String(session.id).slice(-6)
}

/**
 * Mount the plugin.
 * @param ctx - Host cordis context.
 * @param config - live configuration; every field is read through `toggle`.
 */
export function apply(ctx: Context, config?: Config): void {
  const log = (level: LogLevel, message: string): void => {
    const logger = ctx.logger as { info?: (line: string) => void; warn?: (line: string) => void } | undefined
    logger?.[level]?.(`[turn-notify] ${message}`)
  }

  if (process.platform !== 'win32') {
    log('info', `inactive: Windows toast notifications only (this platform is ${process.platform})`)
    return
  }

  const notifier = createNotifier({
    scriptPath: fileURLToPath(new URL('../notify.ps1', import.meta.url)),
    sound: () => toggle(config?.sound, true),
    log,
  })
  const decider = createDecider()
  const language = detectLanguage()

  ctx.effect(() => () => notifier.dispose(), 'dsh-turn-notify: notifier')

  ctx.on('session/event', (session: SessionLike, event: EventLike) => {
    try {
      const notice = decider.decide(event, session)
      if (notice === null || !enabled(config, notice.group)) return
      notifier.push(render(notice, sessionLabel(session), language))
    } catch (error) {
      // A notification is never worth interrupting the Session that raised it.
      log('warn', `listener failed: ${String(error)}`)
    }
  }, { global: true })

  ctx.on('session/disposed', (session: SessionLike) => {
    try {
      decider.forget(String(session.id))
    } catch (error) {
      log('warn', `cleanup failed: ${String(error)}`)
    }
  }, { global: true })

  // This plugin ships its own Settings page, so the projected form must not
  // appear beside it if a later Harness starts generating one automatically.
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = (settingsCtx as unknown as { get(name: string): unknown }).get('settings') as
      | SettingsService
      | undefined
    const configure = settings?.configure
    if (settings === undefined || typeof configure !== 'function') return
    settingsCtx.effect(() => {
      try {
        return configure.call(settings, { auto: false }, settingsCtx.fiber)
      } catch (error) {
        // A page-policy nicety must never be the reason the plugin fails to load.
        log('warn', `could not set the settings page policy: ${String(error)}`)
        return () => {}
      }
    }, 'dsh-turn-notify: settings page policy')
  })

  log('info', 'ready: Windows toasts for approvals, questions and turn ends')
}
