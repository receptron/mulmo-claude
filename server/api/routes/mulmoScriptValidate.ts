// Request-body validators for the mulmo-script PUT endpoints. Split
// from `mulmo-script.ts` so the pure shape checks can be unit-tested
// without spinning up Express.
//
// The `@mulmocast/types` package exports zod schemas that mirror the
// canonical MulmoScript / MulmoBeat shapes. Using them here keeps the
// server and client agreeing on what a "valid script" is — the same
// schemas back client-side edit-time validation in
// `src/plugins/presentMulmoScript/View.vue`.

import { mulmoBeatSchema, mulmoScriptSchema } from "@mulmocast/types";
import { isRecord } from "../../utils/types.js";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function formatZodIssues(
  // Zod's `$ZodIssue.path` is `PropertyKey[]` (includes `symbol`).
  // Accept the wider type so callers can pass `safeParse().error.issues`
  // directly; stringify any non-string/number segments at format time.
  issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>,
): string {
  if (issues.length === 0) return "invalid shape";
  const head = issues
    .slice(0, 3)
    .map((i) => {
      const pathStr =
        i.path.length > 0
          ? i.path.map((seg) => String(seg)).join(".")
          : "<root>";
      return `${pathStr}: ${i.message}`;
    })
    .join("; ");
  return issues.length > 3 ? `${head} (+${issues.length - 3} more)` : head;
}

/**
 * Validate the `update-script` request body. Returns the parsed,
 * schema-conformant script on success, or a human-readable error
 * suitable for sending back as a 400 response.
 */
export function validateUpdateScriptBody(body: unknown): ValidationResult<{
  filePath: string;
  script: unknown;
}> {
  if (!isRecord(body)) {
    return { ok: false, error: "body must be an object" };
  }
  if (typeof body.filePath !== "string" || body.filePath === "") {
    return { ok: false, error: "filePath must be a non-empty string" };
  }
  if (body.script === undefined) {
    return { ok: false, error: "script is required" };
  }
  const parsed = mulmoScriptSchema.safeParse(body.script);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid script: ${formatZodIssues(parsed.error.issues)}`,
    };
  }
  return {
    ok: true,
    value: { filePath: body.filePath as string, script: parsed.data },
  };
}

/**
 * Validate the `update-beat` request body. `beatIndex` is allowed
 * to be any non-negative integer; the handler still bounds-checks
 * against the actual script length after reading the file.
 */
export function validateUpdateBeatBody(body: unknown): ValidationResult<{
  filePath: string;
  beatIndex: number;
  beat: unknown;
}> {
  if (!isRecord(body)) {
    return { ok: false, error: "body must be an object" };
  }
  if (typeof body.filePath !== "string" || body.filePath === "") {
    return { ok: false, error: "filePath must be a non-empty string" };
  }
  if (
    typeof body.beatIndex !== "number" ||
    !Number.isInteger(body.beatIndex) ||
    body.beatIndex < 0
  ) {
    return { ok: false, error: "beatIndex must be a non-negative integer" };
  }
  if (body.beat === undefined) {
    return { ok: false, error: "beat is required" };
  }
  const parsed = mulmoBeatSchema.safeParse(body.beat);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid beat: ${formatZodIssues(parsed.error.issues)}`,
    };
  }
  return {
    ok: true,
    value: {
      filePath: body.filePath as string,
      beatIndex: body.beatIndex as number,
      beat: parsed.data,
    },
  };
}
