// getRemoteViewItems command handler (remote-host phase 5 —
// plans/done/feat-remote-view-images.md).
//
// One page of a mobile view's records, view-aware so the host can inline the
// view's declared `imageFields` as `data:` URL thumbnails (a phone can't reach
// the workspace to render an image path). Same builder the desktop phone-frame
// preview reads over HTTP, so preview === phone. Supersedes the phase-2
// getCollection for a custom view's getItems: the page is already projected +
// image-inlined, so the mulmoserver client passes it straight to the view.
//
// Factory (createGetRemoteViewItems) keeps the mapping unit-testable with the
// engine stubbed; the default export wires the real functions.
import { clampLimit, clampOffset, normalizeFields, readIdParam } from "@mulmoclaude/core/remote-view";
import { loadCollection } from "../../workspace/collections/index.js";
import { remoteViewItems, remoteViewItemsFailureMessage } from "../../workspace/collections/remoteView.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";

export interface GetRemoteViewItemsDeps {
  loadCollection: typeof loadCollection;
  remoteViewItems: typeof remoteViewItems;
}

export const createGetRemoteViewItems =
  (deps: GetRemoteViewItemsDeps): CommandHandler =>
  async (params: JsonObject) => {
    const slug = readIdParam(params.slug);
    const viewId = readIdParam(params.viewId);
    const request = { offset: clampOffset(params.offset), limit: clampLimit(params.limit), fields: normalizeFields(params.fields) };
    const collection = await deps.loadCollection(slug);
    if (!collection) throw new Error(`collection '${slug}' not found`);
    const result = await deps.remoteViewItems(collection, viewId, request);
    if (result.kind !== "ok") throw new Error(remoteViewItemsFailureMessage(result, slug));
    // Plain JSON, but the interface lacks an index signature — cast like the
    // phase-2/3 handlers.
    return { page: result.page, inlined: result.inlined, omitted: result.omitted } as unknown as JsonObject;
  };

export const getRemoteViewItems = createGetRemoteViewItems({ loadCollection, remoteViewItems });
