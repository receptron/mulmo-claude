import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Pass 1 — the CJS-safe subsystems, dual ESM+CJS (no import.meta.url in these
// entries). One package, many subpath entries; each lands under dist/<subpath>/.
// Node built-ins are externalized; the @receptron/task-scheduler peer is provided
// by the host. The dts plugin emits declarations for ALL src (including the
// ESM-only workspace-setup built by vite.esm.config.ts), so this pass runs first
// and owns the dist cleanup.
export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: {
        // Browser-safe generic helpers (errorMessage / toError / truncate).
        // Host re-exports these instead of keeping its own copy (#2217).
        "utils/index": "src/utils/index.ts",
        // Browser-safe artifact path builders (slug + YYYY/MM partition + the
        // shared traversal guard) shared by the chart / html / mulmoscript
        // presentation plugins (#2405). No node built-ins so it bundles into
        // the plugins' browser (`./vue`) entries.
        "artifacts/paths": "src/artifacts/paths.ts",
        // Server-only atomic file I/O (tmp-write + rename, Windows retry) — the
        // single source of truth shared by host, core, and plugins (#2399).
        "files/index": "src/files/index.ts",
        // Server-only `fetchWithTimeout` (AbortController + timeout + caller-signal
        // composition). Own entry so `@mulmoclaude/core/fetch` stays independent of
        // the browser-safe `./utils` helpers. Host + registry + google share it (#2398).
        "utils/fetch": "src/utils/fetch.ts",
        "collection/index": "src/collection/index.ts",
        "collection/server/index": "src/collection/server/index.ts",
        "collection/paths": "src/collection/server/templatePath.ts",
        // The only collection entry that runtime-imports the firebase SDK.
        // Separate so the OPTIONAL `firebase` peer stays optional for every
        // consumer of `collection/server` (see that file's export note).
        "collection/firestore": "src/collection/firestore.ts",
        "collection/registry/index": "src/collection/registry/index.ts",
        "collection/registry/server/index": "src/collection/registry/server/index.ts",
        "wiki/index": "src/wiki/index.ts",
        "wiki/server/index": "src/wiki/server/index.ts",
        // Lightweight path helpers as their own entry (no js-yaml / engine)
        // so the hook sidecar can import `wikiSlugFromAbsPath` without
        // bundling the whole read-engine. Mirrors `collection/paths`.
        "wiki/paths": "src/wiki/server/paths.ts",
        "feeds/index": "src/feeds/index.ts",
        "feeds/server/index": "src/feeds/server/index.ts",
        "feeds/paths": "src/feeds/paths.ts",
        "collection-watchers/index": "src/collection-watchers/index.ts",
        "skill-bridge/index": "src/skill-bridge/index.ts",
        "file-change/index": "src/file-change/index.ts",
        "notifier/index": "src/notifier/index.ts",
        "scheduler/index": "src/scheduler/index.ts",
        "whisper/index": "src/whisper/index.ts",
        "whisper/client": "src/whisper/client.ts",
        "translation/client": "src/translation/client.ts",
        // Browser-safe Vue composables shared by plugin Views and the host
        // (useFileWatch / useMarkdownDoc / useClipboardCopy). `vue` +
        // `gui-chat-protocol/vue` are externalized so the plugin and host resolve
        // ONE instance (the injected PLUGIN_RUNTIME_KEY Symbol must match); `vue`
        // is an optional peer of core.
        "plugin-vue/index": "src/plugin-vue/index.ts",
        // Own entry, not part of the plugin-vue barrel: `vue-i18n` is an optional
        // peer, so only the plugins that drive their own i18n instance (accounting,
        // collection) should have to resolve it — barrel consumers must not.
        "plugin-vue/i18n": "src/plugin-vue/pluginI18n.ts",
        // Browser-safe remote custom-view contract (phase 3) — consumed by the
        // host server, the desktop phone-frame preview, and mulmoserver.
        "remote-view/index": "src/remote-view/index.ts",
        // Remote-host transport: the browser-safe command-channel protocol
        // (shared by host + mobile client) and the server-only host runner +
        // connect lifecycle + Firebase init/auth. `firebase` is a peer (below).
        "remote-host/index": "src/remote-host/index.ts",
        "remote-host/server/index": "src/remote-host/server/index.ts",
        // Server-only Google engine (local OAuth + token store + Calendar REST).
        "google/index": "src/google/index.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // @duckdb/node-api is a NATIVE module (prebuilt .node binding) — it can
      // never be bundled; iconv-lite rides along as its decode companion so a
      // downstream host resolves one consistent copy.
      external: [
        /^node:/,
        /^@receptron\//,
        /^@mulmoclaude\/markdown-utils/,
        /^firebase/,
        /^@duckdb\//,
        "iconv-lite",
        "zod",
        /^gui-chat-protocol/,
        "vue",
        "vue-i18n",
        "fast-xml-parser",
        "js-yaml",
        "google-auth-library",
      ],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
