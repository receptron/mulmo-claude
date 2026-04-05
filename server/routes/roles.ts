import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { loadCustomRoles } from "../roles.js";
import { BUILTIN_ROLES, type Role } from "../../src/config/roles.js";
import { pushToSession } from "../sessions.js";

const rolesDir = path.join(os.homedir(), "mulmoclaude", "roles");
const BUILTIN_IDS = new Set(BUILTIN_ROLES.map((r) => r.id));

const router = Router();

router.get("/roles", (_req: Request, res: Response<Role[]>) => {
  res.json(loadCustomRoles());
});

router.post(
  "/roles/manage",
  async (req: Request, res: Response<Record<string, unknown>>) => {
    const session = String(req.query.session ?? "");
    const result = await executeManageRoles(req.body, session);
    res.json(result);
  },
);

export default router;

function notifyRolesUpdated(sessionId: string): void {
  pushToSession(sessionId, { type: "roles_updated" }).catch(() => {});
}

interface ManageRolesInput {
  action: string;
  role?: {
    id: string;
    name: string;
    icon: string;
    prompt: string;
    availablePlugins: string[];
    queries?: string[];
  };
  roleId?: string;
}

export async function executeManageRoles(
  input: ManageRolesInput,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const { action, role, roleId } = input;

  if (action === "list") {
    const customRoles = loadCustomRoles();
    return {
      success: true,
      message: `${customRoles.length} custom role${customRoles.length !== 1 ? "s" : ""}.`,
      data: { customRoles },
    };
  }

  if (action === "delete") {
    const id = roleId;
    if (!id)
      return { success: false, error: "roleId is required for delete action" };
    if (BUILTIN_IDS.has(id)) {
      return { success: false, error: "Cannot delete built-in roles." };
    }
    const filePath = path.join(rolesDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Role '${id}' not found.` };
    }
    fs.unlinkSync(filePath);
    notifyRolesUpdated(sessionId);
    return {
      success: true,
      message: `Role '${id}' deleted.`,
      roles: loadCustomRoles(),
    };
  }

  // create or update
  if (!role)
    return {
      success: false,
      error: "role definition required for create/update",
    };
  if (!role.id) return { success: false, error: "role.id is required" };
  const roleId2 = role.id;

  if (BUILTIN_IDS.has(roleId2) && action === "create") {
    return {
      success: false,
      error: `ID '${roleId2}' is reserved for a built-in role.`,
    };
  }

  // Strip switchRole before saving — it is injected at load time by server/roles.ts
  const pluginsToSave = role.availablePlugins ?? [];
  const roleToSave = {
    ...role,
    availablePlugins: pluginsToSave.filter((p) => p !== "switchRole"),
  };

  fs.mkdirSync(rolesDir, { recursive: true });
  fs.writeFileSync(
    path.join(rolesDir, `${roleId2}.json`),
    JSON.stringify(roleToSave, null, 2),
  );
  notifyRolesUpdated(sessionId);
  return {
    success: true,
    message: `Role '${role.name}' ${action}d successfully.`,
    roles: loadCustomRoles(),
  };
}
