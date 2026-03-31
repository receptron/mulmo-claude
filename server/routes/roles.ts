import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { loadAllRoles } from "../roles.js";
import { BUILTIN_ROLES } from "../../src/config/roles.js";
import { pushToSession } from "../sessions.js";

const rolesDir = path.join(os.homedir(), "mulmoclaude", "roles");
const BUILTIN_IDS = new Set(BUILTIN_ROLES.map((r) => r.id));

const router = Router();

router.get("/roles", (_req: Request, res: Response) => {
  res.json(loadAllRoles());
});

router.post("/roles/manage", async (req: Request, res: Response) => {
  const { session } = req.query as { session: string };
  const result = await executeManageRoles(req.body, session ?? "");
  res.json(result);
});

export default router;

function notifyRolesUpdated(sessionId: string): void {
  pushToSession(sessionId, { type: "roles_updated" }).catch(() => {});
}

export async function executeManageRoles(
  input: Record<string, unknown>,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const { action, role, roleId } = input as {
    action: string;
    role?: Record<string, unknown>;
    roleId?: string;
  };

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
      roles: loadAllRoles(),
    };
  }

  // create or update
  if (!role)
    return {
      success: false,
      error: "role definition required for create/update",
    };
  const roleId2 = role.id as string;
  if (!roleId2) return { success: false, error: "role.id is required" };

  if (BUILTIN_IDS.has(roleId2) && action === "create") {
    return {
      success: false,
      error: `ID '${roleId2}' is reserved for a built-in role.`,
    };
  }

  // Ensure switchRole is in availablePlugins
  const availablePlugins =
    (role.availablePlugins as string[] | undefined) ?? [];
  if (!availablePlugins.includes("switchRole")) {
    availablePlugins.push("switchRole");
    role.availablePlugins = availablePlugins;
  }

  fs.mkdirSync(rolesDir, { recursive: true });
  fs.writeFileSync(
    path.join(rolesDir, `${roleId2}.json`),
    JSON.stringify(role, null, 2),
  );
  notifyRolesUpdated(sessionId);
  return {
    success: true,
    message: `Role '${role.name as string}' ${action}d successfully.`,
    roles: loadAllRoles(),
  };
}
