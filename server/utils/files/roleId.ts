// A role id becomes a filename (`<id>.json`) via `path.join`, so it must be
// shape-validated before it ever reaches the filesystem — the agent/tool
// path supplies `role.id` verbatim and does not go through the Vue editor's
// regex. Anything with a slash, dot segment, or `..` would escape the roles
// directory (write or delete outside it).
const ROLE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const isValidRoleId = (value: unknown): value is string => typeof value === "string" && ROLE_ID_PATTERN.test(value);
