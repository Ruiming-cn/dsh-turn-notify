// decide.mjs — 纯决策逻辑：事件 → 通知 or null。
// 无 Node/cordis 依赖，可独立单测。状态按 sessionId 键控（多会话隔离）。

const TRUNCATE = 120

export const DEFAULT_CONFIG = {
  notify: {
    completed: true,
    blocked: true,
    aborted: true,
    error: true,
    maxTokens: true,
    interrupted: true,
    goals: true,
    approvals: true,
  },
  cooldownMs: 10000,
  titlePrefix: 'DSH',
  showSessionTag: true,
}

export function normalizeConfig(raw = {}) {
  return {
    notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    cooldownMs: Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : DEFAULT_CONFIG.cooldownMs,
    titlePrefix: typeof raw.titlePrefix === 'string' && raw.titlePrefix !== '' ? raw.titlePrefix : DEFAULT_CONFIG.titlePrefix,
    showSessionTag: raw.showSessionTag !== false,
    rootSessionsOnly: raw.rootSessionsOnly !== false,
  }
}

/** 剥除控制字符（含 NUL），防止破坏 spawn 参数。 */
function clean(text) {
  return String(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
}

function truncate(text, max = TRUNCATE) {
  const t = clean(text)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 关键事件 = 非 completed：不排队、不受冷却限制。 */
const CRITICAL_KINDS = new Set([
  'blocked', 'aborted', 'error', 'max-tokens', 'interrupted',
  'goal-blocked', 'goal-paused', 'goal-complete', 'approval',
])

/** kind → [标题, 正文]；正文生成器接收事件 data。 */
const MESSAGES = {
  completed: () => ['轮次完成', '请查看结果或下达新指令'],
  blocked: () => ['目标阻塞', '需要你的指示才能继续'],
  aborted: (data) => {
    const byUser = data?.reason?.reason?.kind === 'user'
    return byUser ? ['对话已中断', '你停止了当前轮次'] : ['对话已中止', 'parent/hook 取消了轮次']
  },
  error: (data) => ['轮次出错', `${data?.reason?.error?.code ?? 'UNKNOWN'}: ${truncate(data?.reason?.error?.message ?? '')}`],
  'max-tokens': () => ['达到输出上限', '本轮输出被截断'],
  interrupted: () => ['会话中断', '崩溃恢复，请检查会话'],
  'goal-blocked': (data) => ['目标已阻塞', truncate(data?.change?.goal?.blockedReason ?? '')],
  'goal-paused': () => ['目标已暂停', '需要恢复或编辑目标'],
  'goal-complete': () => ['目标已完成', '请查看结果'],
  approval: (data) => ['等待你批准', `操作：${truncate(data?.toolName ?? '未知')}`],
}

export function createDecider(config, clock = () => Date.now()) {
  const { notify, cooldownMs, titlePrefix, showSessionTag, rootSessionsOnly } = normalizeConfig(config)
  const state = new Map() // sessionId -> { hasUserInput, lastGoalPhase, lastCompletedAt }

  function sessionState(sessionId) {
    let s = state.get(sessionId)
    if (!s) {
      s = { hasUserInput: false, lastGoalPhase: undefined, lastCompletedAt: -Infinity }
      state.set(sessionId, s)
    }
    return s
  }

  function compose(kind, data, session) {
    const [title, body] = MESSAGES[kind](data)
    const tag = showSessionTag && session?.id ? `会话 ${String(session.id).slice(-6)} · ` : ''
    return {
      kind,
      title: clean(`${titlePrefix} · ${title}`),
      body: clean(`${tag}${body}`),
      critical: CRITICAL_KINDS.has(kind),
    }
  }

  function goalNotice(change, session) {
    const s = sessionState(session.id)
    const phase = change?.goal?.phase
    if (phase === s.lastGoalPhase) return null // 无转变
    s.lastGoalPhase = phase
    const kind = phase === 'blocked' ? 'goal-blocked'
      : phase === 'paused' ? 'goal-paused'
        : phase === 'complete' ? 'goal-complete'
          : null
    return kind ? compose(kind, { change }, session) : null
  }

  return {
    decide(event, session) {
      if (!event || !session?.id) return null
      if (rootSessionsOnly && session.header?.parentSession) return null // 子代理静默
      const s = sessionState(session.id)
      switch (event.type) {
        case 'turn/start':
          s.hasUserInput = false
          return null
        case 'user/message':
          if (event.data?.source?.kind === 'user') s.hasUserInput = true
          return null
        case 'turn/end': {
          const kind = event.data?.reason?.kind
          if (kind === 'completed') {
            if (!notify.completed || !s.hasUserInput) return null
            const now = clock()
            if (now - s.lastCompletedAt < cooldownMs) return null
            s.lastCompletedAt = now
            return compose('completed', {}, session)
          }
          if (kind === 'blocked') return notify.blocked ? compose('blocked', {}, session) : null
          if (kind === 'aborted') return notify.aborted ? compose('aborted', event.data, session) : null
          if (kind === 'error') return notify.error ? compose('error', event.data, session) : null
          if (kind === 'max-tokens') return notify.maxTokens ? compose('max-tokens', {}, session) : null
          if (kind === 'interrupted') return notify.interrupted ? compose('interrupted', {}, session) : null
          return null
        }
        case 'goal/change':
          return notify.goals ? goalNotice(event.data, session) : null
        case 'approval/asked':
          return notify.approvals ? compose('approval', event.data, session) : null
        default:
          return null
      }
    },
  }
}
