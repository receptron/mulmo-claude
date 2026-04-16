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

export default defineConfig({
  plugins: [vue(), tailwindcss(), mulmoclaudeAuthTokenPlugin()],
  build: {
    outDir: 'dist/client',
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
})
