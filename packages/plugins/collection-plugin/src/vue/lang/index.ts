// The collection plugin's OWN vue-i18n instance — fully self-contained, sharing
// no i18n resources with the host. Components call `useCollectionI18n()` instead
// of vue-i18n's `useI18n()`, so the keys (`collectionsView.*`, `common.*`) stay
// identical — only the source changes.
//
// The active locale is fed through the CollectionUi binding (`localeTag()`), not
// gui-chat-protocol's PLUGIN_RUNTIME_KEY: the collection pages mount both inside
// chat (where the runtime exists) AND on standalone routes (where it doesn't),
// and the binding is available in both. createPluginI18n's detached, app-lifetime
// effect keeps this instance's locale in step with the host's — wired lazily on
// the first `useCollectionI18n()`, by which point App.vue's setup has configured
// the binding, so `collectionUi()` resolves.

import { createPluginI18n } from "@mulmoclaude/core/plugin-vue/i18n";
import { collectionUi } from "../uiContext";
import enMessages, { type CollectionMessages } from "./en";
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
export const useCollectionI18n = createPluginI18n<CollectionMessages>(
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
  () => collectionUi().localeTag(),
);
