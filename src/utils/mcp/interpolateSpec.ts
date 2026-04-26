// Resolve `${VAR}` placeholders inside an MCP server spec template
// using values supplied by the user via the per-server config form
// (#823 Phase 2). Pure function — no I/O. Lives under `src/` so the
// SettingsMcpTab component and its tests can both import it without
// pulling the server module in.

import type { McpServerSpec } from "../../config/mcpTypes";

const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export interface InterpolateResult {
  ok: true;
  spec: McpServerSpec;
}

export interface InterpolateError {
  ok: false;
  /** Names of required placeholders that the supplied values didn't cover. */
  missing: string[];
}

/**
 * Substitute `${VAR}` in every string slot of an MCP spec.
 *
 * - `command`, `url`, every `args[i]`, every `env[k]` value, and
 *   every `headers[k]` value are walked.
 * - A placeholder resolves to `values[VAR]`. Missing keys are
 *   collected and, if the placeholder name appears in `requiredKeys`,
 *   bubble up as an error.
 * - Optional placeholders (not in `requiredKeys`) with no value
 *   collapse to an empty string — same behaviour the user gets if
 *   they leave the field blank in the form.
 * - **Required-key drift guard** (Codex iter-1 #852): if a key is
 *   declared `required` in `requiredKeys` but is NEVER referenced as
 *   a placeholder in the template, the install is flagged as missing
 *   that key. Catches catalog-author mistakes where a form field was
 *   added but the spec template wasn't wired to consume it — pre-fix,
 *   such mismatches silently produced a working-looking install with
 *   no actual use of the user-supplied value.
 */
export function interpolateMcpSpec(
  template: McpServerSpec,
  values: Record<string, string>,
  requiredKeys: ReadonlySet<string>,
): InterpolateResult | InterpolateError {
  const missing = new Set<string>();
  const seenPlaceholders = new Set<string>();
  const replace = (input: string): string =>
    input.replace(PLACEHOLDER, (_match, key: string) => {
      seenPlaceholders.add(key);
      const value = values[key];
      if (value === undefined || value === "") {
        if (requiredKeys.has(key)) missing.add(key);
        return "";
      }
      return value;
    });

  let resolved: McpServerSpec;
  if (template.type === "http") {
    resolved = {
      type: "http",
      url: replace(template.url),
      ...(template.headers !== undefined && { headers: mapValues(template.headers, replace) }),
      ...(template.enabled !== undefined && { enabled: template.enabled }),
    };
  } else {
    resolved = {
      type: "stdio",
      command: replace(template.command),
      ...(template.args !== undefined && { args: template.args.map(replace) }),
      ...(template.env !== undefined && { env: mapValues(template.env, replace) }),
      ...(template.enabled !== undefined && { enabled: template.enabled }),
    };
  }

  // Drift check: a required key that never appeared as a placeholder
  // in the template means the catalog author wired the form but
  // forgot to consume the value in the spec. The install would
  // succeed silently with the field's value never used. Flag it so
  // the same error path the UI already renders (missing-fields
  // banner) tells the operator to fix the template.
  for (const key of requiredKeys) {
    if (!seenPlaceholders.has(key)) missing.add(key);
  }

  if (missing.size > 0) return { ok: false, missing: [...missing] };
  return { ok: true, spec: resolved };
}

function mapValues(record: Record<string, string>, transform: (value: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = transform(value);
  }
  return out;
}
