// General-purpose runtime type guards now live in the leaf package
// `@mulmoclaude/common`, so the host, bridges, and plugins share ONE copy
// instead of this file being hand-synced against `src/utils/types.ts`.
// Re-exported here so the many existing `utils/types.js` imports across
// server/ keep resolving unchanged.
export * from "@mulmoclaude/common";
