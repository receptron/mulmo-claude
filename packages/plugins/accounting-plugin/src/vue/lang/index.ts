// The accounting plugin's OWN vue-i18n instance — fully self-contained, sharing
// no i18n resources with the host. Components call `useAccountingI18n()` instead
// of vue-i18n's `useI18n()`, so the keys (`pluginAccounting.*`) stay identical —
// only the source changes.
//
// The active locale is fed through the AccountingHostContext binding
// (`hostLocaleTag()`), not gui-chat-protocol's PLUGIN_RUNTIME_KEY: the host
// injects it once at startup (the same DI seam as `apiCall` / `subscribe`), and
// createPluginI18n's detached, app-lifetime effect keeps this instance's locale
// in step with the host's — wired lazily on the first `useAccountingI18n()`, by
// which point the host has called `configureAccountingHost(...)`, so
// `hostLocaleTag()` resolves.

import { createPluginI18n } from "@mulmoclaude/core/plugin-vue/i18n";
import { hostLocaleTag } from "../hostContext";
import enMessages, { type AccountingMessages } from "./en";
import jaMessages from "./ja";
import zhMessages from "./zh";
import koMessages from "./ko";
import esMessages from "./es";
import ptBRMessages from "./ptBR";
import frMessages from "./fr";
import deMessages from "./de";

/** The plugin's i18n composable — a drop-in for vue-i18n's `useI18n()` over the
 *  plugin's own self-contained instance. Returns `{ t, locale }` (destructured at
 *  the call site, exactly like `useI18n()`), with `t` reading the plugin's keys
 *  and `locale` the reactive tag for date/number formatting. */
export const useAccountingI18n = createPluginI18n<AccountingMessages>(
  {
    en: enMessages,
    ja: jaMessages,
    zh: zhMessages,
    ko: koMessages,
    es: esMessages,
    "pt-BR": ptBRMessages,
    fr: frMessages,
    de: deMessages,
  },
  hostLocaleTag,
);
