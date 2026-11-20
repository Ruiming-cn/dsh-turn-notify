/**
 * Windows notifier: one PowerShell process per toast.
 *
 * The toast itself lives in `notify.ps1`; this module owns process lifetime,
 * the timeout, and the promise that a broken notifier can never break a
 * Session. `spawn` is injectable so the wiring is unit-testable without
 * launching PowerShell.
 */
import { spawn } from 'node:child_process'
import type { RenderedNotice } from './messages.ts'

/** Log levels the Host entry forwards to `ctx.logger`. */
export type LogLevel = 'info' | 'warn'

/** The slice of a spawned process this module uses. */
export interface ChildLike {
  on(event: 'error', listener: (error: unknown) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
  kill(): unknown
}

/** Spawn signature, narrowed to what the notifier passes. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly windowsHide: boolean; readonly stdio: 'ignore' },
) => ChildLike

export interface NotifierOptions {
  /** Absolute path to the packaged `notify.ps1`. */
  readonly scriptPath: string
  /** Read the current sound switch at send time, so a toggle applies immediately. */
  readonly sound: () => boolean
  readonly log: (level: LogLevel, message: string) => void
  readonly timeoutMs?: number
  readonly spawnFn?: SpawnFn
}

export interface Notifier {
  push(notice: RenderedNotice): void
  dispose(): void
}

/** A toast that has not exited by now is stuck; kill it and say so. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Default spawn keeps the console window hidden and drops the child's output. */
const defaultSpawn: SpawnFn = (command, args, options) => spawn(command, [...args], options)

/**
 * Create the notifier.
 * @param options - script path, sound switch reader, logger and test seams.
 */
export function createNotifier(options: NotifierOptions): Notifier {
  const { scriptPath, sound, log } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spawnFn = options.spawnFn ?? defaultSpawn
  const running = new Set<ChildLike>()
  let disposed = false

  const push = (notice: RenderedNotice): void => {
    if (disposed) return
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Title',
      notice.title,
      '-Body',
      notice.body,
    ]
    if (sound()) args.push('-Sound')
    let child: ChildLike
    try {
      child = spawnFn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      log('warn', `could not start the notifier: ${String(error)}`)
      return
    }
    running.add(child)
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      running.delete(child)
    }
    timer = setTimeout(() => {
      log('warn', `notifier timed out after ${timeoutMs}ms`)
      try {
        child.kill()
      } catch {
        // Already gone; the close handler owns cleanup.
      }
      finish()
    }, timeoutMs)
    child.on('error', (error) => {
      log('warn', `notifier failed: ${String(error)}`)
      finish()
    })
    child.on('close', (code) => {
      if (code !== 0 && code !== null) log('warn', `notifier exited with code ${code}`)
      finish()
    })
  }

  return {
    push,
    dispose() {
      disposed = true
      for (const child of running) {
        try {
          child.kill()
        } catch {
          // Best effort: the Host is shutting down anyway.
        }
      }
      running.clear()
    },
  }
}
