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
import { workspacePath } from "../../workspace/workspace.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
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

router.get(API_ROUTES.skills.list, async (_req: Request, res: Response<SkillsListResponse>) => {
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

router.get(API_ROUTES.skills.detail, async (req: Request<{ name: string }>, res: Response<SkillDetailResponse | ErrorResponse>) => {
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

router.post(API_ROUTES.skills.create, async (req: Request<object, unknown, SaveSkillBody>, res: Response<SaveSkillResponse | ErrorResponse>) => {
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

router.put(API_ROUTES.skills.update, async (req: Request<{ name: string }, unknown, UpdateSkillBody>, res: Response<UpdateSkillResponse | ErrorResponse>) => {
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
});

router.delete(API_ROUTES.skills.remove, async (req: Request<{ name: string }>, res: Response<DeleteSkillResponse | ErrorResponse>) => {
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
