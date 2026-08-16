// index.mjs — dsh-turn-notify：Cordis 插件入口。
// 监听 session/event（global），决策后经 scheduler 发送 Windows 通知。
// 通知器优先 dsh-notify.exe（独立 exe，绕开安全软件对脚本宿主的拦截），
// 缺失时回退 notify.ps1。仅依赖 Node 内置模块与相对模块。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDecider } from './decide.mjs'
import { createScheduler } from './scheduler.mjs'

export const name = 'turn-notify'

export function apply(ctx, config = {}) {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  const psPath = join(dir, 'notify.ps1')
  const exePath = existsSync(join(dir, 'dsh-notify.exe')) ? join(dir, 'dsh-notify.exe') : undefined
  const decider = createDecider(config)
  const scheduler = createScheduler({
    psPath,
    exePath,
    timeoutMs: config.timeoutMs ?? 10000,
    dryRun: config.dryRun === true,
    sound: config.sound === true,
    onLog: (level, message) => ctx.logger?.[level]?.(message),
  })

  ctx.on('session/event', (session, event) => {
    try {
      const notice = decider.decide(event, session) // 子代理过滤/冷却/映射均在 decide 层
      if (notice !== null) scheduler.push(notice)
    } catch (error) {
      ctx.logger?.warn?.(`[turn-notify] listener failed: ${String(error)}`)
    }
  }, { global: true })

  return () => scheduler.dispose()
}
