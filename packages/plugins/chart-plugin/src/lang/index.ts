import { createUseT } from "gui-chat-protocol/vue";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import ptBR from "./ptBR";
import zh from "./zh";

// Keyed by the host's locale tag (matches MulmoClaude's src/lang/* set).
const MESSAGES = { de, en, es, fr, ja, ko, "pt-BR": ptBR, zh } as const;

// Reactive message table for the active locale, sourced from the host via
// gui-chat-protocol's BrowserPluginRuntime (PLUGIN_RUNTIME_KEY) — the same
// channel @mulmoclaude/form-plugin uses. Degrades to English when no host
// runtime is provided, so the package still renders standalone.
export const useT = createUseT(MESSAGES);
