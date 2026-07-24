import dts from "vite-plugin-dts";
import { createServerPluginConfig, SERVER_DTS_OPTIONS } from "../../../scripts/lib/pluginViteConfig";

// Server-only plugin: one entry, no Vue. `gui-chat-protocol` and `zod`
// are inlined (same strategy as edgar-plugin) so the bundled
// `dist/index.js` resolves when the runtime loader extracts a tarball
// without node_modules. `@mulmoclaude/core` stays external — it is a
// real dependency the host always ships, and inlining it would fork
// the token-store state away from the host's copy.
export default createServerPluginConfig({
  plugins: [dts(SERVER_DTS_OPTIONS)],
  external: [/^node:/, /^@mulmoclaude\/core/],
});
