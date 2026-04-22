// vue-i18n setup.
//
// Locale resolution priority (highest → lowest):
//   1. `VITE_LOCALE` env var — explicit build-time / dev override
//      (e.g. `VITE_LOCALE=ja yarn dev`)
//   2. Browser language list (`navigator.languages` falling back to
//      `navigator.language`) — the browser inherits this from the OS,
//      so Japanese-machine users get Japanese automatically without
//      extra config. First entry that matches a supported locale wins.
//   3. Hard default `"en"`
//
// Language tags like `"ja-JP"` are matched by primary subtag, so
// `ja-JP`, `ja-Hira-JP`, etc. all collapse to `"ja"`. Unknown tags
// (`"fr-FR"`) skip to the next candidate.
//
// `legacy: false` switches vue-i18n to the Composition API mode, so
// components call `const { t } = useI18n()` instead of relying on
// the Options API `this.$t`. CLAUDE.md mandates Composition API.

import { createI18n } from "vue-i18n";
import enMessages from "../lang/en";
import jaMessages from "../lang/ja";
import zhMessages from "../lang/zh";
import koMessages from "../lang/ko";
import esMessages from "../lang/es";

// Schema generic on createI18n — this is what makes `t("common.save")`
// calls across the whole app compile-time checked (the module
// augmentation in src/types/vue-i18n.d.ts alone is not enough; vue-i18n
// v11's `t` overloads still fall back to `string` unless the schema is
// threaded through here).
type MessageSchema = typeof enMessages;
type Locale = "en" | "ja" | "zh" | "ko" | "es";

const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ja"] as const;
const DEFAULT_LOCALE: Locale = "en";

function isSupported(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

// Collapse `ja-JP`, `ja-Hira-JP`, etc. to `ja`. Returns null when the
// primary subtag isn't one we support.
function primarySubtagIfSupported(tag: string): Locale | null {
  const primary = tag.toLowerCase().split("-")[0];
  return isSupported(primary) ? primary : null;
}

function detectLocale(): Locale {
  // 1. explicit env override
  const envLocale = import.meta.env.VITE_LOCALE;
  if (typeof envLocale === "string" && isSupported(envLocale)) {
    return envLocale;
  }

  // 2. browser / OS preference list
  if (typeof navigator !== "undefined") {
    const preferred = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
    for (const tag of preferred) {
      if (typeof tag !== "string") continue;
      const match = primarySubtagIfSupported(tag);
      if (match) return match;
    }
  }

  // 3. hard default
  return DEFAULT_LOCALE;
}

const locale = detectLocale();

const i18n = createI18n<[MessageSchema], Locale>({
  legacy: false,
  locale,
  fallbackLocale: "en",
  messages: { en: enMessages, ja: jaMessages, zh: zhMessages, ko: koMessages, es: esMessages },
});

export default i18n;
