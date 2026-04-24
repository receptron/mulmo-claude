# MulmoClaude — Global finance / government demo

Automated Playwright script that drives the MulmoClaude UI through a three-beat demonstration inside one continuous session:

1. **Register news sources (chat → Sources view)** — agent registers ten global finance feeds (Fed, ECB, BoE, BIS, IMF, SEC, FSB, Reuters, FT, Bloomberg) via `manageSource`, then the spec switches to the **Sources** tab so the audience sees the feed list.
2. **Schedule the daily briefing (chat → Scheduler view)** — agent creates a `finance-daily-briefing` scheduled task via `manageScheduler`. The spec opens the **Scheduler → Tasks** tab and the registered task row is visible.
3. **Run the briefing now and publish to wiki (chat → Wiki view)** — agent pulls the articles, calls `presentDocument` to render a seven-section newspaper-style briefing, and calls `manageWiki` to save it. The spec opens the **Wiki** tab, clicks the new page entry, and the full briefing renders in the canvas.

All API calls are mocked inside the Playwright spec so the flow is deterministic regardless of real Claude latency. Use it in two ways:

- **Live demo** — run the spec in front of the audience, browser drives itself.
- **Pre-recorded** — Playwright records a WebM; replay during the meeting if network conditions aren't trusted.

## Run

```bash
yarn demo:finance
```

This opens a Chromium window (headed mode, 400 ms slowMo) and walks through the three beats end-to-end. Total runtime: **≈ 1 minute** with the current pacing constants (tunable at the top of `finance-news.spec.ts`).

The WebM recording lands under:

```
test-results/finance-news-finance-gover-…-report-chromium/video.webm
```

If you want a more polished format for presentation tooling (slides deck / Keynote embed), convert with ffmpeg:

```bash
ffmpeg -i test-results/<recording>/video.webm -c:v libx264 -preset slow -crf 18 mulmoclaude-demo.mp4
```

To insert narration slides between the beats, splice the WebM at beat boundaries (rough timestamps visible in the video) or record three separate passes with a narrower `test.step` scope and concat them with ffmpeg.

## Rehearse / record workflow

Before the actual meeting:

1. `yarn install` (fresh machine) — make sure Playwright browsers are installed: `npx playwright install chromium`.
2. `yarn demo:finance` once to warm the Vite cache and sanity-check the flow.
3. Second run is the keeper — WebM is captured on every run, the latest one ends up under `test-results/`.

If something looks off mid-run, press `Ctrl+C` in the terminal — the recording stops cleanly and the partial file is kept.

## Pacing

The recording tempo is controlled by five constants at the top of `finance-news.spec.ts`:

| Constant | Default | Effect |
|---|---|---|
| `TEXT_CHUNK_DELAY_MS` | 70 ms | Delay between streamed text fragments (assistant reply animation speed) |
| `TOOL_EVENT_DELAY_MS` | 500 ms | Delay between tool_call / tool_call_result events (how quickly each tool step lands) |
| `PRE_SEND_PAUSE_MS` | 900 ms | Pause after the prompt is typed before Send is clicked |
| `POST_BEAT_PAUSE_MS` | 3 s | Pause after the assistant wraps up before switching views |
| `VIEW_HOLD_MS` | 5 s | How long each confirmation view stays on screen |

Bump these to slow the recording down for a live demo; cut them in half for quick rehearsals.

## What's mocked vs. what's real

| Piece | Real | Mocked |
|---|---|---|
| Vite frontend (UI, routing, canvas) | ✅ | |
| Keystrokes / clicks / tab switches | ✅ (Playwright) | |
| Chat input, session state, rendering | ✅ | |
| `/api/agent` POST | | ✅ (202 ack only) |
| `/ws/pubsub` socket.io events | | ✅ (canned events in `agent-scripts.ts`) |
| `/api/sessions`, `/api/todos`, `/api/health`, … | | ✅ (`fixtures/api.ts` `mockAllApis`) |
| `/api/sources`, `/api/scheduler/tasks`, `/api/wiki` | | ✅ (`e2e/demo/fixtures.ts` `mockDemoViews`) |
| Claude agent invocation | | ✅ (never called) |

Because no real backend is running, the demo doesn't touch `~/mulmoclaude/` — your real workspace stays untouched. The ten source cards, scheduler task row, and wiki page all come from the canned mock content, not the filesystem.

## Editing the demo

`agent-scripts.ts` is the single source of truth for:

- `DEMO_SOURCES` — ten feeds shown in the Sources view (tool calls + mock response both derive from this list).
- `DEMO_TASK` — the scheduled task shown in the Scheduler view.
- `DEMO_BRIEFING_MARKDOWN` — the newspaper-style briefing rendered in the Wiki view.
- `BEAT_1_SOURCE_REGISTER` / `BEAT_2_SCHEDULE_CREATE` / `BEAT_3_BRIEFING_GENERATE` — the per-beat SSE event streams.

Common edits:

- **Change the user prompt** — edit the matching `playBeat(page, state, …, "prompt")` line in `finance-news.spec.ts`.
- **Change the assistant's reply** — edit the `streamingText("assistant", …)` calls in the corresponding beat.
- **Add or remove a source** — edit `DEMO_SOURCES`; the tool calls and Sources-view mock regenerate automatically.
- **Change the wiki briefing body** — edit `DEMO_BRIEFING_MARKDOWN`; it flows through both the chat tool-call result and the `/api/wiki` mock.
- **Speed up / slow down** — adjust the pacing constants at the top of `finance-news.spec.ts` (table above).

## Variants for other audiences

Swap the ten sources in `DEMO_SOURCES` and the topic clusters in `DEMO_BRIEFING_MARKDOWN` for a different flavour:

- **Asia-Pacific central bank watch** — BOJ + PBoC + RBA + MAS press feeds
- **Policy briefing (政府向け)** — ministry RSS feeds + legislation tracker
- **Sector research (事業会社)** — competitor IR feeds + analyst reports
- **Security watch** — vendor advisories + CVE trackers

Each swap is a localised text edit in `agent-scripts.ts` — the spec structure stays identical.

## Troubleshooting

- **Port 45173 busy** — another Vite instance is running. Kill it or adjust the spec's `baseURL`.
- **No WebM under test-results/** — check that Playwright isn't running in headless mode somewhere (CI env var would override the config). The config's `headless: false` should win when invoked via `yarn demo:finance`.
- **Text doesn't animate** — the per-event delay constants at the top of `finance-news.spec.ts` may have been set to 0. Defaults: 70 ms between streamed text chunks, 500 ms between tool events.
- **Beat 3 anchor timeout** — the Wiki view POSTs to `/api/wiki` on mount; if the mock is missing the POST branch the view hangs on the pending request. `fixtures.ts` already dispatches on method + body.action; if you extend the wiki tool, keep that dispatch in sync.
