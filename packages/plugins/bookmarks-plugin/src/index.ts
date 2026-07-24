// Bookmarks plugin — server side (#1110 reference plugin).
//
// Demonstrates the v0.3 runtime API end-to-end on a deliberately tiny
// surface (~70 LOC of logic):
//   - definePlugin factory with destructured runtime
//   - files.data for the bookmarks themselves (backup target)
//   - files.config for UI prefs (per-machine state)
//   - pubsub.publish on every mutation so multi-tab views auto-refresh
//   - Zod-discriminated args + exhaustive switch with `default: never throw`
//
// `node:fs` / `node:path` / `console` / direct `fetch` are all unused
// — every I/O goes through the runtime. The eslint preset that ships
// with `gui-chat-protocol` is configured to make those imports a hard
// error, keeping the surface small for plugin reviewers.

import { createSerialLock, definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const Bookmark = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  addedAt: z.string(),
});
type Bookmark = z.infer<typeof Bookmark>;

const Prefs = z.object({
  sortBy: z.enum(["addedAt", "title"]).default("addedAt"),
  hidden: z.array(z.string()).default([]),
});
type Prefs = z.infer<typeof Prefs>;

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), url: z.string().url(), title: z.string() }),
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("remove"), id: z.string() }),
  z.object({ kind: z.literal("setSort"), by: z.enum(["addedAt", "title"]) }),
]);

const DEFAULT_PREFS: Prefs = { sortBy: "addedAt", hidden: [] };

export default definePlugin(({ pubsub, files, log }) => {
  // Two `add` calls (or `add` + `remove`) hitting in parallel both
  // read the same `bookmarks.json` snapshot and the later writer wins
  // — silently dropping the earlier change. Serialise read-modify-
  // write so the file mutations happen one at a time.
  const withWriteLock = createSerialLock();

  async function readAll(): Promise<Bookmark[]> {
    if (!(await files.data.exists("bookmarks.json"))) return [];
    const raw = await files.data.read("bookmarks.json");
    return z.array(Bookmark).parse(JSON.parse(raw));
  }

  async function writeAll(items: Bookmark[]): Promise<void> {
    await files.data.write("bookmarks.json", JSON.stringify(items, null, 2));
    pubsub.publish("changed", { count: items.length });
  }

  async function readPrefs(): Promise<Prefs> {
    if (!(await files.config.exists("prefs.json"))) return DEFAULT_PREFS;
    const raw = await files.config.read("prefs.json");
    return Prefs.parse(JSON.parse(raw));
  }

  async function writePrefs(prefs: Prefs): Promise<void> {
    await files.config.write("prefs.json", JSON.stringify(prefs, null, 2));
    pubsub.publish("prefs-changed", prefs);
  }

  function sortedAndFiltered(items: Bookmark[], prefs: Prefs): Bookmark[] {
    const sorted = [...items].sort((a, b) => (prefs.sortBy === "title" ? a.title.localeCompare(b.title) : b.addedAt.localeCompare(a.addedAt)));
    return sorted.filter((bookmark) => !prefs.hidden.includes(bookmark.id));
  }

  return {
    TOOL_DEFINITION,

    async manageBookmarks(rawArgs: unknown) {
      const args = Args.parse(rawArgs);
      switch (args.kind) {
        case "add": {
          return withWriteLock(async () => {
            const next: Bookmark = {
              id: crypto.randomUUID(),
              url: args.url,
              title: args.title,
              addedAt: new Date().toISOString(),
            };
            await writeAll([next, ...(await readAll())]);
            // Log only the host portion of the URL — full URLs can carry
            // private path segments, search terms, or auth tokens in the
            // query string (CodeRabbit review on PR #1124). The id is
            // enough to locate the bookmark on disk if needed.
            let host = "";
            try {
              host = new URL(next.url).host;
            } catch {
              host = "<unparseable>";
            }
            log.info("bookmark added", { id: next.id, host });
            return { ok: true, bookmark: next };
          });
        }
        case "list": {
          const [items, prefs] = await Promise.all([readAll(), readPrefs()]);
          return { ok: true, bookmarks: sortedAndFiltered(items, prefs) };
        }
        case "remove": {
          return withWriteLock(async () => {
            const items = await readAll();
            const next = items.filter((bookmark) => bookmark.id !== args.id);
            if (next.length === items.length) return { ok: false, error: "not_found" };
            await writeAll(next);
            return { ok: true };
          });
        }
        case "setSort": {
          const prefs = await readPrefs();
          await writePrefs({ ...prefs, sortBy: args.by });
          return { ok: true };
        }
        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
