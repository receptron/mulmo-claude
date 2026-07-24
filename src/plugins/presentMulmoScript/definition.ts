import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";
import { TOOL_DEFINITION } from "@mulmoclaude/mulmoscript-plugin";

// presentMulmoScript's tool schema and save/reopen/update logic now live in
// the shared @mulmoclaude/mulmoscript-plugin package (single source of truth,
// also consumable by MulmoTerminal — plans/done/feat-mulmoscript-plugin.md). This
// built-in is a thin host adapter: it keeps MulmoClaude's host-specific
// routing META and View while sourcing the schema from the package.
export const TOOL_NAME = META.toolName;

/** Resolved-URL view of the mulmoScript plugin's routes. Plugin code reads
 *  `endpoints.<route>.{method, url}` to drive `apiCall`. Auto-derived from META. */
export type MulmoScriptEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export { TOOL_DEFINITION };
export default TOOL_DEFINITION;
