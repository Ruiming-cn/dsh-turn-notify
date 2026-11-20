/**
 * dsh-turn-notify browser half.
 *
 * One job: a Settings page holding the four switches. The page reads and writes
 * the projected configuration form, so the values live in the profile where the
 * Host reads them — no browser-local copy and nothing to synchronise.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Services required before apply: the slot registry and the dictionary registry. */
export declare const inject: string[];
/**
 * Mount the Settings page.
 * @param ctx - browser cordis context.
 */
export declare function apply(ctx: Context): void;
