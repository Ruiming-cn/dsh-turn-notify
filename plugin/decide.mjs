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
  previewChars: 60,
}

export function normalizeConfig(raw = {}) {
  return {
    notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    cooldownMs: Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : DEFAULT_CONFIG.cooldownMs,
    titlePrefix: typeof raw.titlePrefix === 'string' && raw.titlePrefix !== '' ? raw.titlePrefix : DEFAULT_CONFIG.titlePrefix,
    showSessionTag: raw.showSessionTag !== false,
    rootSessionsOnly: raw.rootSessionsOnly !== false,
    previewChars: Number.isFinite(raw.previewChars) ? raw.previewChars : DEFAULT_CONFIG.previewChars,
  }
}

/** 剥除控制字符（含 NUL），防止破坏 spawn 参数；保留 \t \n \r（多行预览依赖换行）。 */
function clean(text) {
  return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim()
}

function truncate(text, max = TRUNCATE) {
  const t = clean(text)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 从消息中提取纯文本块（assistant 消息可能含 tool-call 等块）。 */
function textOf(message) {
  if (!message?.content || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

/** 关键事件 = 非 completed：不排队、不受冷却限制。 */
const CRITICAL_KINDS = new Set([
  'blocked', 'aborted', 'error', 'max-tokens', 'interrupted',
  'goal-blocked', 'goal-paused', 'goal-complete', 'approval',
])

/** kind → [标题, 正文]；正文生成器接收事件 data。 */
const MESSAGES = {
  completed: () => ['轮次完成', ''],
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
  const { notify, cooldownMs, titlePrefix, showSessionTag, rootSessionsOnly, previewChars } = normalizeConfig(config)
  const state = new Map() // sessionId -> { hasUserInput, lastUserText, lastAssistantText, lastGoalPhase, lastCompletedAt }

  function sessionState(sessionId) {
    let s = state.get(sessionId)
    if (!s) {
      s = {
        hasUserInput: false,
        lastUserText: undefined,
        lastAssistantText: undefined,
        lastGoalPhase: undefined,
        lastCompletedAt: -Infinity,
      }
      state.set(sessionId, s)
    }
    return s
  }

  /** 问答预览：`问：<截断> / 答：<截断>`（completed 才带答），多行置于正文前。 */
  function buildPreview(s, kind) {
    const ask = s.lastUserText ? `问：${truncate(s.lastUserText, previewChars)}` : ''
    const answer = kind === 'completed' && s.lastAssistantText ? `答：${truncate(s.lastAssistantText, previewChars)}` : ''
    const parts = [ask, answer].filter(Boolean)
    return parts.length > 0 ? `${parts.join('\n')}\n` : ''
  }

  function compose(kind, data, session, s) {
    const [title, body] = MESSAGES[kind](data)
    const tag = showSessionTag && session?.id ? `会话 ${String(session.id).slice(-6)}\n` : ''
    const preview = s ? buildPreview(s, kind) : ''
    return {
      kind,
      title: clean(`${titlePrefix} · ${title}`),
      body: clean(`${tag}${preview}${body}`),
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
          s.lastUserText = undefined
          s.lastAssistantText = undefined
          return null
        case 'user/message': {
          const sourceKind = event.data?.source?.kind
          if (sourceKind === 'user') {
            s.hasUserInput = true
            if (s.lastUserText === undefined) s.lastUserText = textOf(event.data) // 取首个提问
          }
          return null
        }
        case 'assistant/message': {
          const text = textOf(event.data?.message)
          if (text !== '') s.lastAssistantText = text // 取最后回答
          return null
        }
        case 'turn/end': {
          const kind = event.data?.reason?.kind
          if (kind === 'completed') {
            if (!notify.completed || !s.hasUserInput) return null
            const now = clock()
            if (now - s.lastCompletedAt < cooldownMs) return null
            s.lastCompletedAt = now
            return compose('completed', {}, session, s)
          }
          if (kind === 'blocked') return notify.blocked ? compose('blocked', {}, session, s) : null
          if (kind === 'aborted') return notify.aborted ? compose('aborted', event.data, session, s) : null
          if (kind === 'error') return notify.error ? compose('error', event.data, session, s) : null
          if (kind === 'max-tokens') return notify.maxTokens ? compose('max-tokens', {}, session, s) : null
          if (kind === 'interrupted') return notify.interrupted ? compose('interrupted', {}, session, s) : null
          return null
        }
        case 'goal/change':
          return notify.goals ? goalNotice(event.data, session) : null
        case 'approval/asked':
          // goal/approval 事件不带问答预览（与 brief 契约一致）
          return notify.approvals ? compose('approval', event.data, session) : null
        default:
          return null
      }
    },
  }
}
