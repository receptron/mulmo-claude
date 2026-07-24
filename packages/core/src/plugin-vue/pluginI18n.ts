// Factory for a plugin's OWN vue-i18n instance — fully self-contained, sharing no
// i18n resources with the host. A plugin can't import another plugin, so the
// construction the accounting + collection plugins used to duplicate lives here;
// each plugin keeps only its message maps, its locale binding, and its public
// composable name. NOT convertible to gui-chat-protocol/vue's `createUseT`: these
// instances are driven by host bindings, not the PLUGIN_RUNTIME_KEY runtime.

import { createI18n } from "vue-i18n";
import { effectScope, watchEffect } from "vue";

// A single-signature builder so `typeof buildPluginI18n<M>` is a legal type query:
// `typeof createI18n<[M], string, false>` itself is rejected — tsc checks explicit
// type args against createI18n's FIRST overload (`Legacy extends boolean` comes
// first there) instead of skipping to the schema-first overload a value call picks.
const buildPluginI18n = <M>(messages: Record<string, M>) =>
  createI18n<[M], string, false>({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    messages,
  });

type PluginI18nGlobal<M> = ReturnType<typeof buildPluginI18n<M>>["global"];

/** What the composable returns — a drop-in for vue-i18n's `useI18n()`,
 *  destructured at the call site: `t` reads the plugin's keys, `locale` is the
 *  reactive tag for date/number formatting. */
export interface PluginI18n<M> {
  t: PluginI18nGlobal<M>["t"];
  locale: PluginI18nGlobal<M>["locale"];
}

const onceRetryable = (wire: () => void): (() => void) => {
  const state = { wired: false };
  return () => {
    if (state.wired) return;
    wire();
    // Flip the flag only after the wiring succeeds — if the first locale read
    // throws (e.g. the binding isn't configured yet), a later call can retry
    // rather than being locked out forever.
    state.wired = true;
  };
};

/** Build a plugin's self-contained vue-i18n instance and return its composable.
 *  The locale mirror runs in a detached effect scope so it lives for the app's
 *  lifetime rather than a single component's, and is wired lazily on the
 *  composable's first call — by then the host has configured the binding, so
 *  `localeSource()` resolves. */
export function createPluginI18n<M>(messages: Record<string, M>, localeSource: () => string): () => PluginI18n<M> {
  const i18n = buildPluginI18n(messages);
  const syncScope = effectScope(true);
  const ensureLocaleSync = onceRetryable(() => {
    syncScope.run(() => {
      watchEffect(() => {
        i18n.global.locale.value = localeSource();
      });
    });
  });
  return () => {
    ensureLocaleSync();
    return { t: i18n.global.t, locale: i18n.global.locale };
  };
}
