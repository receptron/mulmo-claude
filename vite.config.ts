import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Token file path mirrors `WORKSPACE_PATHS.sessionToken` in
// server/workspace-paths.ts. Duplicated here (rather than imported)
// because Vite config runs outside the TS server tsconfig; keep in
// sync when either side moves the workspace root.
const TOKEN_FILE_PATH = path.join(os.homedir(), 'mulmoclaude', '.session-token')
const TOKEN_PLACEHOLDER = '__MULMOCLAUDE_AUTH_TOKEN__'

// Dev-side half of the bearer-token injection (#272). The server
// writes the token to `TOKEN_FILE_PATH` at startup (mode 0600); this
// plugin reads that file on every index.html request and substitutes
// it into the `<meta name="mulmoclaude-auth" content="...">` tag.
//
// **Fallback**: if the file is missing (server not running, E2E with
// mocked API, `yarn dev:client` alone), we inject an empty string.
// Vue boot code reads an empty token as "no auth" and every real
// request 401s — that matches the dev ergonomics we want (no silent
// fake token). E2E tests never reach the real server (mocks), so they
// don't care about the header value.
function readDevToken(): string {
  // Env var takes precedence over the workspace file. This is the
  // escape hatch for (a) E2E tests that spawn `yarn dev:client`
  // without a running server (playwright.config.ts sets it), and
  // (b) future debugging / alternative dev workflows. Production
  // never reads env — Express is always the source of truth there.
  const fromEnv = process.env.MULMOCLAUDE_AUTH_TOKEN
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  try {
    return fs.readFileSync(TOKEN_FILE_PATH, 'utf-8').trim()
  } catch {
    return ''
  }
}

function mulmoclaudeAuthTokenPlugin(): Plugin {
  return {
    name: 'mulmoclaude-auth-token',
    // **Dev only.** In production the built index.html keeps the
    // placeholder; Express substitutes it per-request when serving
    // the file (see `server/index.ts` prod static handler). If this
    // plugin ran at build time too, the placeholder would be baked
    // out to whatever value the builder happened to see — wrong for
    // every subsequent user.
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(TOKEN_PLACEHOLDER, readDevToken())
    },
  }
}

// Runtime-plugin importmap rewrite for production builds (#1043 C-2
// Phase E). The dev importmap maps `"vue"` → `/src/_runtime/vue.ts`,
// which Vite serves transformed and resolves to the host's Vue dep.
// In `vite build` that dev URL no longer exists — Vite emits a
// hashed asset for the runtime/vue chunk. This plugin (build-only)
// finds the hashed filename in the bundle and rewrites the
// importmap target so runtime-loaded plugins still share the host's
// Vue instance after `yarn build` and `npx mulmoclaude` distribution.
function runtimeImportmapBuildPlugin(): Plugin {
  const DEV_IMPORTMAP_TARGET = '/src/_runtime/vue.ts'
  return {
    name: 'mulmoclaude-runtime-importmap',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        // The runtime/vue.ts entry input is registered in
        // `build.rollupOptions.input` below; Vite emits it as a
        // chunk whose `name` matches the input key.
        let runtimeFile: string | null = null
        for (const [fileName, chunk] of Object.entries(ctx.bundle)) {
          if (chunk.type === 'chunk' && chunk.name === 'runtime-vue') {
            runtimeFile = fileName
            break
          }
        }
        if (!runtimeFile) return html
        // `replaceAll` (not `replace`) so both occurrences get
        // rewritten — the importmap target AND the comment that
        // documents where the dev URL lives. Otherwise `replace`
        // only handles the first match (the comment, which precedes
        // the importmap), and the actual `<script type="importmap">`
        // body keeps the broken dev URL.
        return html.replaceAll(DEV_IMPORTMAP_TARGET, `/${runtimeFile}`)
      },
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), mulmoclaudeAuthTokenPlugin(), runtimeImportmapBuildPlugin()],
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      // `index.html` is the SPA entry. `runtime-vue` is a side-entry
      // that emits a separate chunk for the runtime importmap target
      // (#1043 C-2 Phase E). Without it as an explicit input, Vite
      // would tree-shake `src/_runtime/vue.ts` to nothing because no
      // build-time `import` references it — the importmap is consumed
      // by the BROWSER, not by Vite's static analysis.
      input: {
        index: path.resolve(__dirname, 'index.html'),
        'runtime-vue': path.resolve(__dirname, 'src/_runtime/vue.ts'),
      },
      // Force every named re-export from `src/_runtime/vue.ts` to be
      // preserved in the emitted chunk. Without `'strict'`, Rolldown
      // tree-shakes the `export * from "vue"` re-exports (no static
      // consumer in the build references them — the browser does,
      // via the runtime importmap), shrinking the chunk to a 46-byte
      // side-effect stub. A runtime-loaded plugin's
      // `import { createCommentVNode } from "vue"` then fails with
      // "does not provide an export named 'createCommentVNode'".
      // `'strict'` is the public-library mode and matches what we
      // want here: the entry's exports ARE the public surface for
      // browser-side consumers.
      preserveEntrySignatures: 'strict',
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      // Static-mount on the backend (server/index.ts: app.use('/artifacts/images', ...)).
      // Without this proxy, dev's Vite catch-all returns the SPA index.html instead.
      '/artifacts/images': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      // Static-mount on the backend (server/index.ts: app.use('/artifacts/html', ...)).
      // Without this proxy, Vite's HTML transform injects `/@vite/client` and
      // `/src/main.ts` into the response, which the iframe (opaque origin) then
      // tries to load and the browser blocks via CORS. Forwarding to Express
      // returns the file untouched plus the CSP HTTP header.
      //
      // `xfwd: true` adds `X-Forwarded-Host` / `X-Forwarded-Proto` so Express
      // can recover the browser-visible origin (`localhost:5173`) when emitting
      // the CSP `img-src` directive. `changeOrigin: true` rewrites `Host` to
      // the upstream `localhost:3001`, so without xfwd the CSP would advertise
      // the wrong origin and Safari would block every `<img src="../images/...">`
      // request (Chrome happens to be lenient because images route through the
      // same proxy).
      '/artifacts/html': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        xfwd: true
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
})
