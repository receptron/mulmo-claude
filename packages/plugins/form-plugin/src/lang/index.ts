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

// Reactive message table for the active locale. The host provides the locale via
// gui-chat-protocol's BrowserPluginRuntime (PLUGIN_RUNTIME_KEY), the same channel
// the rest of the @gui-chat-plugin family uses. When no host runtime is provided
// (a host that hasn't wired the scoped runtime yet), we degrade gracefully to
// English instead of throwing, so the package still renders standalone.
export const useT = createUseT(MESSAGES);
