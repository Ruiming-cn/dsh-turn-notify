/**
 * Locate this plugin's Settings namespace.
 *
 * The projected form is addressed by the profile entry id, which the Loader
 * assigns, so the page cannot hardcode it. The schema is the stable identity:
 * only this plugin declares all four fields, so a namespace whose serialized
 * schema carries them by name is ours.
 */

/** Field names that identify this plugin's projected form. */
export const SETTING_FIELDS = ['needsInput', 'turnCompleted', 'turnProblems', 'sound'] as const

/** The shape a describe view exposes per namespace (only what we read). */
export interface NamespaceView {
  readonly ns?: unknown
  readonly schema?: unknown
}

/**
 * Pick this plugin's namespace out of a describe snapshot.
 * @param namespaces - `view.namespaces` from the settings describe mirror.
 * @returns the entry id to address, or `undefined` when it is not served.
 */
export function pickNamespace(namespaces: readonly unknown[] | undefined): string | undefined {
  if (!Array.isArray(namespaces)) return undefined
  for (const candidate of namespaces) {
    const view = candidate as NamespaceView
    if (typeof view?.ns !== 'string' || view.ns === '') continue
    if (declaresEveryField(view.schema)) return view.ns
  }
  return undefined
}

/** Whether a serialized schema mentions every field this plugin declares. */
function declaresEveryField(schema: unknown): boolean {
  if (schema === undefined || schema === null) return false
  let text: string
  if (typeof schema === 'string') {
    // The describe wire may carry the schema already serialized.
    text = schema
  } else {
    try {
      text = JSON.stringify(schema)
    } catch {
      return false
    }
  }
  return SETTING_FIELDS.every((field) => text.includes(field))
}
