import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "manageSkills";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "List, save, or delete Claude Code skills. Discovery merges ~/.claude/skills/ (user, read-only) and <workspace>/.claude/skills/ (project, writable). Save and delete only affect the project scope.",
  prompt:
    `Use the ${TOOL_NAME} tool for the user's skill library:\n\n` +
    `- **list** (default, no args): show every available skill in the canvas.\n` +
    `- **save**: when the user asks to turn the current conversation into a skill (e.g. "skill 化して" / "save this as a skill"), do these steps:\n` +
    `  1. Read the current chat transcript via the Read tool. The path is \`chat/<session-id>.jsonl\` under the workspace; if you don't know the session id, list \`chat/\` first.\n` +
    `  2. Distill the conversation into a short markdown body explaining the steps you took, in second person ("First, do X. Then, do Y."). Keep it focused on the reusable workflow, not the one-off details.\n` +
    `  3. Pick a kebab-case slug (lowercase letters, digits, hyphens; no leading/trailing hyphen; 1-64 chars). If the user gave a name in the request, use it.\n` +
    `  4. Write a one-line description for the YAML frontmatter.\n` +
    `  5. Call ${TOOL_NAME} with \`{action: "save", name, description, body}\`. Saves go to <workspace>/.claude/skills/<slug>/SKILL.md.\n` +
    `  6. If the response says the name already exists, ask the user for a different one.\n` +
    `- **delete**: when the user asks to remove a named skill, call \`{action: "delete", name}\`. Only project-scope skills can be deleted; user-scope skills are protected.`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "save", "delete"],
        description:
          "The operation to perform. Default: list (show all skills).",
      },
      name: {
        type: "string",
        description:
          "Skill slug. Required for save and delete. Lowercase letters, digits, and hyphens only; 1-64 chars; no leading/trailing or consecutive hyphens.",
      },
      description: {
        type: "string",
        description:
          "One-line summary for the YAML frontmatter. Required for save.",
      },
      body: {
        type: "string",
        description:
          "Markdown body of the skill (instructions for Claude to follow). Required for save. May be multi-line.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
