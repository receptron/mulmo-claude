// The feeds-index projection, shared by the two entry points that serve the
// same list: the desktop REST route (`GET /api/feeds`) and the phone's
// remote-host `listFeeds` command. Keeping the shape AND its defaults here is
// what stops a field from appearing on one platform only.
//
// `readFeedState` and the workspace root arrive as parameters (matching the DI
// the remote-host handler already uses) so the projection can be exercised with
// a stub reader instead of a workspace on disk.
import type { CollectionSource, FeedSchedule, FeedSummary, IngestKind } from "@mulmoclaude/core/collection";

// Reported when a feed declares no `ingest` block at all; a validated `ingest`
// always carries both keys.
const DEFAULT_KIND: IngestKind = "rss";
const DEFAULT_SCHEDULE: FeedSchedule = "on-demand";

/** The slice of a discovered feed the summary reads. `LoadedCollection`
 *  satisfies it; `source` is included because it selects which state file
 *  `readFeedState` opens. */
export interface FeedSummarySource {
  slug: string;
  source: CollectionSource;
  schema: {
    title: string;
    icon: string;
    ingest?: { kind?: string; schedule?: string };
  };
}

/** The slice of `@mulmoclaude/core/feeds/server`'s `readFeedState` this module
 *  needs, as an injected parameter. */
export type ReadFeedLastFetched = (workspaceRoot: string, feed: FeedSummarySource) => Promise<{ lastFetchedAt: string | null }>;

const summarize = (feed: FeedSummarySource, lastFetchedAt: string | null): FeedSummary => ({
  slug: feed.slug,
  title: feed.schema.title,
  icon: feed.schema.icon,
  kind: feed.schema.ingest?.kind ?? DEFAULT_KIND,
  schedule: feed.schema.ingest?.schedule ?? DEFAULT_SCHEDULE,
  lastFetchedAt,
});

/** One index row per registered feed, in registry order. */
export const buildFeedSummaries = async (feeds: FeedSummarySource[], readFeedState: ReadFeedLastFetched, workspaceRoot: string): Promise<FeedSummary[]> =>
  Promise.all(
    feeds.map(async (feed) => {
      const state = await readFeedState(workspaceRoot, feed);
      return summarize(feed, state.lastFetchedAt);
    }),
  );
