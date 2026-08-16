// decide.mjs — 纯决策逻辑：事件 → 通知 or null。
// 无 Node/cordis 依赖，可独立单测。状态按 sessionId 键控（多会话隔离）。

const TRUNCATE = 120
const QUESTION_CHARS = 60

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
    questions: true,   // ask_user_question 工具（等待回答）
    planReview: true,  // exit_plan_mode 工具（计划待审阅）
    agentError: true,  // agent/error 步骤级错误
  },
  cooldownMs: 10000,       // completed 冷却（按会话）
  mergeWindowMs: 1500,     // 关键事件防风暴窗口（同会话同归一 kind 合并）
  maxSessions: 128,        // 会话状态容量上限（LRU 淘汰最旧）
  titlePrefix: 'DSH',
  showSessionTag: true,
  previewChars: 15,
}

export function normalizeConfig(raw = {}) {
  return {
    notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    cooldownMs: Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : DEFAULT_CONFIG.cooldownMs,
    mergeWindowMs: Number.isFinite(raw.mergeWindowMs) ? raw.mergeWindowMs : DEFAULT_CONFIG.mergeWindowMs,
    maxSessions: Number.isInteger(raw.maxSessions) && raw.maxSessions > 0 ? raw.maxSessions : DEFAULT_CONFIG.maxSessions,
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

/** 按 Unicode 码点截断（emoji 等代理对不会被劈开）。 */
function truncate(text, max = TRUNCATE) {
  const t = clean(text)
  if (t.length <= max) return t
  const chars = Array.from(t) // 码点数组
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : t
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

/**
 * 从 ask_user_question 的 arguments JSON 中提取首个问题与问题计数。
 * 解析失败/结构异常时安全降级为空（绝不抛错）。
 */
function firstQuestion(argumentsRaw) {
  try {
    const args = typeof argumentsRaw === 'string' ? JSON.parse(argumentsRaw) : argumentsRaw
    const questions = Array.isArray(args?.questions) ? args.questions : []
    const first = questions.find((q) => typeof q?.question === 'string' && q.question !== '')
    return {
      text: first ? truncate(first.question, QUESTION_CHARS) : '',
      extra: questions.length > 1 ? `（共 ${questions.length} 个问题）` : '',
    }
  } catch {
    return { text: '', extra: '' }
  }
}

/** 关键事件 = 非 completed：不排队、不受冷却限制。 */
const CRITICAL_KINDS = new Set([
  'blocked', 'aborted', 'error', 'max-tokens', 'interrupted',
  'goal-blocked', 'goal-paused', 'goal-complete', 'approval',
  'question', 'plan-review', 'agent-error',
])

/** 防风暴归一映射：同一归一 key 在 mergeWindowMs 内只发一条。
 *  error 与 agent-error（同一步错误先发 agent/error、后发 turn/end error）；
 *  blocked 与 goal-blocked（goal 驱动回合阻塞时两者都会触发）。 */
const MERGE_KEYS = {
  'agent-error': 'error',
  'goal-blocked': 'blocked',
}

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
  approval: (data) => {
    const base = `操作：${truncate(data?.toolName ?? '未知')}`
    const reason = data?.reason
    return ['等待你批准', reason ? `${base}\n原因：${truncate(reason)}` : base]
  },
  question: (data) => ['等待你回答', data?.question ? `${data.question}${data.extra ?? ''}` : '请查看界面中的提问'],
  'plan-review': () => ['计划待审阅', '计划已就绪，请审阅或继续规划'],
  'agent-error': (data) => ['运行出错', `${data?.error?.code ?? 'UNKNOWN'}: ${truncate(data?.error?.message ?? '')}`],
}

export function createDecider(config, clock = () => Date.now()) {
  const { notify, cooldownMs, mergeWindowMs, maxSessions, titlePrefix, showSessionTag, rootSessionsOnly, previewChars } = normalizeConfig(config)
  const state = new Map() // sessionId -> { hasUserInput, lastUserText, lastAssistantText, lastGoalPhase, lastCompletedAt, lastMergeKey, lastMergeAt }

  function sessionState(sessionId) {
    let s = state.get(sessionId)
    if (!s) {
      if (state.size >= maxSessions) {
        // 容量上限：淘汰最旧插入的会话（Map 保持插入序）
        state.delete(state.keys().next().value)
      }
      s = {
        hasUserInput: false,
        lastUserText: undefined,
        lastAssistantText: undefined,
        lastGoalPhase: undefined,
        lastCompletedAt: -Infinity,
        lastMergeKey: undefined,
        lastMergeAt: -Infinity,
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

  /** 防风暴：同会话同归一 kind 在 mergeWindowMs 内合并（保留第一条）。 */
  function mergeGuard(kind, s, produce) {
    const key = MERGE_KEYS[kind] ?? kind
    const now = clock()
    if (now - s.lastMergeAt < mergeWindowMs && s.lastMergeKey === key) return null
    s.lastMergeAt = now
    s.lastMergeKey = key
    return produce()
  }

  function goalNotice(change, session, s) {
    const phase = change?.goal?.phase
    if (phase === s.lastGoalPhase) return null // 无转变
    s.lastGoalPhase = phase
    const kind = phase === 'blocked' ? 'goal-blocked'
      : phase === 'paused' ? 'goal-paused'
        : phase === 'complete' ? 'goal-complete'
          : null
    if (!kind) return null
    return mergeGuard(kind, s, () => compose(kind, { change }, session))
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
        case 'tool/call': {
          // 等待用户操作的工具：agent 提问（等待回答）、计划审阅
          const name = event.data?.name
          if (name === 'ask_user_question' && notify.questions) {
            const { text, extra } = firstQuestion(event.data?.arguments)
            return mergeGuard('question', s, () => compose('question', { question: text, extra }, session))
          }
          if (name === 'exit_plan_mode' && notify.planReview) {
            return mergeGuard('plan-review', s, () => compose('plan-review', {}, session))
          }
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
          if (kind === 'blocked') return notify.blocked ? mergeGuard('blocked', s, () => compose('blocked', {}, session, s)) : null
          if (kind === 'aborted') return notify.aborted ? mergeGuard('aborted', s, () => compose('aborted', event.data, session, s)) : null
          if (kind === 'error') return notify.error ? mergeGuard('error', s, () => compose('error', event.data, session, s)) : null
          if (kind === 'max-tokens') return notify.maxTokens ? mergeGuard('max-tokens', s, () => compose('max-tokens', {}, session, s)) : null
          if (kind === 'interrupted') return notify.interrupted ? mergeGuard('interrupted', s, () => compose('interrupted', {}, session, s)) : null
          return null
        }
        case 'goal/change':
          return notify.goals ? goalNotice(event.data, session, s) : null
        case 'approval/asked':
          // goal/approval 事件不带问答预览（与 brief 契约一致）
          return notify.approvals ? mergeGuard('approval', s, () => compose('approval', event.data, session)) : null
        default:
          return null
      }
    },
    /** agent/error（步骤级错误，独立于 session/event 总线）：与 turn/end error 归一防风暴。 */
    decideAgentError(payload) {
      if (!payload) return null
      const session = payload.agent?.session
      if (!session?.id) return null
      if (rootSessionsOnly && session.header?.parentSession) return null // 子代理静默
      if (!notify.agentError) return null
      const s = sessionState(session.id)
      const err = payload.error
      const message = err instanceof Error ? err.message : String(err ?? '')
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'UNKNOWN'
      return mergeGuard('agent-error', s, () => compose('agent-error', { error: { code, message } }, session, s))
    },
    /** 会话销毁时释放状态（配合 session/disposed）。 */
    forget(sessionId) {
      state.delete(sessionId)
    },
  }
}
