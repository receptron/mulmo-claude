import { Router, Request, Response } from "express";
import { getSessionQuery } from "../../utils/request.js";
import { loadCustomRoles } from "../../workspace/roles.js";
import { BUILTIN_ROLES, type Role } from "../../../src/config/roles.js";
import { pushSessionEvent } from "../../events/session-store/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { roleExists, deleteRole, saveRole } from "../../utils/files/roles-io.js";

const BUILTIN_IDS = new Set(BUILTIN_ROLES.map((r) => r.id));

const router = Router();

router.get(API_ROUTES.roles.list, (_req: Request, res: Response<Role[]>) => {
  res.json(loadCustomRoles());
});

router.post(API_ROUTES.roles.manage, async (req: Request, res: Response<Record<string, unknown>>) => {
  const session = getSessionQuery(req);
  const result = await executeManageRoles(req.body, session);
  res.json(result);
});

export default router;

function notifyRolesUpdated(chatSessionId: string): void {
  pushSessionEvent(chatSessionId, { type: EVENT_TYPES.rolesUpdated });
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

export async function executeManageRoles(input: ManageRolesInput, sessionId: string): Promise<Record<string, unknown>> {
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
    if (!id) return { success: false, error: "roleId is required for delete action" };
    if (BUILTIN_IDS.has(id)) {
      return { success: false, error: "Cannot delete built-in roles." };
    }
    if (!roleExists(id)) {
      return { success: false, error: `Role '${id}' not found.` };
    }
    deleteRole(id);
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

  saveRole(roleId2, roleToSave);
  notifyRolesUpdated(sessionId);
  return {
    success: true,
    message: `Role '${role.name}' ${action}d successfully.`,
    roles: loadCustomRoles(),
  };
}
