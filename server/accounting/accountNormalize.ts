// Pure normalization for the persisted Account record. Lives in its
// own module so unit tests can exercise the field-whitelist + active-
// flag policy without spinning up the file system, and so the
// service-layer `upsertAccount` stays under the repo's 20-line
// guideline.
//
// Policy summary (mirrored in the `upsertAccount` JSDoc):
//   - whitelist: only `code`, `name`, `type`, optional `note`,
//     and `active` are persisted. Unknown keys from a mistyped
//     caller are dropped.
//   - `note`: stored only when a non-empty trimmed string. An
//     empty string is treated the same as omitted.
//   - `active`:
//       explicit `false` → store `false` (deactivate)
//       explicit `true`  → omit (reactivate; default-active)
//       omitted          → inherit from `existing` (preserves
//                          a soft-deleted account when a caller
//                          updates name/type/note without
//                          mentioning the active flag — the bug
//                          coverage that prompted this helper)

import type { Account } from "./types.js";

export function normalizeStoredAccount(input: Account, existing?: Account): Account {
  const stored: Account = { code: input.code, name: input.name, type: input.type };
  if (typeof input.note === "string" && input.note.length > 0) stored.note = input.note;
  const inheritInactive = input.active === undefined && existing?.active === false;
  if (input.active === false || inheritInactive) stored.active = false;
  return stored;
}
