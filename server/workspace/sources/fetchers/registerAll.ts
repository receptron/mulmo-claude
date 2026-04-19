// Side-effect bootstrap: importing this module registers every
// known fetcher with the dispatcher in `./index.ts`. Each fetcher
// module calls `registerFetcher(...)` at import time.
//
// The dispatcher itself intentionally does not import the fetcher
// modules (see the comment in `./index.ts`) so it stays free of
// heavy parser dependencies and tests can register only the
// fetchers they need. Production entry points that run the
// pipeline must import this barrel once so `getFetcher(kind)`
// returns a non-null result for every FetcherKind.

import "./rss.js";
import "./githubReleases.js";
import "./githubIssues.js";
import "./arxiv.js";
