// getRemoteView command handler (remote-host phase 3 —
// plans/done/feat-remote-custom-view.md).
//
// Returns one mobile (`target: "mobile"`) custom view wrapped HOST-side into
// its sandboxed srcdoc (CSP + postMessage bootstrap), so the phone renders the
// artifact verbatim — the same builder the desktop phone-frame preview reads
// over HTTP, keeping preview === phone structural. The srcdoc travels inside
// the Firestore command document; the builder enforces the 1 MiB budget.
//
// Factory (createGetRemoteView) keeps the mapping unit-testable with the
// engine stubbed; the default export wires the real functions.
import { readIdParam } from "@mulmoclaude/core/remote-view";
import { loadCollection } from "../../workspace/collections/index.js";
import { buildRemoteView, remoteViewFailureMessage } from "../../workspace/collections/remoteView.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";

export interface GetRemoteViewDeps {
  loadCollection: typeof loadCollection;
  buildRemoteView: typeof buildRemoteView;
}

export const createGetRemoteView =
  (deps: GetRemoteViewDeps): CommandHandler =>
  async (params: JsonObject) => {
    const slug = readIdParam(params.slug);
    const viewId = readIdParam(params.viewId);
    const locale = typeof params.locale === "string" ? params.locale : "";
    const collection = await deps.loadCollection(slug);
    if (!collection) throw new Error(`collection '${slug}' not found`);
    const result = await deps.buildRemoteView(collection, viewId, locale);
    if (result.kind !== "ok") throw new Error(remoteViewFailureMessage(result, slug));
    const { view, srcdoc, bytes } = result;
    // Plain JSON, but the interface lacks an index signature — cast like the
    // phase-2 handlers.
    return { view, srcdoc, bytes } as unknown as JsonObject;
  };

export const getRemoteView = createGetRemoteView({ loadCollection, buildRemoteView });
