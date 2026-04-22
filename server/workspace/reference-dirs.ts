// User-defined reference directories (#455).
//
// Loaded from `config/reference-dirs.json`. Users can specify external
// directories that the agent can read (but not write to).
//
// Docker mode: mounted as `:ro` — filesystem-enforced read-only.
// Non-Docker mode: prompt-based restriction only.

import { createHash } from "crypto";
import path from "path";
import { homedir } from "os";
import { log } from "../system/logger/index.js";
import { readReferenceDirsJson, writeReferenceDirsJson, isExistingDirectory } from "../utils/files/reference-dirs-io.js";
import { isRecord } from "../utils/types.js";

// ── Types ───────────────────────────────────────────────────────

export interface ReferenceDirEntry {
  /** Absolute host path to the directory. */
  hostPath: string;
  /** Short label shown in prompt and UI. */
  label: string;
}

// ── Constants ───────────────────────────────────────────────────

const MAX_ENTRIES = 20;
const MAX_LABEL_LENGTH = 100;
const CONTAINER_MOUNT_ROOT = "/mnt/readonly";

/** Home-relative directories that must never be mounted. */
const HOME_RELATIVE_BLOCKED = [".ssh", ".aws", ".gnupg", ".config/gh", ".kube", ".docker"];

/** Absolute system paths that must never be mounted. */
const SYSTEM_BLOCKED_PREFIXES = ["/etc", "/root", "/var", "/proc", "/sys", "/boot", "/private/etc", "/private/var", "/System", "/Library"];

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE_G = /[\x00-\x1f]/g;

// ── Validation ──────────────────────────────────────────────────

function expandHome(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function isSensitivePath(absPath: string): boolean {
  const normalized = path.resolve(absPath);

  // Reject filesystem root
  if (normalized === path.parse(normalized).root) return true;

  const home = homedir();

  // Block $HOME itself (transitively exposes .ssh etc.)
  if (normalized === home) return true;

  // Block home-relative sensitive dirs
  if (
    HOME_RELATIVE_BLOCKED.some((blockedPath) => {
      const full = path.join(home, blockedPath);
      return normalized === full || normalized.startsWith(full + path.sep);
    })
  ) {
    return true;
  }

  // Block system directories
  return SYSTEM_BLOCKED_PREFIXES.some((blockedPrefix) => normalized === blockedPrefix || normalized.startsWith(blockedPrefix + path.sep));
}

function sanitizeLabel(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHAR_RE_G, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

function hasTraversalSegment(inputPath: string): boolean {
  return inputPath.split(path.sep).some((segment) => segment === "..");
}

function validateEntry(raw: unknown): ReferenceDirEntry | null {
  if (!isRecord(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const rawPath = typeof obj.hostPath === "string" ? obj.hostPath : "";
  if (!rawPath) return null;

  const expanded = expandHome(rawPath);

  // Must be absolute
  if (!path.isAbsolute(expanded)) return null;

  // Normalize to collapse . and // segments
  const absPath = path.resolve(expanded);

  // Reject actual ".." traversal segments (not substrings in filenames)
  if (hasTraversalSegment(expanded)) return null;

  // Block sensitive directories
  if (isSensitivePath(absPath)) {
    log.warn("reference-dirs", "blocked sensitive path", { path: absPath });
    return null;
  }

  const label = sanitizeLabel(String(obj.label ?? path.basename(absPath)));

  return { hostPath: absPath, label };
}

// ── Load ────────────────────────────────────────────────────────

export function loadReferenceDirs(root?: string): ReferenceDirEntry[] {
  const parsed = readReferenceDirsJson(root);
  const seenLabels = new Set<string>();
  const entries = parsed
    .slice(0, MAX_ENTRIES)
    .map(validateEntry)
    .filter((entry): entry is ReferenceDirEntry => {
      if (!entry) return false;
      // Deduplicate labels — first entry wins
      if (seenLabels.has(entry.label)) return false;
      seenLabels.add(entry.label);
      return true;
    });

  const skipped = parsed.length - entries.length;
  if (skipped > 0) {
    log.warn("reference-dirs", "skipped invalid entries", { skipped });
  }
  return entries;
}

// ── Save ────────────────────────────────────────────────────────

export function saveReferenceDirs(entries: readonly ReferenceDirEntry[], root?: string): void {
  writeReferenceDirsJson(entries, root);
  invalidateCache();
}

// ── Validate input array (for API) ─────────────────────────────

export function validateReferenceDirs(raw: unknown): { entries: ReferenceDirEntry[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "expected an array" };
  }
  if (raw.length > MAX_ENTRIES) {
    return { error: `too many entries (max ${MAX_ENTRIES})` };
  }
  const entries: ReferenceDirEntry[] = [];
  const errors: string[] = [];
  raw.forEach((item, i) => {
    const entry = validateEntry(item);
    if (entry) {
      entries.push(entry);
    } else {
      const hostPath = isRecord(item) ? String((item as Record<string, unknown>).hostPath ?? "") : "";
      errors.push(`entry ${i}: invalid or blocked path "${hostPath}"`);
    }
  });
  if (errors.length > 0) {
    return { error: errors.join("; ") };
  }

  // Reject duplicate labels — @ref/<label> routing requires uniqueness
  const seenLabels = new Set<string>();
  for (const entry of entries) {
    if (seenLabels.has(entry.label)) {
      return { error: `duplicate label "${entry.label}"` };
    }
    seenLabels.add(entry.label);
  }
  return { entries };
}

// ── Cached loader (for system prompt + Docker mounts) ───────────

let cachedEntries: ReferenceDirEntry[] | null = null;

export function getCachedReferenceDirs(): readonly ReferenceDirEntry[] {
  if (cachedEntries === null) {
    cachedEntries = loadReferenceDirs();
  }
  return cachedEntries;
}

function invalidateCache(): void {
  cachedEntries = null;
}

// ── Docker mount args ───────────────────────────────────────────

/** Container path for a reference directory.
 *  Disambiguates with a short hash suffix to prevent collisions
 *  when different host paths share the same basename. */
export function containerPath(entry: ReferenceDirEntry): string {
  const basename = path.basename(entry.hostPath);
  const hash = createHash("sha256").update(entry.hostPath).digest("hex").slice(0, 8);
  return path.posix.join(CONTAINER_MOUNT_ROOT, `${basename}-${hash}`);
}

/**
 * Return Docker `-v` args for read-only reference directory mounts.
 * Skips entries whose host path doesn't exist.
 */
export function referenceDirMountArgs(entries: readonly ReferenceDirEntry[]): string[] {
  const args: string[] = [];
  for (const entry of entries) {
    if (!isExistingDirectory(entry.hostPath)) {
      log.info("reference-dirs", "skipped (not found or not a directory)", {
        path: entry.hostPath,
      });
      continue;
    }
    const host = entry.hostPath.replace(/\\/g, "/");
    args.push("-v", `${host}:${containerPath(entry)}:ro`);
  }
  return args;
}

// ── System prompt snippet ───────────────────────────────────────

export function buildReferenceDirsPrompt(entries: readonly ReferenceDirEntry[], useDocker: boolean): string {
  if (entries.length === 0) return "";

  const lines = [
    "",
    "## Reference Directories (Read-Only)",
    "",
    "The user has configured external directories for reference.",
    "You may READ files in these directories but MUST NOT write, modify, or delete anything in them.",
    "",
  ];

  for (const entry of entries) {
    const mountPath = useDocker ? containerPath(entry) : entry.hostPath;
    lines.push(`- \`${mountPath}\` — ${entry.label}`);
  }

  if (!useDocker) {
    lines.push("");
    lines.push(
      "**Important**: These directories are outside the workspace. " +
        "Do not create, edit, or delete files in them. " +
        "Only use read operations (read, glob, grep).",
    );
  }

  lines.push("");
  return lines.join("\n");
}
