// index.mjs — dsh-turn-notify：Cordis 插件入口。
// 监听 session/event（global），决策后经 scheduler 发送 Windows 通知。
// 零外部依赖：ctx 由 cordis 注入；notify.ps1 与插件同目录。

import { fileURLToPath } from 'node:url'
import { createDecider } from './decide.mjs'
import { createScheduler } from './scheduler.mjs'

export const name = 'turn-notify'

export function apply(ctx, config = {}) {
  const psPath = fileURLToPath(new URL('./notify.ps1', import.meta.url))
  const decider = createDecider(config)
  const scheduler = createScheduler({
    psPath,
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
