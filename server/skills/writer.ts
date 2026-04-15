// Project-scope skill writer. Phase 1 of #139.
//
// Writes are confined to <workspaceRoot>/.claude/skills/<slug>/SKILL.md.
// User-scope skills (~/.claude/skills/) are never touched — the
// safety boundary is enforced by always going through
// `projectSkillPath` and never accepting an arbitrary destination.
//
// `saveProjectSkill` is non-overwriting: if the slug already has a
// SKILL.md (in either scope), the call returns a `kind: "exists"`
// result and the file is left alone. The caller (REST handler /
// MCP bridge) maps this to a 409 Conflict so Claude can ask the
// user for a different name.

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { rmdir } from "node:fs/promises";
import { discoverSkills } from "./discovery.js";
import { isValidSlug, projectSkillDir, projectSkillPath } from "./paths.js";
import { log } from "../logger/index.js";

export interface SaveSkillInput {
  /** Workspace root (typically `~/mulmoclaude`). */
  workspaceRoot: string;
  /** Slug — also the dir name and the slash-command name. */
  name: string;
  /** YAML frontmatter `description:` value. One-line summary. */
  description: string;
  /** Markdown body following the frontmatter. May be empty. */
  body: string;
}

export type SaveResult =
  | { kind: "saved"; path: string }
  | { kind: "invalid-slug"; slug: string }
  | { kind: "missing-field"; field: "description" | "body" }
  | { kind: "exists"; name: string };

/**
 * Write a new SKILL.md atomically. Refuses to overwrite — if the
 * skill already exists at either scope, returns `kind: "exists"`.
 */
export async function saveProjectSkill(
  input: SaveSkillInput,
): Promise<SaveResult> {
  const { workspaceRoot, name, description, body } = input;

  if (!isValidSlug(name)) return { kind: "invalid-slug", slug: name };
  if (typeof description !== "string" || description.trim().length === 0) {
    return { kind: "missing-field", field: "description" };
  }
  if (typeof body !== "string") {
    return { kind: "missing-field", field: "body" };
  }

  // Conflict check across BOTH scopes — we don't want to shadow a
  // user-scope skill with the same name (project would silently
  // override it via the precedence rule).
  const existing = await discoverSkills({ workspaceRoot });
  if (existing.some((s) => s.name === name)) {
    return { kind: "exists", name };
  }

  const finalPath = projectSkillPath(workspaceRoot, name);
  await mkdir(dirname(finalPath), { recursive: true });

  const contents = formatSkillFile(description, body);

  // Atomic write: tmp file in the same directory, then rename.
  // Same-FS rename is atomic on POSIX so a partial write can never
  // leave a half-baked SKILL.md visible to a concurrent reader.
  // Place the tmp file alongside the final path — using os.tmpdir()
  // can cross a filesystem boundary on some setups (Docker volumes,
  // separate /tmp mounts) and cause `rename()` to fail with EXDEV.
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, contents, "utf-8");
    await rename(tmpPath, finalPath);
  } catch (err) {
    // Best-effort cleanup; ignore if rename succeeded then the
    // tmp removal raced.
    await unlink(tmpPath).catch(() => {});
    log.error("skills", "save failed", { name, error: String(err) });
    throw err;
  }

  return { kind: "saved", path: finalPath };
}

export interface DeleteSkillInput {
  workspaceRoot: string;
  name: string;
}

export type DeleteResult =
  | { kind: "deleted"; name: string }
  | { kind: "invalid-slug"; slug: string }
  | { kind: "not-found"; name: string }
  | { kind: "user-scope"; name: string };

/**
 * Remove a project-scope skill (SKILL.md + its containing folder).
 * Refuses to touch the user scope even if a user skill with this
 * name exists — protects against accidental ~/.claude mutation.
 */
export async function deleteProjectSkill(
  input: DeleteSkillInput,
): Promise<DeleteResult> {
  const { workspaceRoot, name } = input;

  if (!isValidSlug(name)) return { kind: "invalid-slug", slug: name };

  // Look up the skill's effective source via discovery — if the
  // matching name is user-scope, we refuse.
  const all = await discoverSkills({ workspaceRoot });
  const skill = all.find((s) => s.name === name);
  if (!skill) return { kind: "not-found", name };
  if (skill.source === "user") return { kind: "user-scope", name };

  const dir = projectSkillDir(workspaceRoot, name);
  // Remove SKILL.md, then try to remove the directory if it's empty.
  // If the user has dropped extra files alongside SKILL.md (e.g. a
  // README, assets), rmdir() fails and we leave the directory in
  // place — the skill itself (the SKILL.md) is gone either way.
  try {
    await unlink(projectSkillPath(workspaceRoot, name));
  } catch (err) {
    // ENOENT is fine — discovery may be stale. Anything else is
    // surfaced so the caller knows the delete didn't fully work.
    const error = err as { code?: string };
    if (error.code !== "ENOENT") throw err;
  }
  await rmdir(dir).catch(() => {
    // Dir may contain user-added files (e.g. the user dropped a
    // README.md alongside SKILL.md). Don't fail in that case —
    // the skill itself is gone.
  });

  return { kind: "deleted", name };
}

/** Compose the final SKILL.md content. Body is trimmed of trailing
 *  whitespace; a final newline is always added. */
function formatSkillFile(description: string, body: string): string {
  const escaped = escapeYamlScalar(description);
  return `---\ndescription: ${escaped}\n---\n\n${body.trimEnd()}\n`;
}

/**
 * Escape a one-line string for use as a YAML scalar value. We
 * stay defensive: if the value contains any character that could
 * confuse the parser (`:`, `#`, `'`, `"`, leading whitespace), wrap
 * it in double quotes and JSON-escape the inner content. Plain
 * ASCII text passes through unchanged so the file stays readable.
 */
function escapeYamlScalar(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ").trim();
  const needsQuoting =
    /[:#'"\\[\]{}>|`*&!%@?]/.test(oneLine) ||
    /^\s|\s$/.test(oneLine) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(oneLine);
  if (!needsQuoting) return oneLine;
  // JSON.stringify gives us escapes for `\`, `"`, control chars in
  // one shot — the result is also valid YAML when wrapped in `"..."`.
  return JSON.stringify(oneLine);
}
