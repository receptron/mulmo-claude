// Module augmentation for vue-i18n. Surfaces the English dictionary
// shape as `DefineLocaleMessage` so IDEs autocomplete key paths on
// `$t("…")` and `i18n.global.t("…")`. The schema generic on
// createI18n (src/lib/vue-i18n.ts) handles the `useI18n()` side.
//
// Caveat: vue-i18n v11's `t()` overload has a `Key extends string`
// fallback, so a typo in `useI18n().t("…")` at a deeply-typed call
// site may still compile. Autocomplete is the main value; strict
// rejection of unknown keys would require a bespoke wrapper.

import en from "../lang/en";

// Alias so `extends` has an interface-shaped base (typeof in extends
// position is a syntax error).
type EnMessages = typeof en;

declare module "vue-i18n" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefineLocaleMessage extends EnMessages {}
}
