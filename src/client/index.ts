/**
 * dsh-turn-notify browser half.
 *
 * One job: a Settings page holding the four switches. The page reads and writes
 * the projected configuration form, so the values live in the profile where the
 * Host reads them — no browser-local copy and nothing to synchronise.
 */
import type { Context } from '@deepseek-ai/cordis'
import { NS, en, zh, type TranslateKey } from './locales.ts'
import { NotifySection, type ConfigFormsLike } from './settings-view.tsx'

/** Services required before apply: the slot registry and the dictionary registry. */
export const inject = ['slots', 'locale']

/** One `settings.section` registration. */
interface SlotRegistration {
  readonly name: string
  readonly id: string
  readonly order: number
  readonly locale: string
  readonly label: () => string
  readonly inject: () => Record<string, unknown>
}

/** The slot service face this half uses. */
interface SlotsLike {
  inject(name: string, callback: () => unknown): unknown
  register(entry: SlotRegistration, component: unknown): unknown
}

/** The locale service face this half uses. */
interface LocaleLike {
  register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

/** The client context members the standard Cordis types do not declare for a plugin. */
interface ClientContext {
  readonly locale: LocaleLike
  readonly slots?: SlotsLike
  effect(callback: () => () => void, label?: string): unknown
  inject(deps: readonly string[], callback: (child: ClientContext) => void): unknown
}

/** Turn whatever a slot helper answered into a disposer. */
function asDisposer(value: unknown): () => void {
  if (typeof value === 'function') return value as () => void
  const disposable = value as { dispose?: () => void } | undefined
  return () => {
    disposable?.dispose?.()
  }
}

/**
 * Mount the Settings page.
 * @param ctx - browser cordis context.
 */
export function apply(ctx: Context): void {
  const client = ctx as unknown as ClientContext
  client.effect(() => client.locale.register(NS, { zh, en }), 'dsh-turn-notify: dictionaries')
  const t = client.locale.bind(NS) as unknown as (key: TranslateKey) => string
  const slots = client.slots
  if (slots === undefined) return

  // The settings form service arrives with the Harness' own Settings page; the
  // section exists exactly while it is available.
  client.inject(['configForms'], (child) => {
    const forms = (child as unknown as { get(name: string): unknown }).get('configForms') as
      | ConfigFormsLike
      | undefined
    if (forms === undefined) return
    child.effect(
      () =>
        asDisposer(
          slots.inject('settings.section', () =>
            slots.register(
              {
                name: 'settings.section',
                id: 'dsh-turn-notify',
                order: 870,
                locale: NS,
                label: () => t('nav'),
                inject: () => ({ forms, t }),
              },
              NotifySection,
            ),
          ),
        ),
      'dsh-turn-notify: settings section',
    )
  })
}
