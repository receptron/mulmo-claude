// Plugin-local i18n — bookmarks/todo と同じ pattern。

import { createUseT } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;

export const useT = createUseT(MESSAGES);
