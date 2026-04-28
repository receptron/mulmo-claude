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
import ptBRMessages from "../lang/pt-BR";
import frMessages from "../lang/fr";
import deMessages from "../lang/de";

// Schema generic on createI18n — this is what makes `t("common.save")`
// calls across the whole app compile-time checked (the module
// augmentation in src/types/vue-i18n.d.ts alone is not enough; vue-i18n
// v11's `t` overloads still fall back to `string` unless the schema is
// threaded through here).
type MessageSchema = typeof enMessages;
type Locale = "en" | "ja" | "zh" | "ko" | "es" | "pt-BR" | "fr" | "de";

const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ja", "zh", "ko", "es", "pt-BR", "fr", "de"] as const;
const DEFAULT_LOCALE: Locale = "en";

function isSupported(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

// Match the full tag first (so `pt-BR` resolves exactly), then collapse
// `ja-JP`, `ja-Hira-JP`, etc. to their primary subtag. Returns null when
// neither the full tag nor the primary subtag is supported.
function primarySubtagIfSupported(tag: string): Locale | null {
  if (isSupported(tag)) return tag;
  const lower = tag.toLowerCase();
  for (const supported of SUPPORTED_LOCALES) {
    if (supported.toLowerCase() === lower) return supported;
  }
  const [primary] = lower.split("-");
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
  messages: {
    en: enMessages,
    ja: jaMessages,
    zh: zhMessages,
    ko: koMessages,
    es: esMessages,
    "pt-BR": ptBRMessages,
    fr: frMessages,
    de: deMessages,
  },
});

export default i18n;
