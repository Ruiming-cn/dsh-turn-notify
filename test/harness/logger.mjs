// harness 专用：把 logger 消息打印到 stdout。
export const name = 'harness-logger'

export function apply(ctx) {
  ctx.logger.exporter({
    colors: 0,
    export(message) {
      // @deepseek-ai/cordis 4.0.0-rc.7 的 Message 用 args 数组承载内容
      // （早期版本用 content），这里兼容两者。
      const raw = message.args ?? message.content
      const parts = Array.isArray(raw) ? raw : [raw]
      console.log(`[${message.level}] ${message.name}:`, ...parts)
    },
  })
}
