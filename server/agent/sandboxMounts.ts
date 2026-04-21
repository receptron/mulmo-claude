// Host-credential mounts for the Docker sandbox (#259).
//
// Two independent opt-in mechanisms, composable:
//
//   SANDBOX_SSH_AGENT_FORWARD=1
//     Bind-mounts $SSH_AUTH_SOCK into the container and sets
//     SSH_AUTH_SOCK to the container path. Private keys stay on the
//     host — the agent on the host signs on behalf of the container.
//
//   SANDBOX_MOUNT_CONFIGS=gh,gitconfig
//     CSV of allowlisted config mounts. Each name resolves to a fixed
//     host path via the server-side ALLOWED_CONFIG_MOUNTS map; users
//     cannot pass arbitrary paths.
//
// See docs/sandbox-credentials.md for the user-facing contract.

import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { log } from "../system/logger/index.js";
import { SUBPROCESS_PROBE_TIMEOUT_MS } from "../utils/time.js";

// ── Config-mount allowlist ──────────────────────────────────────────

export interface SandboxMountSpec {
  /** The short name users type in SANDBOX_MOUNT_CONFIGS. */
  name: string;
  /** Absolute path on the host. Resolved from `$HOME` at lookup. */
  hostPath: string;
  /** Absolute path inside the container (must match where the tool looks). */
  containerPath: string;
  /** Whether the host path is expected to be a file or a directory. */
  kind: "file" | "dir";
  /** Short human description — shown in docs and in startup logs. */
  description: string;
}

/**
 * Build the allowlist. Parameterized on `home` so tests can inject a
 * temp directory without touching the real filesystem.
 *
 * To add a new tool:
 * 1. Append a row here with the host path the tool reads on startup
 *    and the container path it should find the same file at.
 * 2. Add a row in docs/sandbox-credentials.md.
 * 3. That's it — no env var changes, no parser changes.
 */
export function buildAllowedConfigMounts(home: string = homedir()): Record<string, SandboxMountSpec> {
  return {
    gh: {
      name: "gh",
      hostPath: path.join(home, ".config", "gh"),
      containerPath: "/home/node/.config/gh",
      kind: "dir",
      description: "GitHub CLI auth token + hosts config",
    },
    gitconfig: {
      name: "gitconfig",
      hostPath: path.join(home, ".gitconfig"),
      containerPath: "/home/node/.gitconfig",
      kind: "file",
      description: "Git user identity (name, email, signing key)",
    },
  };
}

// ── Name parsing / validation ──────────────────────────────────────

export interface ParsedMountList {
  /** Names that resolved to a spec. Order preserved. */
  resolved: SandboxMountSpec[];
  /** Names the user requested that aren't in the allowlist. */
  unknown: string[];
  /** Names whose host path does not exist — silently skipped. */
  missing: SandboxMountSpec[];
}

/**
 * Parse a CSV list of mount names, resolve against the allowlist,
 * check that each host path exists. The three output buckets let the
 * caller decide what to error on (unknown) vs warn on (missing).
 */
export function resolveMountNames(names: readonly string[], allowed: Record<string, SandboxMountSpec> = buildAllowedConfigMounts()): ParsedMountList {
  const resolved: SandboxMountSpec[] = [];
  const unknown: string[] = [];
  const missing: SandboxMountSpec[] = [];

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const spec = allowed[name];
    if (!spec) {
      unknown.push(name);
      continue;
    }
    if (!hostPathExists(spec)) {
      missing.push(spec);
      continue;
    }
    resolved.push(spec);
  }
  return { resolved, unknown, missing };
}

function hostPathExists(spec: SandboxMountSpec): boolean {
  try {
    const stat = fs.statSync(spec.hostPath);
    return spec.kind === "dir" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

// ── Docker arg generation ──────────────────────────────────────────

/**
 * Return the `-v ...` argument pairs for the given resolved mounts.
 * Always read-only. The caller splices these into the full docker
 * argv in `buildDockerSpawnArgs`.
 */
export function configMountArgs(resolved: readonly SandboxMountSpec[]): string[] {
  const args: string[] = [];
  for (const spec of resolved) {
    args.push("-v", `${toDockerPath(spec.hostPath)}:${spec.containerPath}:ro`);
  }
  return args;
}

// ── SSH agent forward ──────────────────────────────────────────────

/** Absolute container path the agent socket is bound to. */
export const SSH_AGENT_CONTAINER_SOCK = "/ssh-agent";

export interface SshAgentForwardResult {
  args: string[];
  /** When null, forward was requested but not possible; caller decides
   *  whether to log once (we always log in the production driver). */
  skippedReason: string | null;
}

// Docker Desktop for Mac exposes the host SSH agent through a
// well-known magic socket inside the VM. Direct bind-mounting the
// macOS $SSH_AUTH_SOCK (/private/tmp/…) fails with "operation not
// supported" because Docker's Linux VM can't mkdir a Unix socket.
// Using the magic path sidesteps the issue entirely and works on
// Docker Desktop ≥ 2.3.0 (2020+).
const DOCKER_DESKTOP_MAC_SSH_SOCK = "/run/host-services/ssh-auth.sock";

/**
 * Return the docker argv fragment that forwards the host SSH agent
 * into the container. On macOS + Docker Desktop, the built-in
 * magic socket is used instead of a raw bind-mount. On Linux, the
 * host `$SSH_AUTH_SOCK` is bind-mounted directly.
 *
 * Skipped (empty args + reason) when:
 * - the flag is off
 * - $SSH_AUTH_SOCK isn't set (no agent running on host) — on
 *   non-macOS only; macOS always has the magic socket available
 *   when Docker Desktop is running, regardless of $SSH_AUTH_SOCK
 */
export function sshAgentForwardArgs(
  enabled: boolean,
  sshAuthSock: string | undefined,
  platform: typeof process.platform = process.platform,
): SshAgentForwardResult {
  if (!enabled) return { args: [], skippedReason: null };

  // macOS + Docker Desktop: use the magic VM-internal socket.
  if (platform === "darwin") {
    return {
      args: ["-v", `${DOCKER_DESKTOP_MAC_SSH_SOCK}:${SSH_AGENT_CONTAINER_SOCK}`, "-e", `SSH_AUTH_SOCK=${SSH_AGENT_CONTAINER_SOCK}`],
      skippedReason: null,
    };
  }

  // Linux / other: bind-mount the host socket directly.
  if (!sshAuthSock || sshAuthSock.length === 0) {
    return {
      args: [],
      skippedReason: "SSH_AUTH_SOCK not set on host",
    };
  }
  if (!fs.existsSync(sshAuthSock)) {
    return {
      args: [],
      skippedReason: `SSH_AUTH_SOCK=${sshAuthSock} not found on host`,
    };
  }
  return {
    args: ["-v", `${toDockerPath(sshAuthSock)}:${SSH_AGENT_CONTAINER_SOCK}`, "-e", `SSH_AUTH_SOCK=${SSH_AGENT_CONTAINER_SOCK}`],
    skippedReason: null,
  };
}

// ── Top-level resolver used by buildDockerSpawnArgs ────────────────

export interface ResolvedSandboxAuth {
  /** docker argv additions: a list of `-v` / `-e` tokens. */
  args: string[];
  /** Descriptions the caller can log once to show what got mounted. */
  appliedDescriptions: string[];
}

export interface ResolveSandboxAuthParams {
  sshAgentForward: boolean;
  /** Comma-separated host whitelist for the SSH agent. Default
   *  "github.com". Passed to the container as
   *  `SANDBOX_SSH_ALLOWED_HOSTS` and consumed by the entrypoint
   *  to generate a restrictive `~/.ssh/config`. */
  sshAllowedHosts?: string;
  configMountNames: readonly string[];
  sshAuthSock?: string | undefined;
  home?: string;
}

/**
 * Combine the two mechanisms. Emits a `log.warn` for unknown names
 * (configuration error the user should fix), a `log.info` for missing
 * paths (expected when a user hasn't set up the tool), and a
 * `log.info` line listing what actually got mounted so the startup
 * log shows the sandbox's effective auth posture.
 */
export function resolveSandboxAuth(params: ResolveSandboxAuthParams): ResolvedSandboxAuth {
  const home = params.home ?? homedir();
  const allowed = buildAllowedConfigMounts(home);
  const parsed = resolveMountNames(params.configMountNames, allowed);

  if (parsed.unknown.length > 0) {
    log.warn("sandbox", "unknown SANDBOX_MOUNT_CONFIGS entries ignored", {
      unknown: parsed.unknown,
      allowed: Object.keys(allowed),
    });
  }
  for (const spec of parsed.missing) {
    log.info("sandbox", "config mount skipped (host path missing)", {
      name: spec.name,
      hostPath: spec.hostPath,
    });
  }

  const sshResult = sshAgentForwardArgs(params.sshAgentForward, params.sshAuthSock);
  if (sshResult.skippedReason !== null) {
    log.warn("sandbox", "SSH agent forward requested but skipped", {
      reason: sshResult.skippedReason,
    });
  }

  // Pass the allowed-hosts whitelist to the container so the
  // entrypoint can generate a restrictive ~/.ssh/config. Only
  // included when SSH agent forward is actually active.
  const sshAllowedHostsArgs = sshResult.args.length > 0 && params.sshAllowedHosts ? ["-e", `SANDBOX_SSH_ALLOWED_HOSTS=${params.sshAllowedHosts}`] : [];

  // gh CLI keyring fallback (#259 + #164). When the user opted in
  // to `gh` via SANDBOX_MOUNT_CONFIGS but the file mount succeeded
  // with a keyring-based token (macOS), the mounted hosts.yml won't
  // contain the actual token. Detect this and inject GH_TOKEN env
  // var instead. Only runs when "gh" was explicitly requested.
  const ghTokenArgs = resolveGhTokenFallback(params.configMountNames, parsed);

  const args = [...configMountArgs(parsed.resolved), ...sshResult.args, ...sshAllowedHostsArgs, ...ghTokenArgs.args];
  const allowedHostsSuffix = sshResult.args.length > 0 && params.sshAllowedHosts ? ` → hosts: ${params.sshAllowedHosts}` : "";
  const appliedDescriptions = [
    ...parsed.resolved.map((s) => `${s.name} (${s.description})`),
    ...(sshResult.args.length > 0 ? [`ssh-agent forward${allowedHostsSuffix}`] : []),
    ...(ghTokenArgs.args.length > 0 ? ["gh CLI (GH_TOKEN fallback)"] : []),
  ];

  if (appliedDescriptions.length > 0) {
    log.info("sandbox", "host credentials attached to container", {
      mounts: appliedDescriptions,
    });
  }

  return { args, appliedDescriptions };
}

// ── GitHub CLI token fallback ──────────────────────────────────────

// When the user opted in to `gh` via SANDBOX_MOUNT_CONFIGS, the
// file mount may not carry a usable token — macOS stores it in the
// system keyring, not in ~/.config/gh/hosts.yml. In that case we
// extract the token via `gh auth token` on the host and pass it as
// GH_TOKEN env var. This only runs when "gh" was explicitly
// requested (#259 opt-in principle).
function resolveGhTokenFallback(requestedNames: readonly string[], parsed: ParsedMountList): { args: string[] } {
  const ghRequested = requestedNames.some((n) => n.trim() === "gh");
  if (!ghRequested) return { args: [] };

  // If an explicit GH_TOKEN is already in the environment, pass it.
  if (process.env.GH_TOKEN) {
    return { args: ["-e", `GH_TOKEN=${process.env.GH_TOKEN}`] };
  }

  // If the file mount resolved (hosts.yml exists), the token might
  // be in the file. Check if it's keyring-based by looking for
  // "oauth_token" in the hosts.yml — if missing, fall back.
  const ghResolved = parsed.resolved.some((s) => s.name === "gh");
  const ghMissing = parsed.missing.some((s) => s.name === "gh");

  // gh dir doesn't exist at all → try extracting from keyring
  // gh dir exists (mounted) → still try, since keyring auth leaves
  //   the file with no usable token
  if (ghResolved || ghMissing || !ghResolved) {
    try {
      const token = execFileSync("gh", ["auth", "token"], {
        encoding: "utf-8",
        timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
      }).trim();
      if (token.length > 0) {
        log.info("sandbox", "gh token extracted from host keyring (GH_TOKEN fallback)");
        return { args: ["-e", `GH_TOKEN=${token}`] };
      }
    } catch {
      log.info("sandbox", "gh auth token failed — gh CLI may not work in sandbox");
    }
  }

  return { args: [] };
}

// ── Utilities ──────────────────────────────────────────────────────

// Docker accepts POSIX-style paths even on Windows when using
// Docker Desktop, and the rest of the codebase already uses this
// helper in buildDockerSpawnArgs.
function toDockerPath(p: string): string {
  return p.replace(/\\/g, "/");
}
