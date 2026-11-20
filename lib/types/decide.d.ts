/**
 * Turn-notification decisions: one Session event in, one notice out.
 *
 * Pure by construction — no Node, no Cordis, no ambient clock — so the whole
 * rule set is unit-testable. State is keyed per Session, capped by insertion
 * order, and released through `forget` when the Session is disposed.
 */
/** What the human is being told, one value per distinguishable situation. */
export type NoticeKind = 'question' | 'plan' | 'approval' | 'completed' | 'error' | 'blocked' | 'aborted-user' | 'aborted-other' | 'max-tokens' | 'interrupted';
/** The switch a notice belongs to; each maps to one plugin setting. */
export type NoticeGroup = 'needsInput' | 'turnCompleted' | 'turnProblems';
/** One rendered-worthy fact, with the raw material for its message. */
export interface Notice {
    readonly kind: NoticeKind;
    readonly group: NoticeGroup;
    /** Question text, answer preview, or error text; empty when the kind says enough. */
    readonly detail: string;
    /** Secondary line, such as the tool an approval is about. */
    readonly hint?: string;
}
/** The subset of a durable Session event this plugin reads. */
export interface EventLike {
    readonly type: string;
    readonly data?: unknown;
}
/** The subset of a live Session this plugin reads. */
export interface SessionLike {
    readonly id: string;
    readonly header?: unknown;
}
/** Decision surface used by the Host entry. */
export interface Decider {
    /** Map one Session event to a notice, or `null` when it deserves none. */
    decide(event: EventLike | undefined, session: SessionLike | undefined): Notice | null;
    /** Drop everything remembered about one Session. */
    forget(sessionId: string): void;
}
/**
 * Create a decider.
 * @param options - `now` is injectable so tests can control the dedupe window.
 */
export declare function createDecider(options?: {
    readonly now?: () => number;
}): Decider;
