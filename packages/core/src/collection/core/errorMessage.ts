// Re-exported from the canonical helper so the collection engine and the host
// agree on gRPC-shaped errors (#2217). Kept as a module rather than rewriting
// its importers, which reach for this path by name.
export { errorMessage } from "../../utils/errors.js";
