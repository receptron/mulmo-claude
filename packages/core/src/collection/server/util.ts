// Time constants kept local so the engine carries no host dependency.
// `errorMessage` now comes from the canonical core helper (#2217) — the local
// copy silently printed "[object Object]" for gRPC-shaped errors.
export { errorMessage } from "../../utils/errors.js";

export const ONE_SECOND_MS = 1_000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
