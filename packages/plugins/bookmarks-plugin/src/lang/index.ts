// Plugin-local i18n (#1110): translation tables travel with the
// plugin bundle, no merge into the host vue-i18n. The plugin reads
// the host's locale via `useRuntime()` and looks up its own table
// reactively.
//
// Future plugins that need vue-i18n features (plural forms, linked
// messages) can spin up their own `createI18n()` instance instead.

import { createUseT } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;

export const useT = createUseT(MESSAGES);
