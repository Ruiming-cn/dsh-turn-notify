// scheduler.mjs — 通知调度：completed 串行队列（10s 冷却由 decide 负责），
// 关键事件直发不被阻塞；超时 kill；dryRun 只记日志。spawnFn 可注入以便测试。

import { spawn } from 'node:child_process'

export function createScheduler(options, spawnFn = spawn) {
  const { psPath, exePath, timeoutMs = 10000, dryRun = false, sound = false, onLog = () => {} } = options
  const queue = []
  const inflight = new Set() // 所有在途 child（含 critical 直发），dispose 时统一终止
  let running = null
  let disposed = false

  function log(level, message) {
    onLog(level, `[turn-notify] ${message}`)
  }

  function buildArgs(notice) {
    // exePath 模式：直接传 -Title/-Body（dsh-notify.exe 自身约定）；
    // 否则回退 powershell.exe -File notify.ps1。
    const prefix = exePath
      ? []
      : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath]
    const args = [...prefix, '-Title', notice.title, '-Body', notice.body, ...(sound ? ['-Sound'] : [])]
    if (notice.launchUrl) args.push('-Launch', notice.launchUrl)
    return args
  }

  function run(notice) {
    if (disposed) return null
    const command = exePath ?? 'powershell.exe'
    const child = spawnFn(command, buildArgs(notice), { windowsHide: true })
    inflight.add(child)
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      inflight.delete(child)
      if (running === child) {
        running = null
        pump()
      }
    }
    const timer = setTimeout(() => {
      log('warn', `notification timed out after ${timeoutMs}ms, killing powershell`)
      child.kill()
    }, timeoutMs)
    child.on('error', (error) => {
      log('warn', `notification spawn failed: ${error.message}`)
      finish()
    })
    child.on('close', (code) => {
      if (code !== 0) log('warn', `notification exited with code ${code}`)
      finish()
    })
    return child
  }

  function pump() {
    if (disposed || running !== null || queue.length === 0) return
    running = run(queue.shift())
  }

  return {
    push(notice) {
      if (disposed) return
      if (dryRun) {
        log('info', `[dry-run] ${notice.kind}: ${notice.title} — ${notice.body}`)
        return
      }
      if (notice.critical) {
        run(notice) // 直发并行，不占串行槽位
      } else {
        queue.push(notice)
        pump()
      }
    },
    dispose() {
      disposed = true
      queue.length = 0
      for (const child of inflight) {
        try { child.kill() } catch { /* 已退出 */ }
      }
      inflight.clear()
      running = null
    },
  }
}
