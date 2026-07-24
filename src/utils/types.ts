// General-purpose runtime type guards now live in the leaf package
// `@mulmoclaude/common` — the "shared packages/types workspace" this file's
// header used to promise. Re-exported here so existing frontend imports keep
// resolving unchanged.
export * from "@mulmoclaude/common";
