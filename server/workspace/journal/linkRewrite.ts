// Moved to server/utils/markdown.ts. Re-export for backwards
// compatibility with existing callers in dailyPass.ts and
// optimizationPass.ts.
export { rewriteWorkspaceLinks, rewriteMarkdownLinks } from "../../utils/markdown.js";
