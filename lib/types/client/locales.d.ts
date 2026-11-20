/**
 * `turn-notify` namespace dictionaries for the Settings page.
 *
 * Chinese is the key-set source of truth; English mirrors it. Only copy that
 * the page renders lives here — notification text is built in the Host, whose
 * language follows the operating system locale.
 */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "turn-notify";
/** Simplified Chinese dictionary. */
export declare const zh: {
    nav: string;
    title: string;
    description: string;
    needsInput: string;
    needsInputHint: string;
    turnCompleted: string;
    turnCompletedHint: string;
    turnProblems: string;
    turnProblemsHint: string;
    sound: string;
    soundHint: string;
    loading: string;
    missing: string;
    readOnly: string;
};
/** English dictionary. */
export declare const en: {
    nav: string;
    title: string;
    description: string;
    needsInput: string;
    needsInputHint: string;
    turnCompleted: string;
    turnCompletedHint: string;
    turnProblems: string;
    turnProblemsHint: string;
    sound: string;
    soundHint: string;
    loading: string;
    missing: string;
    readOnly: string;
};
/** Translation key accepted by this page. */
export type TranslateKey = keyof typeof zh;
