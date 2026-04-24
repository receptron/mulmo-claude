// Automated MulmoClaude demo: news collection → schedule → auto-
// report, staged for a global finance / government audience.
//
// Runs against the e2e Vite server (port 45173) with a fully mocked
// backend, so the flow is deterministic regardless of real Claude
// latency. The three beats run inside one session so the chat
// history accrues the way a real user would see it, and Playwright
// records a single continuous WebM under `test-results/`.
//
// Running:
//   yarn demo:finance          # headed + slowMo + WebM recording
//   yarn demo:finance --headed # explicit
//
// See `e2e/demo/README.md` for rehearsal / recording workflow.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { chatInput, clickSend } from "../fixtures/chat";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";
import {
  BEAT_1_SOURCE_REGISTER,
  BEAT_2_SCHEDULE_CREATE,
  BEAT_3_BRIEFING_GENERATE,
  DEMO_SOURCES,
  DEMO_TASK,
  DEMO_WIKI_SLUG,
  type AgentEvent,
} from "./agent-scripts";
import { mockDemoViews } from "./fixtures";

// Each beat drives the UI via one chat message. The pubsub socket
// subscribes ONCE on session mount, so the POST /api/agent mock
// drains the pending beat's events onto the already-open socket.
interface DemoStreamState {
  send: ((packet: string) => void) | null;
  channel: string | null;
  pendingEvents: readonly AgentEvent[];
}

// Pacing — kept at the top so it's easy to dial timing for rehearsal
// vs. final recording. Values were tuned against headed Chromium
// with the config's `launchOptions.slowMo: 400`; tweaking slowMo
// alone doesn't affect event streaming, so these two fields are the
// real knobs for the recording tempo.
const TEXT_CHUNK_DELAY_MS = 70;
const TOOL_EVENT_DELAY_MS = 500;
const PRE_SEND_PAUSE_MS = 900;
const POST_BEAT_PAUSE_MS = 3 * ONE_SECOND_MS;
const VIEW_HOLD_MS = 5 * ONE_SECOND_MS;

async function installMockedAgentStream(page: Page, state: DemoStreamState): Promise<void> {
  await page.routeWebSocket(
    (url) => url.pathname.startsWith("/ws/pubsub"),
    (webSocket) => {
      state.send = (packet) => webSocket.send(packet);
      webSocket.send(
        "0" +
          JSON.stringify({
            sid: "demo-sid",
            upgrades: [],
            pingInterval: 25_000,
            pingTimeout: 20_000,
            maxPayload: 1_000_000,
          }),
      );

      webSocket.onMessage((msg) => {
        const text = String(msg);
        if (text === "2") {
          webSocket.send("3");
          return;
        }
        if (text === "40") {
          webSocket.send("40" + JSON.stringify({ sid: "demo-socket-sid" }));
          return;
        }
        if (!text.startsWith("42")) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.slice(2));
        } catch {
          return;
        }
        if (!Array.isArray(parsed)) return;
        const [name, arg] = parsed as [string, unknown];
        if (name === "subscribe" && typeof arg === "string" && arg.startsWith("session.")) {
          // Remember the session channel so the POST /api/agent mock
          // below can push events onto it.
          state.channel = arg;
        }
      });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/agent",
    (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const events = state.pendingEvents;
      state.pendingEvents = [];
      setTimeout(() => streamEventsIntoSocket(state, events), 120);
      return route.fulfill({
        status: 202,
        json: { chatSessionId: "demo-session" },
      });
    },
  );
}

// Fan out the canned events over the already-open socket. Pacing
// comes from the top-of-file constants so rehearsal tempo stays in
// one place.
function streamEventsIntoSocket(state: DemoStreamState, events: readonly AgentEvent[]): void {
  if (!state.send || !state.channel || events.length === 0) return;
  const send = state.send;
  const channel = state.channel;
  let delay = 0;
  for (const event of events) {
    setTimeout(() => {
      send("42" + JSON.stringify(["data", { channel, data: event }]));
    }, delay);
    delay += event.type === "text" ? TEXT_CHUNK_DELAY_MS : TOOL_EVENT_DELAY_MS;
  }
}

// Choose a substring of the final assistant line that's unlikely to
// be mangled by markdown rendering. We scan the last non-empty line
// for the longest run of characters that doesn't include any of
// `*_` ` (markdown emphasis / code / link syntax) — that run is
// guaranteed to survive intact in the DOM's textContent.
function pickPlainAnchor(message: string): string {
  const line =
    message
      .split("\n")
      .reverse()
      .find((entry) => entry.trim().length > 0) ?? "";
  const runs = line.split(/[`*_[\]()]+/).map((segment) => segment.trim());
  return runs.reduce((best, candidate) => (candidate.length > best.length ? candidate : best), "");
}

async function playBeat(page: Page, state: DemoStreamState, events: readonly AgentEvent[], prompt: string): Promise<void> {
  // Queue up this beat's events; the POST /api/agent mock drains
  // them onto the live pubsub socket once the user clicks send.
  state.pendingEvents = events;

  await chatInput(page).fill(prompt);
  // Pause so the audience reads the typed prompt before it is
  // consumed into the conversation stream.
  await page.waitForTimeout(PRE_SEND_PAUSE_MS);
  await clickSend(page);

  // Wait for the last streaming text chunk from the canned script
  // to land in the canvas. Picking the longest markdown-free run
  // from that chunk keeps the match robust against backticks /
  // asterisks that the renderer turns into <code> / <strong>.
  const lastText = events
    .slice()
    .reverse()
    .find((event) => event.type === "text" && event.source === "assistant");
  if (lastText && lastText.message) {
    const anchor = pickPlainAnchor(lastText.message);
    if (anchor.length > 5) {
      await expect(page.locator("body")).toContainText(anchor, { timeout: 30 * ONE_SECOND_MS });
    }
  }

  // Deliberate pause after the chat finishes — gives the audience
  // a moment to read the assistant's wrap-up before the spec
  // navigates to the confirmation view.
  await page.waitForTimeout(POST_BEAT_PAUSE_MS);
}

async function navigateToPluginView(page: Page, key: "sources" | "scheduler" | "wiki"): Promise<void> {
  // PluginLauncher exposes a `data-testid="plugin-launcher-<key>"`
  // for every navigation button — stable + language-independent.
  await page.getByTestId(`plugin-launcher-${key}`).click();
}

async function returnToChat(page: Page): Promise<void> {
  // The brand-name button in the top-left always routes back to
  // the latest chat session — one click restores the conversation
  // so the next beat's prompt lands where the audience expects.
  await page.getByRole("button", { name: /Go to latest chat/i }).click();
  await expect(chatInput(page)).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
}

// Slow-scroll the Wiki content pane from the top to the bottom so
// the whole briefing (all seven sections, the yield-move chart,
// the Unicode source-bar table) is visible on the recording.
//
// `selector` targets the scrollable container inside the Wiki view
// (the `.wiki-content` div). We read `scrollHeight` / `clientHeight`
// client-side, then step down in `stepPx` increments with a pause
// between each step — animation-ish motion that the audience can
// track without motion sickness.
async function slowScrollWiki(page: Page, stepPx: number, stepPauseMs: number): Promise<void> {
  const selector = ".wiki-content";
  await page.waitForSelector(selector, { timeout: 5 * ONE_SECOND_MS });
  const maxScroll = await page.evaluate((sel) => {
    const target = document.querySelector(sel) as HTMLElement | null;
    return target ? target.scrollHeight - target.clientHeight : 0;
  }, selector);
  if (maxScroll <= 0) return;

  let current = 0;
  while (current < maxScroll) {
    current = Math.min(current + stepPx, maxScroll);
    await page.evaluate(
      ({ sel, top }) => {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (target) target.scrollTo({ top, behavior: "smooth" });
      },
      { sel: selector, top: current },
    );
    await page.waitForTimeout(stepPauseMs);
  }
}

test("finance/government demo — news collection, schedule, auto-report", async ({ page }) => {
  test.setTimeout(5 * 60 * ONE_SECOND_MS);

  // Fresh session list so the intro frame is a clean empty state
  // and the first user message creates a new demo session.
  await mockAllApis(page, { sessions: [] });
  // All three views are pre-staged — the underlying data doesn't
  // actually change per beat in our mock (the streamed chat is
  // fiction anyway), so showing the populated views after each
  // corresponding chat is a reasonable audience shortcut.
  await mockDemoViews(page, { sources: true, scheduler: true, wiki: true });
  const state: DemoStreamState = { send: null, channel: null, pendingEvents: [] };
  await installMockedAgentStream(page, state);

  await page.goto("/");
  await expect(chatInput(page)).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  // Settling pause so the opening frame of the recording is the
  // app ready-state rather than a loading shimmer.
  await page.waitForTimeout(1.5 * ONE_SECOND_MS);

  await test.step("Beat 1 — register news sources via chat", async () => {
    await playBeat(
      page,
      state,
      BEAT_1_SOURCE_REGISTER,
      "Register the top ten global finance news feeds — central banks, international bodies, regulators, and wire services — and ingest the latest articles.",
    );
  });

  await test.step("Confirm the registered feeds in the Sources view", async () => {
    await navigateToPluginView(page, "sources");
    // Every registered feed's title should render somewhere on the
    // Sources page.
    for (const source of DEMO_SOURCES) {
      await expect(page.locator("body")).toContainText(source.title, { timeout: 10 * ONE_SECOND_MS });
    }
    await page.waitForTimeout(VIEW_HOLD_MS);
    await returnToChat(page);
  });

  await test.step("Beat 2 — schedule the daily briefing", async () => {
    await playBeat(
      page,
      state,
      BEAT_2_SCHEDULE_CREATE,
      "Schedule a task that runs every morning at 6:00 local and produces today's briefing from the registered sources.",
    );
  });

  await test.step("Confirm the scheduled task in the Scheduler view", async () => {
    await navigateToPluginView(page, "scheduler");
    // The Scheduler plugin opens on the Calendar tab by default; the
    // scheduled task lives on the Tasks tab — click across so the
    // audience sees the registered row.
    await page.getByTestId("scheduler-tab-tasks").click();
    await expect(page.locator("body")).toContainText(DEMO_TASK.name, { timeout: 10 * ONE_SECOND_MS });
    await page.waitForTimeout(VIEW_HOLD_MS);
    await returnToChat(page);
  });

  await test.step("Beat 3 — run the briefing now and publish to wiki", async () => {
    await playBeat(page, state, BEAT_3_BRIEFING_GENERATE, "Run that task now, publish the briefing to the wiki, and show me the page.");
  });

  await test.step("Confirm the published briefing in the Wiki view", async () => {
    await navigateToPluginView(page, "wiki");
    // Wiki opens on the index; click the generated page entry so
    // the full briefing renders in the canvas.
    await page.getByTestId(`wiki-page-entry-${DEMO_WIKI_SLUG}`).click();
    // "Front Page" is a section heading unique to the rendered
    // briefing — anchoring on it confirms the page body loaded
    // (not just the sidebar entry).
    await expect(page.locator("body")).toContainText("Front Page", { timeout: 10 * ONE_SECOND_MS });
    // Brief hold at the top so the audience sees the headline
    // and the "Generated …" blurb before the scroll starts.
    await page.waitForTimeout(2 * ONE_SECOND_MS);
    // Slow scroll from top to bottom — covers all seven sections,
    // the inline SVG yield-move chart under Markets, and the
    // Unicode bar chart in the Sources Consulted table.
    await slowScrollWiki(page, 180, 450);
  });

  // Hold the final frame longer so the finished briefing is
  // readable at the end of the recording.
  await page.waitForTimeout(6 * ONE_SECOND_MS);
});
