/**
 * `turn-notify` namespace dictionaries for the Settings page.
 *
 * Chinese is the key-set source of truth; English mirrors it. Only copy that
 * the page renders lives here — notification text is built in the Host, whose
 * language follows the operating system locale.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'turn-notify'

/** Simplified Chinese dictionary. */
export const zh = {
  nav: '轮次提醒',
  title: '轮次提醒',
  description: '用 Windows 通知提醒你：Agent 停下来等你时，以及轮次结束时。改动对下一条通知立即生效。',
  needsInput: '需要你介入时',
  needsInputHint: '等待批准、等待回答、计划待审阅。',
  turnCompleted: '轮次完成时',
  turnCompletedHint: '你发起的轮次给出了回答。',
  turnProblems: '轮次异常结束时',
  turnProblemsHint: '出错、中止、阻塞、输出超限或会话中断。',
  sound: '播放提示音',
  soundHint: '使用系统默认通知音。',
  loading: '正在读取设置…',
  missing: '该插件当前未加载，暂时无法配置。',
  readOnly: '本部署的插件设置为只读。',
} satisfies Record<string, string>

/** English dictionary. */
export const en = {
  nav: 'Turn notifications',
  title: 'Turn notifications',
  description: 'Windows toasts for the moments the agent waits on you and the moments a turn ends. Changes apply to the next notification.',
  needsInput: 'When I am needed',
  needsInputHint: 'Waiting for approval, an answer, or plan review.',
  turnCompleted: 'When a turn completes',
  turnCompletedHint: 'A turn you asked for has answered.',
  turnProblems: 'When a turn ends badly',
  turnProblemsHint: 'Error, abort, block, output limit or interruption.',
  sound: 'Play a sound',
  soundHint: 'Uses the default Windows notification sound.',
  loading: 'Reading settings…',
  missing: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores plugin settings read-only.',
} satisfies Record<string, string>

/** Translation key accepted by this page. */
export type TranslateKey = keyof typeof zh
