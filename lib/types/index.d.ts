import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name; also the browser bundle id. */
export declare const name = "turn-notify";
/** Host configuration, validated at activation by the Loader. */
export interface Config {
    /** Toast for approvals, questions and plan reviews. */
    needsInput: Volatile<boolean>;
    /** Toast when a turn the human asked for completes. */
    turnCompleted: Volatile<boolean>;
    /** Toast when a turn ends in an error, abort, block, output limit or interruption. */
    turnProblems: Volatile<boolean>;
    /** Play the notification sound. */
    sound: Volatile<boolean>;
}
/** Live fields are what Settings edits; every one of them updates in place. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    needsInput: z<boolean, boolean, "volatile-defined">;
    turnCompleted: z<boolean, boolean, "volatile-defined">;
    turnProblems: z<boolean, boolean, "volatile-defined">;
    sound: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    needsInput: z<boolean, boolean, "volatile-defined">;
    turnCompleted: z<boolean, boolean, "volatile-defined">;
    turnProblems: z<boolean, boolean, "volatile-defined">;
    sound: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
/**
 * Mount the plugin.
 * @param ctx - Host cordis context.
 * @param config - live configuration; every field is read through `toggle`.
 */
export declare function apply(ctx: Context, config?: Config): void;
