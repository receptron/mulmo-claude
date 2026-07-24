// Marp opt-in detection from parsed frontmatter. Marp's own convention
// is the `marp: true` directive in the YAML header. We also accept the
// string forms `"true"` / `"yes"` and the boolean-ish `1` so an LLM that
// quoted the value still lands in slide mode.

export function isMarpDocument(meta: Record<string, unknown>): boolean {
  const value = meta.marp;
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }
  return false;
}
