/**
 * Settings page for the notification switches.
 *
 * The page does not store anything itself: it reads and writes the projected
 * configuration form, so a change lands in the profile patch and the Host's
 * live fields pick it up in place. That is also why the page works when the
 * plugin is toggled off and says so instead of guessing.
 */
import { useCallback, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react'
import { pickNamespace, type NamespaceView } from './namespace.ts'
import type { TranslateKey } from './locales.ts'

/** Local translate function. */
type Translate = (key: TranslateKey) => string

/** The value half of a configuration form snapshot (only what we read). */
export interface FormSnapshot {
  readonly status?: 'loading' | 'ready' | 'unavailable'
  readonly value?: unknown
  readonly writable?: boolean
}

/** One entry's configuration form controller. */
export interface ConfigFormLike {
  getSnapshot(): FormSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: boolean): unknown
}

/** The settings describe mirror. */
export interface DescribeLike {
  getSnapshot(): { readonly view?: { readonly namespaces?: readonly NamespaceView[] } }
  subscribe(listener: () => void): () => void
}

/** The client `configForms` service face. */
export interface ConfigFormsLike {
  describe(): DescribeLike
  get(ns: string): ConfigFormLike
}

/** Props the slot registration injects. */
export interface NotifySectionProps {
  readonly forms: ConfigFormsLike
  readonly t: Translate
}

/** One switch row: the config field, its label key and its hint key. */
const SWITCHES = [
  { field: 'needsInput', label: 'needsInput', hint: 'needsInputHint' },
  { field: 'turnCompleted', label: 'turnCompleted', hint: 'turnCompletedHint' },
  { field: 'turnProblems', label: 'turnProblems', hint: 'turnProblemsHint' },
  { field: 'sound', label: 'sound', hint: 'soundHint' },
] as const satisfies readonly { readonly field: string; readonly label: TranslateKey; readonly hint: TranslateKey }[]

const styles: Record<string, CSSProperties> = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '4px 0',
    color: 'var(--dsw-alias-label-primary, #1f1f1f)',
    font: 'inherit',
  },
  title: { margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 600 },
  description: { margin: 0, fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary, #555)' },
  note: { margin: 0, fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary, #8a8a8e)' },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 12px',
    border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  control: { marginTop: '2px', flex: 'none' },
  body: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  label: { fontSize: '13px', lineHeight: '20px', fontWeight: 500 },
  hint: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8a8a8e)' },
}

/** The settings section: resolves the form, then renders the switches. */
export function NotifySection({ forms, t }: NotifySectionProps): ReactElement {
  const describe = forms.describe()
  const subscribeMirror = useCallback((listener: () => void) => describe.subscribe(listener), [describe])
  const readMirror = useCallback(() => describe.getSnapshot(), [describe])
  const mirror = useSyncExternalStore(subscribeMirror, readMirror)
  const namespaces = mirror?.view?.namespaces
  if (namespaces === undefined) return <p style={styles.note}>{t('loading')}</p>
  const namespace = pickNamespace(namespaces)
  if (namespace === undefined) return <p style={styles.note}>{t('missing')}</p>
  return <SwitchList forms={forms} namespace={namespace} t={t} />
}

/** The four switches, bound to the resolved form controller. */
function SwitchList({ forms, namespace, t }: { readonly forms: ConfigFormsLike; readonly namespace: string; readonly t: Translate }): ReactElement {
  const form = forms.get(namespace)
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const read = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, read)
  const writable = snapshot.writable !== false
  const values = (typeof snapshot.value === 'object' && snapshot.value !== null ? snapshot.value : {}) as Record<string, unknown>
  const disabled = !writable || snapshot.status === 'unavailable'
  return (
    <section style={styles.section} aria-label={t('title')}>
      <h3 style={styles.title}>{t('title')}</h3>
      <p style={styles.description}>{t('description')}</p>
      {writable ? null : <p style={styles.note}>{t('readOnly')}</p>}
      {!writable || snapshot.status !== 'unavailable' ? null : <p style={styles.note}>{t('missing')}</p>}
      {SWITCHES.map(({ field, label, hint }) => (
        <label key={field} style={styles.row}>
          <input
            type="checkbox"
            role="switch"
            style={styles.control}
            checked={values[field] !== false}
            disabled={disabled}
            aria-label={t(label)}
            onChange={(event) => {
              void form.set(field, event.currentTarget.checked)
            }}
          />
          <span style={styles.body}>
            <span style={styles.label}>{t(label)}</span>
            <span style={styles.hint}>{t(hint)}</span>
          </span>
        </label>
      ))}
    </section>
  )
}
