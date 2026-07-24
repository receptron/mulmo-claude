// `errorMessage` now lives in `@mulmoclaude/common` (browser-safe, zero-dep
// leaf) so the isomorphic helper has one home instead of a hand-copy per
// surface. Re-exported here to keep it part of this plugin's published
// `./shared` entry (`export * from "./errors"`) and the ~8 internal
// `../shared/errors` import sites.
export { errorMessage } from "@mulmoclaude/common";
