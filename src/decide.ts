/**
 * Turn-notification decisions: one Session event in, one notice out.
 *
 * Pure by construction — no Node, no Cordis, no ambient clock — so the whole
 * rule set is unit-testable. State is keyed per Session, capped by insertion
 * order, and released through `forget` when the Session is disposed.
 */

/** What the human is being told, one value per distinguishable situation. */
export type NoticeKind =
  | 'question'
  | 'plan'
  | 'approval'
  | 'completed'
  | 'error'
  | 'blocked'
  | 'aborted-user'
  | 'aborted-other'
  | 'max-tokens'
  | 'interrupted'

/** The switch a notice belongs to; each maps to one plugin setting. */
export type NoticeGroup = 'needsInput' | 'turnCompleted' | 'turnProblems'

/** One rendered-worthy fact, with the raw material for its message. */
export interface Notice {
  readonly kind: NoticeKind
  readonly group: NoticeGroup
  /** Question text, answer preview, or error text; empty when the kind says enough. */
  readonly detail: string
  /** Secondary line, such as the tool an approval is about. */
  readonly hint?: string
}

/** The subset of a durable Session event this plugin reads. */
export interface EventLike {
  readonly type: string
  readonly data?: unknown
}

/** The subset of a live Session this plugin reads. */
export interface SessionLike {
  readonly id: string
  readonly header?: unknown
}

/** Decision surface used by the Host entry. */
export interface Decider {
  /** Map one Session event to a notice, or `null` when it deserves none. */
  decide(event: EventLike | undefined, session: SessionLike | undefined): Notice | null
  /** Drop everything remembered about one Session. */
  forget(sessionId: string): void
}

/** Sessions remembered at once; eviction is oldest-first because Map keeps insertion order. */
const MAX_SESSIONS = 128

/** Two notices of the same kind for one Session closer than this collapse into the first. */
const DEDUPE_MS = 2000

const GROUPS: Readonly<Record<NoticeKind, NoticeGroup>> = {
  question: 'needsInput',
  plan: 'needsInput',
  approval: 'needsInput',
  completed: 'turnCompleted',
  error: 'turnProblems',
  blocked: 'turnProblems',
  'aborted-user': 'turnProblems',
  'aborted-other': 'turnProblems',
  'max-tokens': 'turnProblems',
  interrupted: 'turnProblems',
}

interface SessionState {
  /** Whether a direct human prompt entered the current turn. */
  humanTurn: boolean
  /** Text of the last assistant message in the current turn. */
  lastAnswer: string
  /** Last time each kind was notified for this Session. */
  lastNotifiedAt: Map<NoticeKind, number>
}

/** Read a plain object, or `undefined` for anything else. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Read a string, or `''` for anything else. */
function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Concatenate the text blocks of a message body. */
function blocksText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const shaped = record(block)
    if (string(shaped?.type) === 'text') parts.push(string(shaped?.text))
  }
  return parts.join('').trim()
}

/**
 * First question of an `ask_user_question` call.
 * @param rawArguments - the model's raw JSON `arguments` string.
 * @returns the question text, or `''` when the model sent something unreadable.
 */
function questionFrom(rawArguments: unknown): string {
  const raw = string(rawArguments)
  if (raw === '') return ''
  try {
    const questions = record(JSON.parse(raw))?.questions
    if (!Array.isArray(questions)) return ''
    for (const item of questions) {
      const question = string(record(item)?.question).trim()
      if (question !== '') return question
    }
  } catch {
    // Argument JSON is model output: malformed is expected occasionally.
  }
  return ''
}

/** Build a notice for a kind that carries no detail of its own. */
function notice(kind: NoticeKind, detail = '', hint?: string): Notice {
  return hint === undefined
    ? { kind, group: GROUPS[kind], detail }
    : { kind, group: GROUPS[kind], detail, hint }
}

/** Map a `tool/call` to the two tools that block on the human. */
function toolCallNotice(data: Record<string, unknown> | undefined): Notice | null {
  const name = string(data?.name)
  if (name === 'ask_user_question') return notice('question', questionFrom(data?.arguments))
  if (name === 'exit_plan_mode') return notice('plan')
  return null
}

/** Map an `approval/asked` audit event. */
function approvalNotice(data: Record<string, unknown> | undefined): Notice | null {
  const toolName = string(data?.toolName)
  const reason = string(data?.reason).trim()
  if (toolName === '' && reason === '') return null
  return notice('approval', toolName, reason === '' ? undefined : reason)
}

/** Map a `turn/end` reason to its notice; `completed` keeps a place for the preview. */
function turnEndNotice(data: Record<string, unknown> | undefined): Notice | null {
  const reason = record(data?.reason)
  switch (string(reason?.kind)) {
    case 'completed':
      return notice('completed')
    case 'error': {
      const error = record(reason?.error)
      const code = string(error?.code) || 'UNKNOWN'
      const message = string(error?.message)
      return notice('error', message === '' ? code : `${code}: ${message}`)
    }
    case 'blocked':
      return notice('blocked')
    case 'max-tokens':
      return notice('max-tokens')
    case 'interrupted':
      return notice('interrupted')
    case 'aborted':
      return notice(string(record(reason?.reason)?.kind) === 'user' ? 'aborted-user' : 'aborted-other')
    default:
      // `forked` and any future kind are not turn ends the human is waiting on.
      return null
  }
}

/**
 * Create a decider.
 * @param options - `now` is injectable so tests can control the dedupe window.
 */
export function createDecider(options: { readonly now?: () => number } = {}): Decider {
  const now = options.now ?? (() => Date.now())
  const sessions = new Map<string, SessionState>()

  const stateOf = (sessionId: string): SessionState => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (oldest !== undefined) sessions.delete(oldest)
    }
    const created: SessionState = { humanTurn: false, lastAnswer: '', lastNotifiedAt: new Map() }
    sessions.set(sessionId, created)
    return created
  }

  const emit = (state: SessionState, candidate: Notice): Notice | null => {
    const at = now()
    const previous = state.lastNotifiedAt.get(candidate.kind)
    if (previous !== undefined && at - previous < DEDUPE_MS) return null
    state.lastNotifiedAt.set(candidate.kind, at)
    return candidate
  }

  return {
    decide(event, session) {
      if (event === undefined || typeof event.type !== 'string') return null
      if (session === undefined || typeof session.id !== 'string') return null
      if (string(record(session.header)?.origin) === 'subagent') return null
      const state = stateOf(session.id)
      switch (event.type) {
        case 'turn/start':
          state.humanTurn = false
          state.lastAnswer = ''
          return null
        case 'user/message':
          if (string(record(record(event.data)?.source)?.kind) === 'user') state.humanTurn = true
          return null
        case 'assistant/message':
          state.lastAnswer = blocksText(record(record(event.data)?.message)?.content)
          return null
        case 'tool/call': {
          const candidate = toolCallNotice(record(event.data))
          return candidate === null ? null : emit(state, candidate)
        }
        case 'approval/asked': {
          const candidate = approvalNotice(record(event.data))
          return candidate === null ? null : emit(state, candidate)
        }
        case 'turn/end': {
          const candidate = turnEndNotice(record(event.data))
          if (candidate === null) return null
          if (candidate.kind === 'completed') {
            // A turn nobody asked for (goal round, cron, steering) is not a reply to the human.
            if (!state.humanTurn) return null
            return emit(state, { ...candidate, detail: state.lastAnswer })
          }
          return emit(state, candidate)
        }
        default:
          return null
      }
    },
    forget(sessionId) {
      sessions.delete(sessionId)
    },
  }
}
