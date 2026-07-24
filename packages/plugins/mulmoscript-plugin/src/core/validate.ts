// Body validators for the mulmoScript update endpoints, moved verbatim from
// the host's `server/api/routes/mulmoScriptValidate.ts` so MulmoClaude and
// MulmoTerminal share one definition of a "valid script" / "valid beat".
//
// The `@mulmocast/types` package exports zod schemas that mirror the
// canonical MulmoScript / MulmoBeat shapes. The same schemas back client-side
// edit-time validation in the presentMulmoScript View.

import { mulmoBeatSchema, mulmoScriptSchema } from "@mulmocast/types";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatZodIssues(
  // Zod's `$ZodIssue.path` is `PropertyKey[]` (includes `symbol`).
  // Accept the wider type so callers can pass `safeParse().error.issues`
  // directly; stringify any non-string/number segments at format time.
  issues: readonly { message: string; path: readonly PropertyKey[] }[],
): string {
  if (issues.length === 0) return "invalid shape";
  const head = issues
    .slice(0, 3)
    .map((i) => {
      const pathStr = i.path.length > 0 ? i.path.map((seg) => String(seg)).join(".") : "<root>";
      return `${pathStr}: ${i.message}`;
    })
    .join("; ");
  return issues.length > 3 ? `${head} (+${issues.length - 3} more)` : head;
}

/** Shared prelude: require an object body carrying a non-empty
 *  `filePath`. On success returns the narrowed record + filePath so the
 *  caller reads the remaining fields without re-narrowing. */
function validateFilePathBody(body: unknown): ValidationResult<{ record: Record<string, unknown>; filePath: string }> {
  if (!isRecord(body)) {
    return { ok: false, error: "body must be an object" };
  }
  if (typeof body.filePath !== "string" || body.filePath === "") {
    return { ok: false, error: "filePath must be a non-empty string" };
  }
  return { ok: true, value: { record: body, filePath: body.filePath } };
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
  const base = validateFilePathBody(body);
  if (!base.ok) return base;
  const { record, filePath } = base.value;
  if (record.script === undefined) {
    return { ok: false, error: "script is required" };
  }
  const parsed = mulmoScriptSchema.safeParse(record.script);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid script: ${formatZodIssues(parsed.error.issues)}`,
    };
  }
  return {
    ok: true,
    value: { filePath, script: parsed.data },
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
  const base = validateFilePathBody(body);
  if (!base.ok) return base;
  const { record, filePath } = base.value;
  const beatIndex = record.beatIndex;
  if (typeof beatIndex !== "number" || !Number.isInteger(beatIndex) || beatIndex < 0) {
    return { ok: false, error: "beatIndex must be a non-negative integer" };
  }
  if (record.beat === undefined) {
    return { ok: false, error: "beat is required" };
  }
  const parsed = mulmoBeatSchema.safeParse(record.beat);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid beat: ${formatZodIssues(parsed.error.issues)}`,
    };
  }
  return {
    ok: true,
    value: {
      filePath,
      beatIndex,
      beat: parsed.data,
    },
  };
}
