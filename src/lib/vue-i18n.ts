// vue-i18n setup.
//
// Locale is picked at build-time from the `VITE_LOCALE` env var
// (falls back to "en"). Use `VITE_LOCALE=ja yarn dev` to switch.
// There's no runtime locale selector yet — follow-up work will add
// one if needed.
//
// `legacy: false` switches vue-i18n to the Composition API mode, so
// components call `const { t } = useI18n()` instead of relying on
// the Options API `this.$t`. CLAUDE.md mandates Composition API.

import { createI18n } from "vue-i18n";
import enMessages from "../lang/en";
import jaMessages from "../lang/ja";

// Schema generic on createI18n — this is what makes `t("common.save")`
// calls across the whole app compile-time checked (the module
// augmentation in src/types/vue-i18n.d.ts alone is not enough; vue-i18n
// v11's `t` overloads still fall back to `string` unless the schema is
// threaded through here).
type MessageSchema = typeof enMessages;
type Locale = "en" | "ja";

const locale = (import.meta.env.VITE_LOCALE ?? "en") as Locale;

const i18n = createI18n<[MessageSchema], Locale>({
  legacy: false,
  locale,
  fallbackLocale: "en",
  messages: { en: enMessages, ja: jaMessages },
});

export default i18n;
