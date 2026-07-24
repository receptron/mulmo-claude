// REST surface for Claude Code skills.
//
//   GET    /api/skills        → { skills: SkillSummary[] }                phase 0
//   GET    /api/skills/:name  → { skill: Skill } | 404                    phase 0
//   POST   /api/skills        → { saved: true, path } | 400/409          phase 1
//   PUT    /api/skills/:name  → { updated: true, path } | 400/403/404    phase 2
//   DELETE /api/skills/:name  → { deleted: true } | 400/403/404          phase 1
//
// Discovery reads both ~/.claude/skills/ (user) and
// <workspace>/.claude/skills/ (project); project wins on name
// collision. Writes are confined to the project scope —
// `saveProjectSkill` / `updateProjectSkill` / `deleteProjectSkill`
// enforce that.

import { Router, Request, Response } from "express";
import { deleteProjectSkill, discoverSkills, saveProjectSkill, updateProjectSkill } from "../../workspace/skills/index.js";
import type { Skill, SkillSummary } from "../../workspace/skills/index.js";
import {
  listCatalogEntries,
  readCatalogEntryDetail,
  readExternalDetailAsCatalog,
  starCatalogEntry,
  starExternalAsCatalog,
  type CatalogEntry,
  type CatalogEntryDetail,
  type CatalogDetailResult,
  type StarResult,
} from "../../workspace/skills/catalog.js";
import { resolveCatalogTarget } from "./skillCatalogTarget.js";
import { installExternalRepo, listInstalledRepos, uninstallExternalRepo, type InstalledRepo } from "../../workspace/skills/external/install.js";
import { EXTERNAL_PRESETS, type ExternalPresetSuggestion } from "../../workspace/skills/external/presets.js";
import { workspacePath } from "../../workspace/workspace.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { log } from "../../system/logger/index.js";
import { refreshScheduledSkills } from "../../workspace/skills/scheduler.js";
import { logBackgroundError } from "../../utils/logBackgroundError.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/httpError.js";

const router = Router();

interface SkillsListResponse {
  skills: SkillSummary[];
}

interface SkillDetailResponse {
  skill: Skill;
}

interface ErrorResponse {
  error: string;
}

interface SaveSkillBody {
  name?: unknown;
  description?: unknown;
  body?: unknown;
}

interface SaveSkillResponse {
  saved: true;
  path: string;
}

interface DeleteSkillResponse {
  deleted: true;
  name: string;
}

bindRoute(router, API_ROUTES.skills.list, async (_req: Request, res: Response<SkillsListResponse>) => {
  const skills = await discoverSkills({ workspaceRoot: workspacePath });
  log.info("skills", "list: ok", { count: skills.length });
  res.json({
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
    })),
  });
});

// Catalog endpoints (#1335 PR-B). Reads from
// `<workspace>/data/skills/catalog/<source>/<slug>/` (populated by
// `syncPresetSkills`); the star endpoint copies catalog entries
// into `.claude/skills/<slug>/` so Claude Code's discovery picks
// them up. Catalog entries themselves are NOT in `.claude/skills/`
// by design — that's the prompt-bloat fix from #1335.
//
// Route ordering matters: these `/catalog*` routes register
// BEFORE `GET /:name` below because Express matches in
// registration order. A request for `/catalog` would otherwise
// land in the detail handler with `req.params.name = "catalog"`
// and 404. Keep all `/catalog*` specifics ahead of any `:name`
// parameter route in this file.

interface CatalogListResponse {
  entries: CatalogEntry[];
}

interface StarResponse {
  starred: true;
  slug: string;
}

bindRoute(router, API_ROUTES.skills.catalogList, async (_req: Request, res: Response<CatalogListResponse>) => {
  const entries = await listCatalogEntries();
  log.info("skills", "catalog list: ok", { count: entries.length });
  res.json({ entries });
});

interface CatalogPreviewQuery {
  source?: unknown;
  slug?: unknown;
  /** External-source only — repoId + skillFolder identify the entry
   *  in place of `slug`. */
  repoId?: unknown;
  skillFolder?: unknown;
}

interface CatalogPreviewResponse {
  detail: CatalogEntryDetail;
}

function previewResponse(result: CatalogDetailResult, source: string, ident: string, res: Response<CatalogPreviewResponse | ErrorResponse>): void {
  if (result.kind === "ok") {
    log.info("skills", "catalog preview: ok", { source, slug: result.detail.slug });
    res.json({ detail: result.detail });
    return;
  }
  if (result.kind === "not-found") {
    log.warn("skills", "catalog preview: not found", { source, ident });
    notFound(res, `catalog entry not found: ${result.source}/${result.slug}`);
    return;
  }
  log.warn("skills", "catalog preview: invalid slug", { ident });
  badRequest(res, `invalid slug: ${result.slug}`);
}

bindRoute(
  router,
  API_ROUTES.skills.catalogPreview,
  async (req: Request<object, unknown, unknown, CatalogPreviewQuery>, res: Response<CatalogPreviewResponse | ErrorResponse>) => {
    const target = resolveCatalogTarget(req.query, "preview", res);
    if (!target) return;
    if (target.kind === "external") {
      const result = await readExternalDetailAsCatalog(target.repoId, target.skillFolder);
      previewResponse(result, target.source, `${target.repoId}/${target.skillFolder}`, res);
      return;
    }
    const result = await readCatalogEntryDetail(target.source, target.slug);
    previewResponse(result, target.source, target.slug, res);
  },
);

function starResponse(result: StarResult, source: string, ident: string, res: Response<StarResponse | ErrorResponse>): void {
  if (result.kind === "starred") {
    log.info("skills", "catalog star: ok", { source, slug: result.slug });
    res.json({ starred: true, slug: result.slug });
    return;
  }
  if (result.kind === "already-active") {
    log.info("skills", "catalog star: already-active", { source, slug: result.slug });
    conflict(res, `skill "${result.slug}" is already active`);
    return;
  }
  if (result.kind === "not-found") {
    log.warn("skills", "catalog star: not found", { source, ident });
    notFound(res, `catalog entry not found: ${result.source}/${result.slug}`);
    return;
  }
  log.warn("skills", "catalog star: invalid slug", { ident });
  badRequest(res, `invalid slug: ${result.slug}`);
}

interface ExternalStarBody {
  source?: unknown;
  repoId?: unknown;
  skillFolder?: unknown;
  slug?: unknown;
}

bindRoute(router, API_ROUTES.skills.catalogStar, async (req: Request<object, unknown, ExternalStarBody>, res: Response<StarResponse | ErrorResponse>) => {
  const target = resolveCatalogTarget(req.body, "star", res);
  if (!target) return;
  if (target.kind === "external") {
    const result = await starExternalAsCatalog(target.repoId, target.skillFolder);
    starResponse(result, target.source, `${target.repoId}/${target.skillFolder}`, res);
    return;
  }
  const result = await starCatalogEntry(target.source, target.slug);
  starResponse(result, target.source, target.slug, res);
});

// External-repo lifecycle endpoints (#1383 / #1335 PR-C). They live
// under `/api/skills/external/*` so they sort cleanly alongside the
// catalog endpoints AND register BEFORE the `/:name` detail handler
// below. Express matches in registration order — a `:name` route
// declared first would swallow `/external/...` as a skill named
// "external".

interface ExternalSuggestionsResponse {
  suggestions: readonly ExternalPresetSuggestion[];
}

interface ExternalReposResponse {
  repos: InstalledRepo[];
}

interface InstallRepoBody {
  url?: unknown;
  subpath?: unknown;
  ref?: unknown;
}

interface InstallRepoResponse {
  installed: true;
  repoId: string;
  url: string;
  sha: string;
  skillCount: number;
}

interface UninstallRepoResponse {
  uninstalled: true;
  repoId: string;
}

bindRoute(router, API_ROUTES.skills.externalSuggestions, (_req: Request, res: Response<ExternalSuggestionsResponse>) => {
  res.json({ suggestions: EXTERNAL_PRESETS });
});

bindRoute(router, API_ROUTES.skills.externalReposList, async (_req: Request, res: Response<ExternalReposResponse>) => {
  const repos = await listInstalledRepos();
  log.info("skills", "external repos list: ok", { count: repos.length });
  res.json({ repos });
});

bindRoute(
  router,
  API_ROUTES.skills.externalReposInstall,
  async (req: Request<object, unknown, InstallRepoBody>, res: Response<InstallRepoResponse | ErrorResponse>) => {
    const { url, subpath, ref } = req.body ?? {};
    if (typeof url !== "string" || url.length === 0) {
      badRequest(res, "url is required");
      return;
    }
    if (subpath !== undefined && typeof subpath !== "string") {
      badRequest(res, "subpath must be a string when provided");
      return;
    }
    if (ref !== undefined && typeof ref !== "string") {
      badRequest(res, "ref must be a string when provided");
      return;
    }
    const result = await installExternalRepo({ url, subpath, ref });
    if (result.kind === "installed") {
      log.info("skills", "external install: ok", { repoId: result.detail.repoId, skillCount: result.detail.skillCount });
      res.json({
        installed: true,
        repoId: result.detail.repoId,
        url: result.detail.url,
        sha: result.detail.sha,
        skillCount: result.detail.skillCount,
      });
      return;
    }
    if (result.kind === "no-skills") {
      log.warn("skills", "external install: no skills discovered", { repoId: result.repoId });
      res.status(422).json({ error: `no SKILL.md found in repo (${result.repoId})` });
      return;
    }
    if (result.kind === "invalid-url") {
      log.warn("skills", "external install: invalid url", { url: result.url });
      badRequest(res, "url must be a github.com HTTPS URL: https://github.com/<owner>/<repo>");
      return;
    }
    if (result.kind === "invalid-subpath") {
      log.warn("skills", "external install: invalid subpath", { subpath: result.subpath });
      badRequest(res, "subpath must be a relative path with no '..', leading '/', or backslash segments");
      return;
    }
    if (result.kind === "id-collision") {
      log.warn("skills", "external install: repoId collision", { repoId: result.repoId, existingUrl: result.existingUrl });
      conflict(res, `repo id "${result.repoId}" is already in use by ${result.existingUrl}. Uninstall it first if you intend to replace it.`);
      return;
    }
    log.warn("skills", "external install: error", { reason: result.reason });
    res.status(502).json({ error: `external install failed: ${result.reason}` });
  },
);

bindRoute(router, API_ROUTES.skills.externalReposRemove, async (req: Request<{ repoId: string }>, res: Response<UninstallRepoResponse | ErrorResponse>) => {
  const { repoId } = req.params;
  const result = await uninstallExternalRepo(repoId);
  if (result.kind === "uninstalled") {
    log.info("skills", "external uninstall: ok", { repoId: result.repoId });
    res.json({ uninstalled: true, repoId: result.repoId });
    return;
  }
  if (result.kind === "not-found") {
    log.warn("skills", "external uninstall: not found", { repoId: result.repoId });
    notFound(res, `external repo not installed: ${result.repoId}`);
    return;
  }
  log.warn("skills", "external uninstall: invalid repoId", { repoId: result.repoId });
  badRequest(res, `invalid repoId: ${result.repoId}`);
});

bindRoute(router, API_ROUTES.skills.detail, async (req: Request<{ name: string }>, res: Response<SkillDetailResponse | ErrorResponse>) => {
  log.info("skills", "detail: start", { name: req.params.name });
  const skills = await discoverSkills({ workspaceRoot: workspacePath });
  const skill = skills.find((candidate) => candidate.name === req.params.name);
  if (!skill) {
    log.warn("skills", "detail: not found", { name: req.params.name });
    notFound(res, `skill not found: ${req.params.name}`);
    return;
  }
  res.json({ skill });
});

bindRoute(router, API_ROUTES.skills.create, async (req: Request<object, unknown, SaveSkillBody>, res: Response<SaveSkillResponse | ErrorResponse>) => {
  const { name, description, body } = req.body ?? {};
  log.info("skills", "create: start", { name: typeof name === "string" ? name : undefined });
  if (typeof name !== "string") {
    log.warn("skills", "create: invalid name");
    badRequest(res, "name must be a string");
    return;
  }
  if (typeof description !== "string") {
    log.warn("skills", "create: invalid description", { name });
    badRequest(res, "description must be a string");
    return;
  }
  if (typeof body !== "string") {
    log.warn("skills", "create: invalid body", { name });
    badRequest(res, "body must be a string");
    return;
  }
  const result = await saveProjectSkill({
    workspaceRoot: workspacePath,
    name,
    description,
    body,
  });
  if (result.kind === "saved") {
    log.info("skills", "saved", { name });
    refreshScheduledSkills().catch(logBackgroundError("skills"));
    res.json({ saved: true, path: result.path });
    return;
  }
  if (result.kind === "invalid-slug") {
    log.warn("skills", "create: invalid slug", { slug: result.slug });
    badRequest(
      res,
      `invalid slug: "${result.slug}". Use lowercase letters, digits, and hyphens (1-64 chars, no leading/trailing hyphen, no consecutive hyphens).`,
    );
    return;
  }
  if (result.kind === "missing-field") {
    log.warn("skills", "create: missing field", { field: result.field });
    badRequest(res, `${result.field} must be a non-empty string`);
    return;
  }
  if (result.kind === "exists") {
    log.warn("skills", "create: already exists", { name: result.name });
    conflict(res, `skill already exists: ${result.name}. Choose a different name or delete the existing one first.`);
  }
});

interface UpdateSkillBody {
  description?: unknown;
  body?: unknown;
}

interface UpdateSkillResponse {
  updated: true;
  path: string;
}

bindRoute(
  router,
  API_ROUTES.skills.update,
  async (req: Request<{ name: string }, unknown, UpdateSkillBody>, res: Response<UpdateSkillResponse | ErrorResponse>) => {
    const { name } = req.params;
    const { description, body } = req.body ?? {};
    log.info("skills", "update: start", { name });
    if (typeof description !== "string") {
      log.warn("skills", "update: invalid description", { name });
      badRequest(res, "description must be a string");
      return;
    }
    if (typeof body !== "string") {
      log.warn("skills", "update: invalid body", { name });
      badRequest(res, "body must be a string");
      return;
    }
    const result = await updateProjectSkill({
      workspaceRoot: workspacePath,
      name,
      description,
      body,
    });
    if (result.kind === "updated") {
      log.info("skills", "updated", { name });
      refreshScheduledSkills().catch(logBackgroundError("skills"));
      res.json({ updated: true, path: result.path });
      return;
    }
    if (result.kind === "invalid-slug") {
      log.warn("skills", "update: invalid slug", { slug: result.slug });
      badRequest(res, `invalid slug: "${result.slug}"`);
      return;
    }
    if (result.kind === "missing-field") {
      log.warn("skills", "update: missing field", { name, field: result.field });
      badRequest(res, `${result.field} must be a non-empty string`);
      return;
    }
    if (result.kind === "user-scope") {
      log.warn("skills", "update: user scope refused", { name: result.name });
      forbidden(res, `cannot update user-scope skill "${result.name}" — only project-scope skills are writable.`);
      return;
    }
    if (result.kind === "not-found") {
      log.warn("skills", "update: not found", { name: result.name });
      notFound(res, `skill not found: ${result.name}`);
    }
  },
);

bindRoute(router, API_ROUTES.skills.remove, async (req: Request<{ name: string }>, res: Response<DeleteSkillResponse | ErrorResponse>) => {
  log.info("skills", "delete: start", { name: req.params.name });
  const result = await deleteProjectSkill({
    workspaceRoot: workspacePath,
    name: req.params.name,
  });
  if (result.kind === "deleted") {
    log.info("skills", "deleted", { name: result.name });
    refreshScheduledSkills().catch(logBackgroundError("skills"));
    res.json({ deleted: true, name: result.name });
    return;
  }
  if (result.kind === "invalid-slug") {
    log.warn("skills", "delete: invalid slug", { slug: result.slug });
    badRequest(res, `invalid slug: "${result.slug}"`);
    return;
  }
  if (result.kind === "user-scope") {
    log.warn("skills", "delete: user scope refused", { name: result.name });
    forbidden(
      res,
      `cannot delete user-scope skill "${result.name}" — only project-scope skills under ~/mulmoclaude/.claude/skills/ are writable from MulmoClaude.`,
    );
    return;
  }
  if (result.kind === "not-found") {
    log.warn("skills", "delete: not found", { name: result.name });
    notFound(res, `skill not found: ${result.name}`);
  }
});

export default router;
