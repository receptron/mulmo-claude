import dts from "vite-plugin-dts";
import { createServerPluginConfig, SERVER_DTS_OPTIONS } from "../../../scripts/lib/pluginViteConfig";

// Server-only plugin: one entry, no Vue. Mirrors the externals
// strategy from packages/plugins/bookmarks-plugin/vite.config.ts —
// `gui-chat-protocol` (the identity `definePlugin` helper) and
// `zod` are inlined so the bundled `dist/index.js` resolves
// cleanly when the runtime loader extracts the tarball into a
// cache dir without node_modules.
export default createServerPluginConfig({
  plugins: [dts(SERVER_DTS_OPTIONS)],
  external: ["node:os", "node:url"],
});
