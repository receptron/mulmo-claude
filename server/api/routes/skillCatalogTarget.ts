// Which catalog entry does a `/api/skills/catalog*` request point at?
// `catalogPreview` (query params) and `catalogStar` (JSON body) share the
// same answer — a known `source`, plus either the external `repoId` +
// `skillFolder` pair or a `slug`. `repoId` and `skillFolder` are joined into
// a path (`${repoId}/${skillFolder}`), so a second hand-written copy of that
// validation is how a future external endpoint ends up looser than these two.
//
// Resolve-or-respond convention, as in `loadCollectionOr404` (collections.ts):
// the helper sends the 400 itself and returns null; callers write
// `const target = resolveCatalogTarget(...); if (!target) return;`.

import type { Response } from "express";
import { isCatalogSource, type CatalogSource } from "../../workspace/skills/catalog.js";
import { badRequest } from "../../utils/httpError.js";

/** The word that goes into the external-argument error message, so `preview`
 *  and `star` keep the exact wording each already sent. */
export type CatalogAction = "preview" | "star";

/** Raw request fields. Values are `unknown` because a query param can arrive
 *  as `string[]` and a body field as anything at all. */
export interface CatalogTargetInput {
  source?: unknown;
  slug?: unknown;
  repoId?: unknown;
  skillFolder?: unknown;
}

export type CatalogTarget =
  | { kind: "external"; source: Extract<CatalogSource, "external">; repoId: string; skillFolder: string }
  | { kind: "catalog"; source: Exclude<CatalogSource, "external">; slug: string };

/** Deliberately NOT `isNonEmptyString` from `@mulmoclaude/common`: that guard
 *  trims, which would start rejecting a whitespace-only `repoId` these
 *  endpoints have always accepted. */
function isPresentString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function resolveCatalogTarget(input: CatalogTargetInput, action: CatalogAction, res: Response): CatalogTarget | null {
  const { source, slug, repoId, skillFolder } = input;
  if (!isCatalogSource(source)) {
    badRequest(res, "source must be a known catalog source");
    return null;
  }
  if (source === "external") {
    if (!isPresentString(repoId) || !isPresentString(skillFolder)) {
      badRequest(res, `repoId and skillFolder are required for external ${action}`);
      return null;
    }
    return { kind: "external", source, repoId, skillFolder };
  }
  if (!isPresentString(slug)) {
    badRequest(res, "slug is required");
    return null;
  }
  return { kind: "catalog", source, slug };
}
