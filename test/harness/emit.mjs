// harness 专用：向 session/event 注入一组合成事件，覆盖
// completed（含用户输入）、blocked、approval/asked 三个场景。
export const name = 'harness-emitter'

export function apply(ctx) {
  void (async () => {
    await ctx.get('loader')?.await()
    const session = { id: 'session-harness-0001', header: { id: 'session-harness-0001' } }
    const emit = (type, data) => ctx.emit('session/event', session, { type, data })
    emit('turn/start', { turn: 1 })
    emit('user/message', { source: { kind: 'user' } })
    emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    emit('turn/start', { turn: 2 })
    emit('turn/end', { turn: 2, reason: { kind: 'blocked' } })
    emit('approval/asked', { id: 'ask-1', toolName: 'bash' })
  })()
}
