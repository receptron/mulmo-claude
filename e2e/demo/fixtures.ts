// Demo-specific API mocks that layer on top of `mockAllApis`.
//
// The baseline fixture in `e2e/fixtures/api.ts` only covers the
// chat / sessions / todos / files endpoints — enough for the CI e2e
// suite but not enough to render Sources / Scheduler / Wiki views
// populated with the demo's content. This helper fills in those
// three views so the Playwright beats can navigate to the
// corresponding tab after the chat and show the registered data.

import type { Page, Route } from "@playwright/test";
import { DEMO_SOURCES, DEMO_TASK, DEMO_BRIEFING_MARKDOWN, DEMO_WIKI_SLUG, DEMO_WIKI_TITLE } from "./agent-scripts";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

// Read the `action` field off a wiki POST body. Returns null when the
// payload is empty, not JSON, or missing the field — callers should
// treat missing action as an index request.
function extractPostAction(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { action?: unknown };
    return typeof parsed.action === "string" ? parsed.action : null;
  } catch {
    return null;
  }
}

interface SchedulerTaskPayload {
  id: string;
  name: string;
  description: string;
  schedule: { type: "daily"; time: string };
  origin: "user";
  enabled: boolean;
  state: { lastRunAt: null; lastRunResult: null; nextScheduledAt: string };
}

function buildTaskPayload(): SchedulerTaskPayload {
  // Nominal "next run" of 06:00 tomorrow, formatted as a future
  // ISO timestamp so the Scheduler UI shows a sane countdown.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(6, 0, 0, 0);
  return {
    id: DEMO_TASK.id,
    name: DEMO_TASK.name,
    description:
      "Reads every registered financial news source, clusters today's articles by topic, computes day-over-day deltas, and writes a newspaper-style briefing to the wiki.",
    schedule: DEMO_TASK.schedule,
    origin: "user",
    enabled: true,
    state: { lastRunAt: null, lastRunResult: null, nextScheduledAt: tomorrow.toISOString() },
  };
}

// Map each registered DEMO_SOURCES entry to the shape the Sources
// view actually consumes (mirrors `Source` in server/workspace/sources/types.ts).
function buildSourcesPayload() {
  const now = new Date().toISOString();
  return DEMO_SOURCES.map((source) => ({
    slug: source.slug,
    title: source.title,
    url: source.url,
    fetcherKind: "rss" as const,
    fetcherParams: {},
    schedule: "daily" as const,
    categories: [source.category],
    maxItemsPerFetch: 20,
    addedAt: now,
    notes: "",
  }));
}

// Wiki index payload — one entry per registered demo page. The
// Wiki plugin reads `pageEntries` off this response to render the
// sidebar.
function buildWikiIndexPayload() {
  return {
    data: {
      action: "index",
      title: "Wiki Index",
      content: `# Wiki\n\n- [[${DEMO_WIKI_TITLE}]] — today's global finance briefing #finance #daily-briefing\n`,
      pageEntries: [
        {
          title: DEMO_WIKI_TITLE,
          slug: DEMO_WIKI_SLUG,
          description: "Today's global finance briefing",
          tags: ["finance", "daily-briefing"],
        },
      ],
    },
    message: "Wiki index — 1 page",
    title: "Wiki Index",
    instructions: "The wiki index is now displayed on the canvas.",
    updating: true,
  };
}

function buildWikiPagePayload() {
  return {
    data: {
      action: "page",
      title: DEMO_WIKI_TITLE,
      content: DEMO_BRIEFING_MARKDOWN,
      pageName: DEMO_WIKI_TITLE,
      pageExists: true,
    },
    message: `Showing page: ${DEMO_WIKI_TITLE}`,
    title: DEMO_WIKI_TITLE,
    instructions: "The wiki page is now displayed on the canvas.",
    updating: true,
  };
}

export interface DemoViewOptions {
  sources?: boolean;
  scheduler?: boolean;
  wiki?: boolean;
}

/**
 * Register Playwright route handlers for the demo's Sources /
 * Scheduler / Wiki views. Each view is opt-in via the `opts` flags
 * so per-beat tests can activate only what they need.
 *
 * Call AFTER `mockAllApis` — Playwright routes last-registered-first,
 * so these narrower handlers win over the catch-all 501 inside
 * `mockAllApis`.
 */
export async function mockDemoViews(page: Page, opts: DemoViewOptions): Promise<void> {
  if (opts.sources) {
    await page.route(urlEndsWith("/api/sources"), (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ json: { sources: buildSourcesPayload() } });
    });
  }

  if (opts.scheduler) {
    const task = buildTaskPayload();
    await page.route(urlEndsWith("/api/scheduler/tasks"), (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ json: { tasks: [task] } });
    });
    // Legacy dispatcher endpoint the older UI still calls.
    await page.route(urlEndsWith("/api/scheduler"), (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ json: { data: { items: [] } } });
    });
    // Logs list — empty is fine; the task is brand new.
    await page.route(urlEndsWith("/api/scheduler/logs"), (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ json: { logs: [] } });
    });
  }

  if (opts.wiki) {
    const indexPayload = buildWikiIndexPayload();
    const pagePayload = buildWikiPagePayload();
    // Both HTTP methods hit `/api/wiki`:
    //   - GET  / (no query)           → index
    //   - GET  /?slug=…                → page
    //   - POST with { action: "page" } → page (used when the Wiki
    //                                   view reacts to route changes)
    //   - POST with { action: "index" or anything else } → index
    // Dispatch on method + body.action or query.slug so the same
    // payload comes back regardless of which route the Vue view uses.
    await page.route(urlEndsWith("/api/wiki"), (route: Route) => {
      const request = route.request();
      const method = request.method();
      if (method === "GET") {
        const hasSlug = new URL(request.url()).searchParams.has("slug");
        return route.fulfill({ json: hasSlug ? pagePayload : indexPayload });
      }
      if (method === "POST") {
        const action = extractPostAction(request.postData());
        return route.fulfill({ json: action === "page" ? pagePayload : indexPayload });
      }
      return route.fallback();
    });
  }
}
