import type { CustomRole } from "./index";

export const DEFAULT_ROLE_ICON = "person";
const ROLE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface RoleForm {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  selectedPlugins: string[];
  queriesText: string;
}

export type RoleFormErrorCode = "idRequired" | "idInvalid" | "nameRequired" | "idDuplicate";

export interface RoleFormError {
  code: RoleFormErrorCode;
  id: string;
}

export const isValidRoleId = (value: string): boolean => ROLE_ID_PATTERN.test(value);

// One newline-separated query per line; blank lines dropped, each trimmed.
export const parseQueriesText = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// Single source of truth for form → role so create and edit can't drift.
// The icon fallback lives here: an empty icon field must become the default
// on BOTH paths (edit used to persist an empty icon, dropping it everywhere).
export const formToRole = (form: RoleForm): CustomRole => ({
  id: form.id.trim(),
  name: form.name.trim(),
  icon: form.icon.trim() || DEFAULT_ROLE_ICON,
  // Prompt is intentionally NOT trimmed — leading/trailing whitespace can be
  // meaningful in a system prompt.
  prompt: form.prompt,
  availablePlugins: form.selectedPlugins,
  queries: parseQueriesText(form.queriesText),
});

export const roleToForm = (role: CustomRole): RoleForm => ({
  id: role.id,
  name: role.name,
  icon: role.icon,
  prompt: role.prompt,
  selectedPlugins: [...role.availablePlugins],
  queriesText: (role.queries ?? []).join("\n"),
});

// `excludeId` lets rename skip the role's own id when checking for duplicates.
export const validateRoleForm = (form: RoleForm, excludeId: string | null, existingIds: readonly string[]): RoleFormError | null => {
  const trimmedId = form.id.trim();
  if (!trimmedId) return { code: "idRequired", id: trimmedId };
  if (!isValidRoleId(trimmedId)) return { code: "idInvalid", id: trimmedId };
  if (!form.name.trim()) return { code: "nameRequired", id: trimmedId };
  if (existingIds.some((existing) => existing === trimmedId && existing !== excludeId)) {
    return { code: "idDuplicate", id: trimmedId };
  }
  return null;
};
