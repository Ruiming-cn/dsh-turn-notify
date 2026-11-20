/**
 * Locate this plugin's Settings namespace.
 *
 * The projected form is addressed by the profile entry id, which the Loader
 * assigns, so the page cannot hardcode it. The schema is the stable identity:
 * only this plugin declares all four fields, so a namespace whose serialized
 * schema carries them by name is ours.
 */
/** Field names that identify this plugin's projected form. */
export declare const SETTING_FIELDS: readonly ["needsInput", "turnCompleted", "turnProblems", "sound"];
/** The shape a describe view exposes per namespace (only what we read). */
export interface NamespaceView {
    readonly ns?: unknown;
    readonly schema?: unknown;
}
/**
 * Pick this plugin's namespace out of a describe snapshot.
 * @param namespaces - `view.namespaces` from the settings describe mirror.
 * @returns the entry id to address, or `undefined` when it is not served.
 */
export declare function pickNamespace(namespaces: readonly unknown[] | undefined): string | undefined;
