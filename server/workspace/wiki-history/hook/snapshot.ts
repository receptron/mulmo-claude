// PostToolUse hook source — runs after every Claude CLI Write /
// Edit tool call. Detects writes that target a wiki page file
// and POSTs `{ slug, sessionId? }` to the parent server's
// `/api/wiki/internal/snapshot` endpoint so the snapshot pipeline
// (#763 PR 2) records the new state.
//
// THIS FILE IS THE SOURCE OF TRUTH. Edits here, then run
// `yarn build:hooks` (or `yarn build`) to regenerate
// `./snapshot.mjs`. The bundled `.mjs` is committed to git so
// `provision.ts` can read it at server startup without invoking
// esbuild on the runtime path. CI runs `yarn build:hooks &&
// git diff --exit-code` to catch a stale bundle.
//
// The hook executes inside Claude CLI's process space — must be
// self-contained ESM. esbuild bundles imports from the shared
// `src/lib/wiki-page/slug.ts` module so the hook and the
// server-side `classifyAsWikiPage` agree on what counts as a
// wiki page (no copy-paste drift).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { wikiSlugFromAbsPath } from "../../../../src/lib/wiki-page/slug.js";

// Workspace layout matches `WORKSPACE_DIRS.wikiPages`. We hard-
// code "data/wiki/pages" rather than importing the constants
// because the hook needs to stay independent of the server's
// runtime config — the bundle must work even when the server
// process isn't running yet (e.g. during a startup race).
const WORKSPACE_ROOT = path.join(homedir(), "mulmoclaude");
const WIKI_PAGES_DIR = path.join(WORKSPACE_ROOT, "data", "wiki", "pages");
const TOKEN_PATH = path.join(WORKSPACE_ROOT, ".session-token");
const PORT_PATH = path.join(WORKSPACE_ROOT, ".server-port");
// In Docker mode the parent server runs on the host's 127.0.0.1
// which the container can't reach via plain loopback. The Docker
// spawn plumbing sets MULMOCLAUDE_HOST=host.docker.internal so
// fetch() resolves to the host server. Outside Docker (or when
// the var is unset) we fall back to the loopback address.
const SERVER_HOST = process.env.MULMOCLAUDE_HOST ?? "127.0.0.1";

interface HookPayload {
  tool_input?: { file_path?: unknown };
  tool_response?: { filePath?: unknown };
  session_id?: unknown;
}

async function readStdin(): Promise<HookPayload | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return null;
  }
}

function extractFilePath(payload: HookPayload): string | null {
  // Claude CLI hook payload: { tool_name, tool_input, tool_response, ... }
  // Different tools surface the path under different keys —
  // check both shapes defensively.
  const fromInput = payload.tool_input?.file_path;
  if (typeof fromInput === "string") return fromInput;
  const fromResponse = payload.tool_response?.filePath;
  if (typeof fromResponse === "string") return fromResponse;
  return null;
}

function readTokenSafe(): string {
  try {
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}

function readPortSafe(): number | null {
  try {
    const raw = readFileSync(PORT_PATH, "utf-8").trim();
    const port = Number.parseInt(raw, 10);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const payload = await readStdin();
  if (!payload) return;

  const filePath = extractFilePath(payload);
  if (!filePath) return;
  const slug = wikiSlugFromAbsPath(filePath, WIKI_PAGES_DIR);
  if (slug === null) return;

  const token = readTokenSafe();
  const port = readPortSafe();
  if (!token || port === null) return; // server isn't reachable; silent no-op

  // Prefer our chat-session id from the spawn env (#963) — the
  // server's session store keys by chatSessionId, not by Claude
  // CLI's internal session_id, so the toolResult publish on the
  // server side only matches when we forward our own id. Fall back
  // to Claude CLI's `session_id` (still useful as a tracing token
  // in the snapshot frontmatter) when the env var is absent — e.g.
  // an older mulmoclaude server spawning a newer hook bundle.
  const envChatSessionId = process.env.MULMOCLAUDE_CHAT_SESSION_ID;
  const payloadSessionId = typeof payload.session_id === "string" && payload.session_id.length > 0 ? payload.session_id : undefined;
  const sessionId = envChatSessionId && envChatSessionId.length > 0 ? envChatSessionId : payloadSessionId;
  const body = sessionId === undefined ? { slug } : { slug, sessionId };

  try {
    await fetch(`http://${SERVER_HOST}:${port}/api/wiki/internal/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network / server down — drop silently. The wiki page write
    // itself already succeeded; missing one snapshot is recoverable
    // (the next save will record the next state).
  }
}

main().catch(() => {
  // Hooks run synchronously to the LLM tool flow — never throw.
  // A busted hook would make `Write` itself look like it failed
  // to the LLM, which is much worse than a missing snapshot.
});
