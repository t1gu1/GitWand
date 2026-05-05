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
import es from "./es";
import ptBR from "./pt-BR";
import zhCN from "./zh-CN";

export type SupportedLocale = "en" | "fr" | "es" | "pt-BR" | "zh-CN";

export const locales: Record<SupportedLocale, Locale> = {
  en,
  fr,
  es,
  "pt-BR": ptBR,
  "zh-CN": zhCN,
};

/** Human-readable labels for the settings UI. */
export const localeLabels: Record<SupportedLocale, string> = {
  en: "English",
  fr: "Fran\u00e7ais",
  es: "Espa\u00f1ol",
  "pt-BR": "Portugu\u00eas (Brasil)",
  "zh-CN": "\u7b80\u4f53\u4e2d\u6587",
};

export const supportedLocales = Object.keys(locales) as SupportedLocale[];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/**
 * Detect the best locale from the browser / OS language.
 *
 * Tries in order:
 *   1. Exact regional match (normalized): "zh-CN" → "zh-CN", "pt-BR" → "pt-BR".
 *   2. Primary-tag match: "fr-FR" → "fr", "es-MX" → "es".
 *   3. Fallback to DEFAULT_LOCALE.
 *
 * Regional codes are normalized to <lang-lower>-<region-upper> so that
 * "zh-cn" or "ZH-CN" both match the "zh-CN" key.
 */
export function detectLocale(): SupportedLocale {
  try {
    const raw = navigator.language;
    if (!raw) return DEFAULT_LOCALE;

    // 1. Try full regional tag, normalized ("zh-cn" -> "zh-CN")
    const [langRaw, regionRaw] = raw.split("-");
    if (langRaw && regionRaw) {
      const normalized = `${langRaw.toLowerCase()}-${regionRaw.toUpperCase()}`;
      if (normalized in locales) return normalized as SupportedLocale;
    }

    // 2. Fall back to primary subtag ("fr-FR" -> "fr")
    const primary = langRaw?.toLowerCase();
    if (primary && primary in locales) return primary as SupportedLocale;
  } catch {
    // SSR or no navigator
  }
  return DEFAULT_LOCALE;
}

export { type Locale, type LocaleKey } from "./en";
