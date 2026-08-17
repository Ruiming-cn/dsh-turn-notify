// decide.mjs — 纯决策逻辑：事件 → 通知 or null。
// 无 Node/cordis 依赖，可独立单测。状态按 sessionId 键控（多会话隔离）。
// 文案双语：`language: 'zh' | 'en'`（默认 zh），标题/正文/问答前缀均按语言输出。

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
  language: 'zh',
}

export function normalizeConfig(raw = {}) {
  const language = typeof raw.language === 'string' && raw.language.toLowerCase().startsWith('en')
    ? 'en'
    : 'zh'
  return {
    notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    cooldownMs: Number.isFinite(raw.cooldownMs) ? raw.cooldownMs : DEFAULT_CONFIG.cooldownMs,
    mergeWindowMs: Number.isFinite(raw.mergeWindowMs) ? raw.mergeWindowMs : DEFAULT_CONFIG.mergeWindowMs,
    maxSessions: Number.isInteger(raw.maxSessions) && raw.maxSessions > 0 ? raw.maxSessions : DEFAULT_CONFIG.maxSessions,
    titlePrefix: typeof raw.titlePrefix === 'string' && raw.titlePrefix !== '' ? raw.titlePrefix : DEFAULT_CONFIG.titlePrefix,
    showSessionTag: raw.showSessionTag !== false,
    rootSessionsOnly: raw.rootSessionsOnly !== false,
    previewChars: Number.isFinite(raw.previewChars) ? raw.previewChars : DEFAULT_CONFIG.previewChars,
    language,
  }
}

/** 中英文案字典：MESSAGES 按 (data, lang) 取值。 */
const LANG = {
  zh: {
    completed: ['轮次完成', ''],
    blocked: ['目标阻塞', '需要你的指示才能继续'],
    abortedByUser: ['对话已中断', '你停止了当前轮次'],
    abortedOther: ['对话已中止', 'parent/hook 取消了轮次'],
    error: '轮次出错',
    maxTokens: ['达到输出上限', '本轮输出被截断'],
    interrupted: ['会话中断', '崩溃恢复，请检查会话'],
    goalBlocked: '目标已阻塞',
    goalPaused: ['目标已暂停', '需要恢复或编辑目标'],
    goalComplete: ['目标已完成', '请查看结果'],
    approval: '等待你批准',
    question: '等待你回答',
    questionFallback: '请查看界面中的提问',
    planReview: ['计划待审阅', '计划已就绪，请审阅或继续规划'],
    agentError: '运行出错',
    sessionTag: (id) => `会话 ${id}`,
    askPrefix: '问：',
    answerPrefix: '答：',
    count: (n) => `（共 ${n} 个问题）`,
    operation: (t) => `操作：${t}`,
    reason: (r) => `原因：${r}`,
    unknown: '未知',
  },
  en: {
    completed: ['Turn completed', ''],
    blocked: ['Agent blocked', 'Waiting for your input'],
    abortedByUser: ['Conversation interrupted', 'You stopped this turn'],
    abortedOther: ['Conversation aborted', 'Cancelled by parent/hook'],
    error: 'Turn error',
    maxTokens: ['Output limit reached', 'Output was truncated'],
    interrupted: ['Session interrupted', 'Crash recovery — check the session'],
    goalBlocked: 'Goal blocked',
    goalPaused: ['Goal paused', 'Resume or edit the goal'],
    goalComplete: ['Goal completed', 'See the results'],
    approval: 'Approval needed',
    question: 'Waiting for your answer',
    questionFallback: 'See the question in the UI',
    planReview: ['Plan awaiting review', 'Plan ready — review it or keep planning'],
    agentError: 'Runtime error',
    sessionTag: (id) => `Session ${id}`,
    askPrefix: 'Q: ',
    answerPrefix: 'A: ',
    count: (n) => `(${n} questions)`,
    operation: (t) => `Tool: ${t}`,
    reason: (r) => `Reason: ${r}`,
    unknown: 'unknown',
  },
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
 * 从 ask_user_question 的 arguments JSON 中提取首个问题与问题总数。
 * 解析失败/结构异常时安全降级为空（绝不抛错）。
 */
function firstQuestion(argumentsRaw) {
  try {
    const args = typeof argumentsRaw === 'string' ? JSON.parse(argumentsRaw) : argumentsRaw
    const questions = Array.isArray(args?.questions) ? args.questions : []
    const first = questions.find((q) => typeof q?.question === 'string' && q.question !== '')
    return {
      text: first ? truncate(first.question, QUESTION_CHARS) : '',
      count: questions.length,
    }
  } catch {
    return { text: '', count: 0 }
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

/** kind → (data, lang) => [标题, 正文]。 */
const MESSAGES = {
  completed: (data, lang) => lang.completed,
  blocked: (data, lang) => lang.blocked,
  aborted: (data, lang) => {
    const byUser = data?.reason?.reason?.kind === 'user'
    return byUser ? lang.abortedByUser : lang.abortedOther
  },
  error: (data, lang) => [`${lang.error}`, `${data?.reason?.error?.code ?? 'UNKNOWN'}: ${truncate(data?.reason?.error?.message ?? '')}`],
  'max-tokens': (data, lang) => lang.maxTokens,
  interrupted: (data, lang) => lang.interrupted,
  'goal-blocked': (data, lang) => [`${lang.goalBlocked}`, truncate(data?.change?.goal?.blockedReason ?? '')],
  'goal-paused': (data, lang) => lang.goalPaused,
  'goal-complete': (data, lang) => lang.goalComplete,
  approval: (data, lang) => {
    const base = lang.operation(truncate(data?.toolName ?? lang.unknown))
    const reason = data?.reason
    return [lang.approval, reason ? `${base}\n${lang.reason(truncate(reason))}` : base]
  },
  question: (data, lang) => {
    if (!data?.question) return [lang.question, lang.questionFallback]
    const countSuffix = data.count > 1 ? ` ${lang.count(data.count)}` : ''
    return [lang.question, `${data.question}${countSuffix}`]
  },
  'plan-review': (data, lang) => lang.planReview,
  'agent-error': (data, lang) => [`${lang.agentError}`, `${data?.error?.code ?? 'UNKNOWN'}: ${truncate(data?.error?.message ?? '')}`],
}

export function createDecider(config, clock = () => Date.now()) {
  const { notify, cooldownMs, mergeWindowMs, maxSessions, titlePrefix, showSessionTag, rootSessionsOnly, previewChars, language } = normalizeConfig(config)
  const lang = LANG[language]
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
    const ask = s.lastUserText ? `${lang.askPrefix}${truncate(s.lastUserText, previewChars)}` : ''
    const answer = kind === 'completed' && s.lastAssistantText ? `${lang.answerPrefix}${truncate(s.lastAssistantText, previewChars)}` : ''
    const parts = [ask, answer].filter(Boolean)
    return parts.length > 0 ? `${parts.join('\n')}\n` : ''
  }

  function compose(kind, data, session, s) {
    const [title, body] = MESSAGES[kind](data, lang)
    const tag = showSessionTag && session?.id ? `${lang.sessionTag(String(session.id).slice(-6))}\n` : ''
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
            const { text, count } = firstQuestion(event.data?.arguments)
            return mergeGuard('question', s, () => compose('question', { question: text, count }, session))
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
