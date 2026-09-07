// Shared artifact-path builders for the presentation plugins (chart / html /
// mulmoscript). Browser-safe by design: no node:path / no node:crypto, so it
// bundles into both the server core and the browser (`./vue`) plugin entries.
//
// These are POSIX artifact *wire paths* — stored in JSON and used as the
// generic `files.artifacts` FileOps keys — so they must ALWAYS join with `/`
// regardless of host OS. `path.join` would emit `\` on Windows and corrupt
// them; `path.posix.join` would drag in node:path and break the browser
// bundle. So already-sanitised segments are joined with `/` directly (same
// choice the plugins made before this module existed).

const MAX_SLUG_LEN = 120;

/** The workspace directory every artifact lives under (`<workspace>/artifacts`). */
export const ARTIFACTS_ROOT = "artifacts";

/**
 * Lowercase-ASCII slug for a throwaway, timestamped artifact filename. Empty,
 * whitespace-only, and non-ASCII-only titles fall back to `fallback`. Capped at
 * 120 chars so a long LLM title can't blow the filesystem's NAME_MAX.
 *
 * Leading/trailing hyphens are stripped with a linear scan rather than a regex
 * like `/^-+|-+$/` — CodeQL flags the trailing-anchor form as polynomial
 * backtracking on the attacker-influenced (LLM-provided) title. Strip → cap →
 * strip so a cut at the 120-char boundary can't re-expose a trailing hyphen.
 */
export function slugifyArtifact(title: string | undefined, fallback: string): string {
  if (!title) return fallback;
  const collapsed = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start += 1;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  if (end - start > MAX_SLUG_LEN) end = start + MAX_SLUG_LEN;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  return collapsed.slice(start, end) || fallback;
}

/** UTC `YYYY/MM` partition (matches the host's #764 artifact sharding). UTC —
 *  not local — so a workspace synced across timezones stays in one bucket. */
export function yearMonthUtc(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

export interface ArtifactRelPathParams {
  /** Artifact-kind directory under the artifacts root (e.g. `charts`, `html`, `stories`). */
  dir: string;
  /** Human title the slug is derived from; empty/non-ASCII falls back to `fallback`. */
  title: string | undefined;
  /** File extension INCLUDING the leading dot (e.g. `.html`, `.chart.json`). */
  ext: string;
  /** Slug used when `title` yields nothing (e.g. `chart`, `page`, `story`). */
  fallback: string;
  now?: Date;
  /** Include the `YYYY/MM` partition segment. Default true; stories opt out. */
  partitioned?: boolean;
  /** Extra token appended after the timestamp, for callers that cannot accept a
   *  same-millisecond collision (see the note on `buildArtifactRelPath`). */
  suffix?: string;
}

/**
 * FileOps-relative artifact path: `<dir>[/YYYY/MM]/<slug>-<epochMs>[-<suffix>]<ext>`.
 * This is what `files.artifacts.write` takes; prefix it with
 * `toWorkspaceArtifactPath` for the workspace-relative form shown to the LLM.
 *
 * `<epochMs>` alone separates paths built at different times, but NOT two calls
 * with the same title inside one millisecond — those produce the same name, and
 * the second write silently replaces the first artifact. Pass `suffix` (a short
 * random token, as `shapeArtifactPath` does) wherever concurrent callers can
 * share a title.
 */
export function buildArtifactRelPath(params: ArtifactRelPathParams): string {
  const { dir, title, ext, fallback, now = new Date(), partitioned = true, suffix } = params;
  const stamp = suffix ? `${now.getTime()}-${suffix}` : `${now.getTime()}`;
  const fileName = `${slugifyArtifact(title, fallback)}-${stamp}${ext}`;
  const segments = partitioned ? [dir, yearMonthUtc(now), fileName] : [dir, fileName];
  return segments.join("/");
}

/** Prefix a FileOps-relative artifact path with the workspace `artifacts/` root. */
export function toWorkspaceArtifactPath(relPath: string): string {
  return `${ARTIFACTS_ROOT}/${relPath}`;
}

/**
 * True when any `/` or `\`-separated segment of `value` is empty (`//`,
 * leading/trailing slash), `.`, or `..`. The lexical traversal / non-canonical
 * guard every artifact path check shares — so a workspace-escape judgement
 * can't drift between plugins.
 *
 * Both separators, matching `classifyFilePath`: an artifact path is minted from
 * a slug and so never contains a backslash, while `node:path` on Windows treats
 * one as a separator. Splitting on `/` alone accepted
 * `artifacts/shapes/..\..\secrets.shape` — canonical to this check, traversal
 * to `path.join` (codex on #3056).
 */
export function hasUnsafePathSegment(value: string): boolean {
  return value.split(/[/\\]/).some((seg) => seg === "" || seg === "." || seg === "..");
}

// ── Presentable document paths (presentDocument / presentHtml `path`) ──
//
// The two present* tools accept a path to an EXISTING file to display and
// edit in place. That file is no longer necessarily an artifact the agent
// wrote: it can be any document in the workspace (MulmoTerminal's workspace
// IS the git project the user is working in) or, when the host allows it, an
// absolute path elsewhere on disk.
//
// Which of those a value is decides how the host resolves it, so the
// judgement lives here rather than in each plugin — the plugins may not
// import one another, and a predicate two of them spell differently is how
// "the write site accepts what the refresh site rejects" bugs start.

/** How a caller-supplied file path must be resolved. `null` = not a usable path. */
export type FilePathKind = "absolute" | "relative";

// `/x`, `C:\x` / `C:/x`, `\\server\share` (UNC), and the Windows root-relative
// `\dir\x` — which node's `path.resolve` on Windows sends to the drive root, so
// treating it as relative would mean the classification and the resolution
// disagreed about where the file is. Windows spellings are recognised on every
// platform: the value is produced by an LLM or a remote host, not by the local
// `path` module.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;

/** True when `value` names a location that does not depend on a base directory.
 *  Exported so a URL builder and a path resolver cannot disagree about which
 *  values are rooted. */
export function isAbsoluteFilePathValue(value: string): boolean {
  // One leading backslash covers both the UNC `\\server\share` and the Windows
  // root-relative `\dir\x`.
  return value.startsWith("/") || value.startsWith("\\") || WINDOWS_DRIVE_RE.test(value);
}

/**
 * Classify a caller-supplied path to a file the host may read and overwrite.
 *
 * Accepts one of `extensions` (compared case-insensitively) and rejects NUL
 * bytes and any `.` / `..` / empty segment — a relative path must be canonical
 * so it can be joined onto a root, and an absolute one must not climb, so
 * neither form can be re-pointed by traversal after the host has vetted it.
 * Returns `"absolute"` / `"relative"` so the host knows whether to resolve
 * against its workspace root, or `null` when the value is unusable.
 *
 * This is a LEXICAL check only. Existence, file-vs-directory, symlink
 * containment and any host policy about which roots are reachable stay with
 * the host, which is the only layer that can consult the filesystem.
 */
export function classifyFilePath(value: string, extensions: readonly string[]): FilePathKind | null {
  if (!value || value.includes("\0")) return null;
  const lower = value.toLowerCase();
  if (!extensions.some((ext) => lower.endsWith(ext))) return null;
  const absolute = isAbsoluteFilePathValue(value);
  // Split on both separators: `..` must be refused however the value spells it.
  const segments = value.split(/[/\\]/);
  // A leading `/` (or drive / UNC prefix) makes the first segment empty by
  // construction — skip those, then require every remaining segment to be a
  // real name.
  const body = absolute ? segments.slice(segments.findIndex((segment) => segment.length > 0)) : segments;
  if (body.length === 0) return null;
  if (body.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return absolute ? "absolute" : "relative";
}

/** True when any `/` or `\`-separated segment starts with a dot. The file
 *  servers that hand these pages to a browser refuse dotfile segments (the
 *  artifact mounts' `dotfiles: "deny"` policy), so a `path` argument bearing
 *  one can be accepted by a tool and then never render — the gate and the
 *  server have to agree on this, hence one definition. */
export function hasDotfileSegment(value: string): boolean {
  return value.split(/[/\\]/).some((segment) => segment.startsWith("."));
}
