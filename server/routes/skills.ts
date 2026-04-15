// REST surface for Claude Code skills.
//
//   GET    /api/skills        → { skills: SkillSummary[] }                phase 0
//   GET    /api/skills/:name  → { skill: Skill } | 404                    phase 0
//   POST   /api/skills        → { saved: true, path } | 400/409          phase 1
//   DELETE /api/skills/:name  → { deleted: true } | 400/403/404          phase 1
//
// Discovery reads both ~/.claude/skills/ (user) and
// <workspace>/.claude/skills/ (project); project wins on name
// collision. Writes are confined to the project scope —
// `saveProjectSkill` / `deleteProjectSkill` enforce that.

import { Router, Request, Response } from "express";
import {
  deleteProjectSkill,
  discoverSkills,
  saveProjectSkill,
} from "../skills/index.js";
import type { Skill, SkillSummary } from "../skills/index.js";
import { workspacePath } from "../workspace.js";
import { log } from "../logger/index.js";

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

router.get(
  "/skills",
  async (_req: Request, res: Response<SkillsListResponse>) => {
    const skills = await discoverSkills({ workspaceRoot: workspacePath });
    res.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
      })),
    });
  },
);

router.get(
  "/skills/:name",
  async (
    req: Request<{ name: string }>,
    res: Response<SkillDetailResponse | ErrorResponse>,
  ) => {
    const skills = await discoverSkills({ workspaceRoot: workspacePath });
    const skill = skills.find((s) => s.name === req.params.name);
    if (!skill) {
      res.status(404).json({ error: `skill not found: ${req.params.name}` });
      return;
    }
    res.json({ skill });
  },
);

router.post(
  "/skills",
  async (
    req: Request<object, unknown, SaveSkillBody>,
    res: Response<SaveSkillResponse | ErrorResponse>,
  ) => {
    const { name, description, body } = req.body ?? {};
    if (typeof name !== "string") {
      res.status(400).json({ error: "name must be a string" });
      return;
    }
    if (typeof description !== "string") {
      res.status(400).json({ error: "description must be a string" });
      return;
    }
    if (typeof body !== "string") {
      res.status(400).json({ error: "body must be a string" });
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
      res.json({ saved: true, path: result.path });
      return;
    }
    if (result.kind === "invalid-slug") {
      res.status(400).json({
        error: `invalid slug: "${result.slug}". Use lowercase letters, digits, and hyphens (1-64 chars, no leading/trailing hyphen, no consecutive hyphens).`,
      });
      return;
    }
    if (result.kind === "missing-field") {
      res
        .status(400)
        .json({ error: `${result.field} must be a non-empty string` });
      return;
    }
    if (result.kind === "exists") {
      res.status(409).json({
        error: `skill already exists: ${result.name}. Choose a different name or delete the existing one first.`,
      });
    }
  },
);

router.delete(
  "/skills/:name",
  async (
    req: Request<{ name: string }>,
    res: Response<DeleteSkillResponse | ErrorResponse>,
  ) => {
    const result = await deleteProjectSkill({
      workspaceRoot: workspacePath,
      name: req.params.name,
    });
    if (result.kind === "deleted") {
      log.info("skills", "deleted", { name: result.name });
      res.json({ deleted: true, name: result.name });
      return;
    }
    if (result.kind === "invalid-slug") {
      res.status(400).json({ error: `invalid slug: "${result.slug}"` });
      return;
    }
    if (result.kind === "user-scope") {
      res.status(403).json({
        error: `cannot delete user-scope skill "${result.name}" — only project-scope skills under ~/mulmoclaude/.claude/skills/ are writable from MulmoClaude.`,
      });
      return;
    }
    if (result.kind === "not-found") {
      res.status(404).json({ error: `skill not found: ${result.name}` });
    }
  },
);

export default router;
