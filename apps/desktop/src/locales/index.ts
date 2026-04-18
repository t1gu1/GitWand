/**
 * GitWand — Locale registry
 *
 * To add a new language:
 * 1. Copy en.ts → xx.ts, translate all values
 * 2. Import it here and add to `locales`
 * 3. Add a label in `localeLabels`
 *
 * TypeScript ensures every new locale has the exact same keys as en.ts.
 */
import type { Locale } from "./en";
import en from "./en";
import fr from "./fr";

export type SupportedLocale = "en" | "fr";

export const locales: Record<SupportedLocale, Locale> = { en, fr };

/** Human-readable labels for the settings UI. */
export const localeLabels: Record<SupportedLocale, string> = {
  en: "English",
  fr: "Fran\u00e7ais",
};

export const supportedLocales = Object.keys(locales) as SupportedLocale[];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/**
 * Detect the best locale from the browser / OS language.
 * navigator.language → "fr-FR" → "fr" → match or fallback.
 */
export function detectLocale(): SupportedLocale {
  try {
    const lang = navigator.language?.substring(0, 2)?.toLowerCase();
    if (lang && lang in locales) return lang as SupportedLocale;
  } catch {
    // SSR or no navigator
  }
  return DEFAULT_LOCALE;
}

export { type Locale, type LocaleKey } from "./en";
