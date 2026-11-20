/**
 * Notification copy.
 *
 * The Host decides what happened; this module decides how it reads. Two
 * languages, no configuration: the notification follows the operating system's
 * locale, because a toast is read by the person at that machine.
 */
import type { Notice } from './decide.ts';
/** Copy language. */
export type Language = 'zh' | 'en';
/** A toast, ready to hand to the notifier. */
export interface RenderedNotice {
    readonly title: string;
    readonly body: string;
}
/** The operating system's language, narrowed to the two we write. */
export declare function detectLanguage(locale?: string): Language;
/**
 * Render one notice for a toast.
 * @param notice - the fact decided from the event.
 * @param sessionLabel - short session identity shown on its own first line.
 * @param language - copy language.
 */
export declare function render(notice: Notice, sessionLabel: string, language: Language): RenderedNotice;
