/**
 * Notification copy.
 *
 * The Host decides what happened; this module decides how it reads. Two
 * languages, no configuration: the notification follows the operating system's
 * locale, because a toast is read by the person at that machine.
 */
import type { Notice, NoticeKind } from './decide.ts'

/** Copy language. */
export type Language = 'zh' | 'en'

/** A toast, ready to hand to the notifier. */
export interface RenderedNotice {
  readonly title: string
  readonly body: string
}

/** Every toast title starts with this, so a stack of toasts reads as one app. */
const PREFIX = 'DSH'

/** Deterministic caps, sized to keep a long banner at three visible lines. */
const LIMIT = { question: 100, answer: 90, error: 140, hint: 90 } as const

interface Copy {
  readonly title: Readonly<Record<NoticeKind, string>>
  /** Lines under the session label, already labelled for this language. */
  body(notice: Notice): string[]
}

const ZH: Copy = {
  title: {
    question: '等待你回答',
    plan: '计划待审阅',
    approval: '等待你批准',
    completed: '轮次完成',
    error: '轮次出错',
    blocked: '需要你的指示',
    'aborted-user': '已停止',
    'aborted-other': '已中止',
    'max-tokens': '达到输出上限',
    interrupted: '会话中断',
  },
  body(notice) {
    switch (notice.kind) {
      case 'question':
        return [notice.detail === '' ? '请回到界面回答问题' : `问：${truncate(notice.detail, LIMIT.question)}`]
      case 'plan':
        return ['计划已就绪，等你审阅或继续规划']
      case 'approval':
        return [
          notice.detail === '' ? '有操作需要你的批准' : `操作：${truncate(notice.detail, LIMIT.hint)}`,
          ...(notice.hint === undefined ? [] : [`原因：${truncate(notice.hint, LIMIT.hint)}`]),
        ]
      case 'completed':
        return [notice.detail === '' ? '模型已作答，可以继续' : `答：${truncate(notice.detail, LIMIT.answer)}`]
      case 'error':
        return [`错误：${truncate(notice.detail, LIMIT.error)}`]
      case 'blocked':
        return ['Agent 需要你的指示才能继续']
      case 'aborted-user':
        return ['你停止了当前轮次']
      case 'aborted-other':
        return ['本轮由父级会话或 hook 中止']
      case 'max-tokens':
        return ['本轮输出被截断，可要求继续']
      case 'interrupted':
        return ['崩溃恢复后的会话已中断，请检查']
    }
  },
}

const EN: Copy = {
  title: {
    question: 'Waiting for your answer',
    plan: 'Plan awaiting review',
    approval: 'Waiting for your approval',
    completed: 'Turn completed',
    error: 'Turn failed',
    blocked: 'Waiting for your direction',
    'aborted-user': 'Stopped',
    'aborted-other': 'Aborted',
    'max-tokens': 'Output limit reached',
    interrupted: 'Session interrupted',
  },
  body(notice) {
    switch (notice.kind) {
      case 'question':
        return [notice.detail === '' ? 'Answer the question in the app' : `Q: ${truncate(notice.detail, LIMIT.question)}`]
      case 'plan':
        return ['The plan is ready to review or keep planning']
      case 'approval':
        return [
          notice.detail === '' ? 'An action needs your approval' : `Tool: ${truncate(notice.detail, LIMIT.hint)}`,
          ...(notice.hint === undefined ? [] : [`Reason: ${truncate(notice.hint, LIMIT.hint)}`]),
        ]
      case 'completed':
        return [notice.detail === '' ? 'The reply is in' : `A: ${truncate(notice.detail, LIMIT.answer)}`]
      case 'error':
        return [`Error: ${truncate(notice.detail, LIMIT.error)}`]
      case 'blocked':
        return ['The agent needs your direction to continue']
      case 'aborted-user':
        return ['You stopped this turn']
      case 'aborted-other':
        return ['Cancelled by a parent session or hook']
      case 'max-tokens':
        return ['The reply was cut off; ask it to continue']
      case 'interrupted':
        return ['The session was interrupted after a crash']
    }
  },
}

const COPY: Readonly<Record<Language, Copy>> = { zh: ZH, en: EN }

/** Collapse control characters and runs of whitespace so one fact stays one line. */
function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cut a string to a budget without splitting a surrogate pair.
 * @param value - already-cleaned text.
 * @param max - maximum code points kept, including the ellipsis.
 */
function truncate(value: string, max: number): string {
  const points = Array.from(clean(value))
  return points.length <= max ? points.join('') : `${points.slice(0, max - 1).join('')}…`
}

/** The operating system's language, narrowed to the two we write. */
export function detectLanguage(locale?: string): Language {
  let resolved = locale
  if (resolved === undefined) {
    try {
      resolved = Intl.DateTimeFormat().resolvedOptions().locale
    } catch {
      resolved = 'en'
    }
  }
  return resolved.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * Render one notice for a toast.
 * @param notice - the fact decided from the event.
 * @param sessionLabel - short session identity shown on its own first line.
 * @param language - copy language.
 */
export function render(notice: Notice, sessionLabel: string, language: Language): RenderedNotice {
  const copy = COPY[language]
  const lines = [clean(sessionLabel), ...copy.body(notice).map(clean)].filter((line) => line !== '')
  return { title: `${PREFIX} · ${copy.title[notice.kind]}`, body: lines.join('\n') }
}
