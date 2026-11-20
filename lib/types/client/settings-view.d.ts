/**
 * Settings page for the notification switches.
 *
 * The page does not store anything itself: it reads and writes the projected
 * configuration form, so a change lands in the profile patch and the Host's
 * live fields pick it up in place. That is also why the page works when the
 * plugin is toggled off and says so instead of guessing.
 */
import { type ReactElement } from 'react';
import { type NamespaceView } from './namespace.ts';
import type { TranslateKey } from './locales.ts';
/** Local translate function. */
type Translate = (key: TranslateKey) => string;
/** The value half of a configuration form snapshot (only what we read). */
export interface FormSnapshot {
    readonly status?: 'loading' | 'ready' | 'unavailable';
    readonly value?: unknown;
    readonly writable?: boolean;
}
/** One entry's configuration form controller. */
export interface ConfigFormLike {
    getSnapshot(): FormSnapshot;
    subscribe(listener: () => void): () => void;
    set(field: string, value: boolean): unknown;
}
/** The settings describe mirror. */
export interface DescribeLike {
    getSnapshot(): {
        readonly view?: {
            readonly namespaces?: readonly NamespaceView[];
        };
    };
    subscribe(listener: () => void): () => void;
}
/** The client `configForms` service face. */
export interface ConfigFormsLike {
    describe(): DescribeLike;
    get(ns: string): ConfigFormLike;
}
/** Props the slot registration injects. */
export interface NotifySectionProps {
    readonly forms: ConfigFormsLike;
    readonly t: Translate;
}
/** The settings section: resolves the form, then renders the switches. */
export declare function NotifySection({ forms, t }: NotifySectionProps): ReactElement;
export {};
