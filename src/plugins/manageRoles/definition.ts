export const TOOL_NAME = "manageRoles";

export const toolDefinition = {
  name: TOOL_NAME,
  description:
    "Create, update, or delete a custom user role stored in ~/mulmoclaude/roles/. After success, the frontend role list refreshes automatically.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "The action to perform",
      },
      role: {
        type: "object",
        description: "The full role definition (required for create/update)",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          icon: { type: "string" },
          prompt: { type: "string" },
          availablePlugins: { type: "array", items: { type: "string" } },
          queries: { type: "array", items: { type: "string" } },
        },
        required: ["id", "name", "icon", "prompt", "availablePlugins"],
      },
      roleId: {
        type: "string",
        description: "The role ID to delete (required for delete action)",
      },
    },
    required: ["action"],
  },
};
