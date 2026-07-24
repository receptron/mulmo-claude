// Plugin-local i18n (#1110): translation tables travel with the
// plugin bundle, no merge into the host vue-i18n. The plugin reads
// the host's locale via `useRuntime()` and looks up its own table
// reactively.

import { createUseT } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;

export const useT = createUseT(MESSAGES);

/** Substitute `{key}` placeholders in a translated string with caller
 *  values. Lightweight stand-in for vue-i18n's interpolation since the
 *  plugin doesn't pull in vue-i18n. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`;
  });
}
