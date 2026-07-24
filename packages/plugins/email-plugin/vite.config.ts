import dts from "vite-plugin-dts";
import { createServerPluginConfig, SERVER_DTS_OPTIONS } from "../../../scripts/lib/pluginViteConfig";

// Server-only plugin (v1): one entry, no Vue View yet. Mirrors
// the externals strategy from edgar-plugin / bookmarks-plugin —
// `gui-chat-protocol` and `zod` are bundled inline so the runtime
// loader can extract the published tarball into a cache dir
// without needing the user to `npm install` peer deps.
//
// While this plugin is devOnly (#1542), the preset loader
// resolves it via the yarn-workspace symlink and the imap /
// smtp / mime-parsing libs are hoisted into the repo's
// node_modules — leave them external so we don't pay the
// ESM-bundling-CJS interop cost (mailparser → libmime →
// iconv has CJS class-extends chains that explode when
// inlined). When we publish via npm, the libs will need to
// travel with the tarball — either as real `dependencies`
// (npm install hoists them at the consumer) or as a future
// bundled build once the CJS interop is properly solved.
export default createServerPluginConfig({
  plugins: [dts(SERVER_DTS_OPTIONS)],
  external: [/^node:/, "imapflow", "nodemailer", "mailparser"],
});
