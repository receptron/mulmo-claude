// getFeed command handler (remote-host phase 2).
//
// Returns one feed's detail + a PAGE of its records. A feed IS a
// LoadedCollection with an `ingest` block, so this reuses the exact collection
// page path (storeFor + toDetail + collectionPage) and returns the SAME shape
// as getCollection — the remote renders feed records with the same card view.
// The feed is located via the feed registry (listFeeds), since feeds live under
// their own registry rather than the collections dir.
import { listFeeds as listFeedsRegistry } from "@mulmoclaude/core/feeds/server";
import { storeFor, toDetail, type LoadedCollection, type CollectionItem } from "../../workspace/collections/index.js";
import { workspacePath } from "../../workspace/workspace.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";
import { clampLimit, clampOffset, deriveItems, pageResult, readIdParam } from "./collectionPage.js";

export interface GetFeedDeps {
  listFeeds: typeof listFeedsRegistry;
  listRecords: (collection: LoadedCollection) => Promise<CollectionItem[]>;
  toDetail: typeof toDetail;
  workspaceRoot: string;
}

export const createGetFeed =
  (deps: GetFeedDeps): CommandHandler =>
  async (params: JsonObject) => {
    const slug = readIdParam(params.slug);
    const offset = clampOffset(params.offset);
    const limit = clampLimit(params.limit);
    const feeds = await deps.listFeeds(deps.workspaceRoot);
    const feed = feeds.find((entry) => entry.slug === slug);
    if (!feed) throw new Error(`feed '${slug}' not found`);
    const all = deriveItems(feed.schema, await deps.listRecords(feed));
    return pageResult(deps.toDetail(feed), all, offset, limit);
  };

export const getFeed = createGetFeed({
  listFeeds: listFeedsRegistry,
  listRecords: (collection) => storeFor(collection).list(),
  toDetail,
  workspaceRoot: workspacePath,
});
