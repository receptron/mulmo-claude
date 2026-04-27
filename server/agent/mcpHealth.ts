// Pre-flight check for stdio MCP servers wired up via `npx -y <pkg>`.
//
// Background: catalog entries (or hand-edited mcp.json entries) pin a
// community npm package by name. If the package doesn't exist on the
// registry — e.g. a TODO(reviewer) was never resolved before merge —
// `npx -y <missing-pkg>` returns 404 and the MCP server silently
// fails to start. From the agent's perspective the tool just isn't
// available, so Claude falls back to whatever generic tool (usually
// `WebSearch`) covers the same domain — confusing for the user who
// can see the entry as "enabled" in Settings.
//
// This module runs fire-and-forget per agent invocation, hits
// `npm view <pkg>` in a child process (cached after first lookup),
// and emits a single `log.warn` for each entry whose package isn't
// resolvable. We don't block the spawn — the warn is the only
// product. Cache lifetime is the server process; restart to re-check.
//
// Cache strategy (after #874 follow-up):
//   - In-flight Promise is cached so concurrent agent spawns share
//     one `npm view` per package, not N.
//   - Only confident outcomes ("exists" / "missing") are memoized.
//     Transient failures (timeout, killed process, network error)
//     throw from the prober; checkNpmPackage catches the throw,
//     returns "exists" so we don't false-positive the warn, and does
//     NOT cache, so a healthy probe later writes the real verdict.

import { spawn } from "node:child_process";
import type { McpServerSpec } from "../../src/config/mcpTypes.js";
import { log } from "../system/logger/index.js";

const NPM_VIEW_TIMEOUT_MS = 5_000;

export type NpmProbeResult = "exists" | "missing";

// Injectable seam so unit tests can drive checkNpmPackage / validateStdioPackages
// without spawning real `npm view` subprocesses. A prober may throw to
// signal an ambiguous failure that should NOT pollute the cache.
export type NpmProber = (pkg: string) => Promise<NpmProbeResult>;

const inFlightProbes = new Map<string, Promise<NpmProbeResult>>();
const resolvedProbes = new Map<string, NpmProbeResult>();

// Resolve the npm package name from a stdio spec when the command is
// `npx [-y] <pkg>` or similar. Strips an optional `@version` suffix
// (`spotify-mcp@latest` → `spotify-mcp`, `@scope/pkg@1.0` → `@scope/pkg`).
// Returns null when the command isn't recognisably an npx invocation.
export function extractNpxPackage(command: string, args?: readonly string[]): string | null {
  // Accept any path ending in `/npx` (e.g. workspace-local node_modules) or the bare name.
  const looksLikeNpx = command === "npx" || command.endsWith("/npx") || command.endsWith("\\npx");
  if (!looksLikeNpx) return null;
  if (!args || args.length === 0) return null;
  let pkg: string | undefined;
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    pkg = arg;
    break;
  }
  if (!pkg) return null;
  // Strip @version suffix. lastIndexOf because scoped packages start with @.
  const versionAt = pkg.lastIndexOf("@");
  if (versionAt > 0) return pkg.substring(0, versionAt);
  return pkg;
}

// Default npm-backed prober. Distinguishes three outcomes:
//   1. Process exited with code 0          → resolves "exists"
//   2. Process exited non-zero AND stderr matches a 404 npm error
//                                          → resolves "missing"
//   3. Anything else (timeout, kill, spawn error, ambiguous exit)
//                                          → REJECTS so checkNpmPackage
//                                            can decline to cache the
//                                            ambiguous verdict.
//
// Treating ambiguity as a rejection (rather than a fake "exists")
// keeps the public contract honest: consumers always see a confident
// answer — either the cached outcome from a real probe, or the
// fallback "exists" assigned by checkNpmPackage's catch handler.
function defaultNpmProbe(pkg: string): Promise<NpmProbeResult> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let stderr = "";
    const proc = spawn("npm", ["view", pkg, "name"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error(`npm view ${pkg} timed out after ${NPM_VIEW_TIMEOUT_MS}ms`));
    }, NPM_VIEW_TIMEOUT_MS);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) return; // reject already fired above
      if (code === 0) {
        resolve("exists");
        return;
      }
      // npm signals a not-found package via E404 in stderr (e.g.
      // `npm error code E404`, `npm error 404 Not Found - GET …`).
      // Anything else (network error, registry 5xx, auth failure)
      // is transient — bubble up as a rejection.
      if (code !== null && /\bE404\b/.test(stderr)) {
        resolve("missing");
        return;
      }
      reject(new Error(`npm view ${pkg} exited ambiguously: code=${String(code)} stderr=${stderr.slice(0, 200)}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      reject(err);
    });
  });
}

export async function checkNpmPackage(pkg: string, prober: NpmProber = defaultNpmProbe): Promise<NpmProbeResult> {
  const cached = resolvedProbes.get(pkg);
  if (cached !== undefined) return cached;
  const pending = inFlightProbes.get(pkg);
  if (pending) return pending;
  const probe = (async () => {
    try {
      const result = await prober(pkg);
      resolvedProbes.set(pkg, result);
      return result;
    } catch {
      // Ambiguous failure (timeout / network / spawn). Don't cache
      // — the next call gets a fresh probe. Default to "exists" so
      // callers don't false-positive a warn.
      return "exists" as const;
    }
  })().finally(() => inFlightProbes.delete(pkg));
  inFlightProbes.set(pkg, probe);
  return probe;
}

// Walk every enabled stdio server, extract the npx package name, and
// log a warn for any that resolve 404. Fire-and-forget: callers ignore
// the returned promise.
export async function validateStdioPackages(userServers: Record<string, McpServerSpec>, prober: NpmProber = defaultNpmProbe): Promise<void> {
  const checks: Promise<void>[] = [];
  for (const [serverId, spec] of Object.entries(userServers)) {
    if (spec.type !== "stdio") continue;
    if (spec.enabled === false) continue;
    const pkg = extractNpxPackage(spec.command, spec.args);
    if (!pkg) continue;
    checks.push(
      checkNpmPackage(pkg, prober).then((status) => {
        if (status === "missing") {
          log.warn("mcp", "stdio package not found on npm — server will fail to spawn", {
            serverId,
            package: pkg,
          });
        }
      }),
    );
  }
  await Promise.all(checks);
}

// Test-only: reset cache state between unit-test cases so they don't
// observe each other's results.
export function _resetMcpHealthCacheForTest(): void {
  inFlightProbes.clear();
  resolvedProbes.clear();
}
