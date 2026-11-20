import type { RenderedNotice } from './messages.ts';
/** Log levels the Host entry forwards to `ctx.logger`. */
export type LogLevel = 'info' | 'warn';
/** The slice of a spawned process this module uses. */
export interface ChildLike {
    on(event: 'error', listener: (error: unknown) => void): unknown;
    on(event: 'close', listener: (code: number | null) => void): unknown;
    kill(): unknown;
}
/** Spawn signature, narrowed to what the notifier passes. */
export type SpawnFn = (command: string, args: readonly string[], options: {
    readonly windowsHide: boolean;
    readonly stdio: 'ignore';
}) => ChildLike;
export interface NotifierOptions {
    /** Absolute path to the packaged `notify.ps1`. */
    readonly scriptPath: string;
    /** Read the current sound switch at send time, so a toggle applies immediately. */
    readonly sound: () => boolean;
    readonly log: (level: LogLevel, message: string) => void;
    readonly timeoutMs?: number;
    readonly spawnFn?: SpawnFn;
}
export interface Notifier {
    push(notice: RenderedNotice): void;
    dispose(): void;
}
/**
 * Create the notifier.
 * @param options - script path, sound switch reader, logger and test seams.
 */
export declare function createNotifier(options: NotifierOptions): Notifier;
