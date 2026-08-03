// Host-agnostic dispatch envelope for the presentHtml View. The Vue View is
// decoupled from any one host's REST surface: it calls
// `useRuntime().dispatch({ kind, … })`, the host routes that to the package's
// `executeHtmlDispatch` (see `./dispatch`), and the dispatch reaches host
// storage only through the GENERIC gui-chat-protocol `files.artifacts`
// capability — no presentHtml-specific host method.

import { isRecord } from "@mulmoclaude/common";

/** Read the bytes of an existing HTML artifact (source editor + print). */
export interface LoadHtmlArgs {
  kind: "loadHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
}

/** Overwrite an existing HTML artifact in place (source editor "Apply"). */
export interface SaveHtmlArgs {
  kind: "saveHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
  html: string;
}

/** Discriminated union of every action the View's *package* router
 *  (`executeHtmlDispatch`) serves. `packHtml` is deliberately NOT here:
 *  bundling needs binary asset reads + zip, which live host-side, so the
 *  host intercepts it before delegating (see `PackHtmlArgs`). */
export type HtmlDispatchArgs = LoadHtmlArgs | SaveHtmlArgs;

/** Bundle an HTML artifact + its referenced local assets into a
 *  self-contained zip. Dispatched by the View, handled host-side (not by
 *  the pure package router). */
export interface PackHtmlArgs {
  kind: "packHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
}

/** Result of `packHtml`: base64 keeps the zip bytes JSON-safe over the
 *  dispatch transport; the View decodes it to a Blob download. */
export interface PackHtmlResult {
  filename: string;
  zipBase64: string;
}

/** Maps a dispatch `kind` to its result shape. Read back with the readers
 *  below — protocol 2.0.0 makes `dispatch` return `unknown` without one,
 *  because naming the type at the call site never checked anything. */
export interface HtmlDispatchResult {
  loadHtml: { html: string };
  saveHtml: { path: string };
}

// ── Runtime guards ──────────────────────────────────────────────────
//
// A dispatch payload arrives from the View over the host's HTTP surface, so
// it is untyped data, not a value the compiler has seen. These live beside
// the shapes they check — a guard in one host would leave every other host
// asserting the same shape by hand.
//
// They take `unknown` rather than `Record<string, unknown>`: an interface
// gets no implicit index signature, so a predicate narrowing FROM the record
// type would not type-check. `unknown` accepts either caller.

/** True when `value` is a well-formed `packHtml` payload. */
export function isPackHtmlArgs(value: unknown): value is PackHtmlArgs {
  return isRecord(value) && value.kind === "packHtml" && typeof value.path === "string";
}

/** True when `value` is a well-formed payload for the package router
 *  (`loadHtml` / `saveHtml`).
 *
 *  `saveHtml` additionally requires `html` to be a string — without that,
 *  `undefined` would reach `files.artifacts.write` and blank the artifact. */
export function isHtmlDispatchArgs(value: unknown): value is HtmlDispatchArgs {
  if (!isRecord(value) || typeof value.path !== "string") return false;
  if (value.kind === "loadHtml") return true;
  return value.kind === "saveHtml" && typeof value.html === "string";
}

// ── Result readers ──────────────────────────────────────────────────
//
// The mirror of the argument guards above: a dispatch RESPONSE is untyped
// data too. `dispatch(args, parse)` resolves to `parse`'s return type, so
// these are what turn the shapes above from a claim into a check. They
// throw, which is the documented idiom for `dispatch` — the View's own
// try/catch reports it.

const expected = (what: string, value: unknown): never => {
  throw new Error(`html plugin: dispatch returned no ${what} (got ${typeof value})`);
};

export function readPackHtmlResult(value: unknown): PackHtmlResult {
  if (isRecord(value) && typeof value.filename === "string" && typeof value.zipBase64 === "string") {
    return { filename: value.filename, zipBase64: value.zipBase64 };
  }
  return expected("packHtml result", value);
}

export function readLoadHtmlResult(value: unknown): HtmlDispatchResult["loadHtml"] {
  if (isRecord(value) && typeof value.html === "string") return { html: value.html };
  return expected("loadHtml result", value);
}

export function readSaveHtmlResult(value: unknown): HtmlDispatchResult["saveHtml"] {
  if (isRecord(value) && typeof value.path === "string") return { path: value.path };
  return expected("saveHtml result", value);
}
