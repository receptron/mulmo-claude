// Canned SSE event sequences for the finance-news demo.
//
// Each script mirrors what a real MulmoClaude agent would emit while
// running the corresponding tool calls (manageSource / manageScheduler
// / presentDocument / wiki) and generating a briefing, but stays
// deterministic so the demo lands the same way every time without
// waiting on real Claude latency.

// Minimal shape the frontend consumes for each stream event. We
// don't re-import from `src/types/events.ts` because this file is
// run by Playwright against plain JSON — any type drift would
// appear at demo-time in the UI itself, which is a better signal
// than a tsc error.

export interface AgentEvent {
  type: string;
  source?: string;
  message?: string;
  toolName?: string;
  toolUseId?: string;
  args?: Record<string, unknown>;
  content?: string;
}

// A "paragraph" helper that chunks text the way real streaming
// responses arrive — small fragments so the canvas animates
// rather than appearing all at once.
function streamingText(source: "assistant" | "user", text: string, chunkSize = 24): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    events.push({ type: "text", source, message: text.slice(offset, offset + chunkSize) });
  }
  return events;
}

// The ten curated sources the demo registers. Exported so the mock
// fixture can stage the Sources view response after Beat 1 — the
// article counts here match the per-source numbers streamed in the
// chat tool-call results.
export interface DemoSource {
  slug: string;
  title: string;
  url: string;
  category: string;
  articleCount: number;
}

export const DEMO_SOURCES: readonly DemoSource[] = [
  { slug: "federal-reserve", title: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "central-bank", articleCount: 5 },
  { slug: "european-central-bank", title: "European Central Bank", url: "https://www.ecb.europa.eu/rss/press.html", category: "central-bank", articleCount: 4 },
  { slug: "bank-of-england", title: "Bank of England", url: "https://www.bankofengland.co.uk/rss/news", category: "central-bank", articleCount: 3 },
  {
    slug: "bis",
    title: "Bank for International Settlements",
    url: "https://www.bis.org/list/press_releases/date.rss",
    category: "international",
    articleCount: 3,
  },
  { slug: "imf", title: "IMF News", url: "https://www.imf.org/en/News/RSS", category: "international", articleCount: 4 },
  { slug: "sec", title: "SEC Press Releases", url: "https://www.sec.gov/news/pressreleases.rss", category: "regulator", articleCount: 5 },
  { slug: "fsb", title: "Financial Stability Board", url: "https://www.fsb.org/feed/", category: "regulator", articleCount: 2 },
  {
    slug: "reuters-finance",
    title: "Reuters Finance",
    url: "https://www.reutersagency.com/feed/?best-sectors=financial-services",
    category: "media",
    articleCount: 8,
  },
  { slug: "ft-markets", title: "Financial Times Markets", url: "https://www.ft.com/markets?format=rss", category: "media", articleCount: 7 },
  { slug: "bloomberg-markets", title: "Bloomberg Markets", url: "https://www.bloomberg.com/feed/markets.xml", category: "media", articleCount: 6 },
];

export const DEMO_TOTAL_ARTICLES = DEMO_SOURCES.reduce((sum, source) => sum + source.articleCount, 0);

// The wiki slug / page title Beat 3 writes the briefing to.
export const DEMO_WIKI_SLUG = "daily-finance-briefing-2026-04-24";
export const DEMO_WIKI_TITLE = "Daily Finance Briefing — 2026-04-24";

// The task the scheduler view displays after Beat 2.
export const DEMO_TASK = {
  id: "finance-daily-briefing",
  name: "Finance daily briefing",
  prompt:
    "Read every registered financial news source, cluster today's articles by topic, compute day-over-day deltas, write a newspaper-style briefing to the wiki, and post a summary to #finance-daily on Slack.",
  schedule: { type: "daily" as const, time: "06:00" },
} as const;

// Build the "✅ registered N sources" summary line streamed back to
// the chat at the end of Beat 1. Kept as a function so the demo
// source list is the single source of truth — adding a source
// changes both the tool calls AND the recap.
function buildSourcesRecap(): string {
  const bulletLines = DEMO_SOURCES.map((source) => `- **${source.title}**: ${source.articleCount} articles`);
  return [
    "✅ Done:",
    "",
    ...bulletLines,
    "",
    `${DEMO_TOTAL_ARTICLES} articles total across ${DEMO_SOURCES.length} sources, saved under \`data/sources/\`. Ready to query from the Sources tab.`,
  ].join("\n");
}

function buildSourcesToolEvents(): AgentEvent[] {
  const events: AgentEvent[] = [];
  DEMO_SOURCES.forEach((source, index) => {
    const toolUseId = `demo-src-${index + 1}`;
    events.push({
      type: "tool_call",
      toolUseId,
      toolName: "manageSource",
      args: { action: "addSource", url: source.url, label: source.title },
    });
    events.push({
      type: "tool_call_result",
      toolUseId,
      content: `Added source: ${source.title} (${source.url}). Ingested ${source.articleCount} new articles.`,
    });
  });
  return events;
}

// Beat 1 — user registers RSS sources and asks for an initial ingest.
// The agent calls `manageSource` ten times, then confirms with a
// bulleted summary.
export const BEAT_1_SOURCE_REGISTER: AgentEvent[] = [
  { type: "status", message: "Registering sources…" },
  ...streamingText(
    "assistant",
    "I'll register ten global financial-news feeds — central banks, international bodies, regulators, and wire services — and ingest today's articles for each.\n\n",
  ),
  ...buildSourcesToolEvents(),
  ...streamingText("assistant", buildSourcesRecap()),
  { type: "session_finished" },
];

// Beat 2 — user asks for a daily briefing schedule. The agent creates
// a scheduled task via `manageScheduler`.
export const BEAT_2_SCHEDULE_CREATE: AgentEvent[] = [
  { type: "status", message: "Creating scheduled task…" },
  ...streamingText(
    "assistant",
    "I'll register a daily task that runs at 06:00 local time, reads every registered source, and produces a newspaper-style briefing in the wiki.\n\n",
  ),
  {
    type: "tool_call",
    toolUseId: "demo-sched-1",
    toolName: "manageScheduler",
    args: {
      action: "createTask",
      id: DEMO_TASK.id,
      name: DEMO_TASK.name,
      prompt: DEMO_TASK.prompt,
      schedule: DEMO_TASK.schedule,
    },
  },
  {
    type: "tool_call_result",
    toolUseId: "demo-sched-1",
    content: `Task created: "${DEMO_TASK.id}" — daily at ${DEMO_TASK.schedule.time} local.`,
  },
  ...streamingText(
    "assistant",
    [
      "✅ Scheduled:",
      "",
      `- **Task ID**: \`${DEMO_TASK.id}\``,
      "- **Runs**: every morning at 06:00 local time",
      "- **Next run**: tomorrow 06:00",
      "- **Output**: wiki page + Slack summary to #finance-daily",
      "",
      "You can also trigger it immediately from the Scheduler tab with `▶ Run now`.",
    ].join("\n"),
  ),
  { type: "session_finished" },
];

// Build an inline SVG horizontal bar chart — marked passes inline
// HTML through, so the chart renders inside the Wiki view exactly
// as it appears here. Kept self-contained (no external fonts /
// scripts) so the demo doesn't depend on any runtime fetch.
interface YieldMove {
  label: string;
  bpChange: number;
}

function buildYieldMoveChart(moves: readonly YieldMove[]): string {
  const chartWidth = 560;
  const rowHeight = 28;
  const labelWidth = 120;
  const valueWidth = 58;
  const barAreaWidth = chartWidth - labelWidth - valueWidth - 16;
  // Bars centre on 0 so positive and negative moves face opposite
  // sides, matching the way rate-change charts are conventionally
  // drawn. Scale so the max absolute move fills ~90% of the half-
  // width bar area.
  const maxAbs = Math.max(1, ...moves.map((move) => Math.abs(move.bpChange)));
  const pixelsPerBp = ((barAreaWidth / 2) * 0.9) / maxAbs;
  const centerX = labelWidth + barAreaWidth / 2;
  const height = moves.length * rowHeight + 40;
  const rows = moves
    .map((move, index) => {
      const rowY = 24 + index * rowHeight;
      const barWidth = Math.abs(move.bpChange) * pixelsPerBp;
      const barX = move.bpChange >= 0 ? centerX : centerX - barWidth;
      const fill = move.bpChange >= 0 ? "#2563eb" : "#dc2626";
      const valueText = `${move.bpChange > 0 ? "+" : ""}${move.bpChange} bp`;
      const valueX = chartWidth - valueWidth + 4;
      return [
        `<text x="${labelWidth - 8}" y="${rowY + 14}" text-anchor="end" font-size="12" fill="#374151">${move.label}</text>`,
        `<rect x="${barX}" y="${rowY + 4}" width="${barWidth}" height="16" fill="${fill}" rx="2"/>`,
        `<text x="${valueX}" y="${rowY + 14}" font-size="11" fill="#111827">${valueText}</text>`,
      ].join("");
    })
    .join("");
  const axis = `<line x1="${centerX}" y1="20" x2="${centerX}" y2="${height - 12}" stroke="#9ca3af" stroke-width="1"/>`;
  const title =
    `<text x="${labelWidth - 8}" y="14" text-anchor="end" font-size="11" fill="#6b7280">tenor</text>` +
    `<text x="${centerX}" y="14" text-anchor="middle" font-size="11" fill="#6b7280">Δ vs. prior close (basis points)</text>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartWidth} ${height}" width="${chartWidth}" height="${height}" role="img" aria-label="Yield moves by tenor">`,
    `<rect x="0" y="0" width="${chartWidth}" height="${height}" fill="#f9fafb" rx="4"/>`,
    title,
    axis,
    rows,
    "</svg>",
  ].join("");
}

// Unicode horizontal bars for the Sources-Consulted table — renders
// anywhere Markdown shows up (chat tool result AND wiki view) and
// doesn't depend on HTML passthrough.
function unicodeBar(value: number, max: number, width = 18): string {
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "·".repeat(Math.max(0, width - filled));
}

// The newspaper-style briefing Beat 3 writes to the wiki. Exported so
// the mock fixture can return the identical body from /api/wiki after
// Beat 3 — keeping the wiki view and the canvas card in sync.
export const DEMO_BRIEFING_MARKDOWN = [
  `# ${DEMO_WIKI_TITLE}`,
  "",
  "> Generated 2026-04-24 06:00 local · 10 sources · 47 articles · wall-clock 18 s",
  "",
  "---",
  "",
  "## Front Page",
  "",
  "- **Fed signals patience on rate cuts at April FOMC** — Federal Reserve keeps target range at 4.25–4.50%, pushes back against near-term cut pricing. **Changed** vs. yesterday.",
  "- **ECB advances digital euro preparation phase through 2027** — rulebook draft out for public comment, holding limits and offline-payment safeguards in focus. **New**.",
  "- **SEC finalizes crypto-custody rule for registered advisers** — four-to-one vote, compliance window runs to Q1 2027. **New**.",
  "- **IMF trims 2026 global growth forecast to 2.9%** — softer US consumption and euro-area manufacturing drag the outlook; Asia revised up. **Changed**.",
  "",
  "## Monetary Policy",
  "",
  "### Federal Reserve — FOMC holds, pushes back on June cut",
  "The Federal Open Market Committee voted unanimously to leave the target range for the federal funds rate at 4.25–4.50%. The statement emphasized that inflation has eased but remains above target, and that the Committee does not expect it to be appropriate to reduce the target range until it has gained greater confidence that inflation is moving sustainably toward 2%. Chair Powell's press conference walked back the dovish interpretation of the March minutes, with services-excluding-housing the stated dominant risk.",
  "- Source: [Federal Reserve — 2026-04-24 FOMC Statement](https://www.federalreserve.gov/monetarypolicy/fomcpresconf20260424.htm) · **Changed**",
  "",
  "### European Central Bank — Lagarde reiterates meeting-by-meeting approach",
  "At today's post-Governing-Council press conference, President Lagarde repeated that rate decisions will remain data-dependent and that the Council is not pre-committing to a particular rate path. Markets read the tone as moderately hawkish; two-year Bund yields moved +6 bp.",
  "- Source: [ECB — 2026-04-24 Monetary Policy Statement](https://www.ecb.europa.eu/press/pressconf/2026/html/ecb.is260424.en.html) · **Continuing**",
  "",
  "### Bank of England — MPC minutes flag services inflation",
  "The April MPC minutes, released today, show a 6-3 vote to hold Bank Rate at 4.00%. Three members voted to cut by 25 bp, citing the weakening labor-market tightness indicators. The minutes highlight services-CPI as the key obstacle to a consensus cut.",
  "- Source: [Bank of England — April 2026 MPC Minutes](https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/april-2026) · **New**",
  "",
  "## Regulation & Supervision",
  "",
  "### SEC finalizes crypto-custody rule for registered advisers",
  "The Securities and Exchange Commission voted 4-1 to finalize amendments to the Investment Advisers Act custody rule, extending qualified-custodian requirements to a broader set of digital assets and imposing new segregation obligations. The compliance date is Q1 2027 for advisers with more than $1B under management; smaller advisers get until Q3 2027.",
  "- Source: [SEC — Press Release 2026-68](https://www.sec.gov/news/press-release/2026-68) · **New**",
  "",
  "### FSB publishes peer review on climate-related financial risk disclosures",
  "The Financial Stability Board issued its 2026 peer review of jurisdictional progress on climate-risk disclosure. Twelve of nineteen G20 jurisdictions have now mandated or proposed ISSB-aligned disclosure; the review flags supervisory data gaps around transition-plan assumptions.",
  "- Source: [FSB — 2026 Climate Disclosure Peer Review](https://www.fsb.org/2026/04/climate-disclosure-peer-review/) · **New**",
  "",
  "### ECB SSM publishes aggregated supervisory priorities 2026-2028",
  "The Single Supervisory Mechanism released its three-year aggregated priorities memo. Emphasis on geopolitical risk, cyber-operational resilience, and credit-risk reclassification on commercial real estate exposures.",
  "- Source: [ECB Banking Supervision — Priorities 2026-28](https://www.bankingsupervision.europa.eu/banking/priorities/html/ssm.supervisory_priorities2026-28.en.html) · **Continuing**",
  "",
  "## Markets & Macro",
  "",
  "**Rates.** US 2Y +4 bp to 4.31%; 10Y +3 bp to 4.42%. Bund 2Y +6 bp, 10Y +4 bp. Gilt 10Y flat.",
  "",
  buildYieldMoveChart([
    { label: "US 2Y", bpChange: 4 },
    { label: "US 10Y", bpChange: 3 },
    { label: "Bund 2Y", bpChange: 6 },
    { label: "Bund 10Y", bpChange: 4 },
    { label: "Gilt 10Y", bpChange: 0 },
    { label: "JGB 10Y", bpChange: -1 },
  ]),
  "",
  "**FX.** EUR/USD -0.3% after Lagarde; GBP/USD +0.1%; USD/JPY +0.4% following Fed statement.",
  "",
  "**Equities.** S&P 500 futures -0.2% post-FOMC; Stoxx 600 +0.1%; Nikkei futures +0.3%.",
  "",
  "**Data prints.** US Durable Goods Orders +0.8% MoM (consensus +0.5%). Euro-area Consumer Confidence -14.7 (prior -15.1). UK CBI Industrial Trends -23 (prior -19).",
  "",
  "- Sources: [Reuters Markets wrap](https://www.reuters.com/markets/wrap-20260424/) · [FT Markets live](https://www.ft.com/markets/live/2026-04-24) · [Bloomberg cross-asset](https://www.bloomberg.com/markets/watchlist/20260424) · **Continuing**",
  "",
  "## Digital Assets & CBDC",
  "",
  "### ECB — digital-euro rulebook goes to public comment",
  "The ECB published the third progress report on the digital euro project and opened a 60-day public-comment window on the draft rulebook. Key questions: individual holding limits (currently framed at €3,000), offline-payment privacy architecture, and the intermediation model for supervised payment service providers.",
  "- Source: [ECB — Digital Euro Progress Report 3](https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260424.en.html) · **New**",
  "",
  "### SEC — crypto custody rule (see Regulation above)",
  "",
  "### BIS Innovation Hub — Project Agorá moves to pilot",
  "The BIS Innovation Hub's cross-border wholesale CBDC experiment advanced from the proof-of-concept phase to a limited live pilot with six participating central banks. Technical report expected Q3.",
  "- Source: [BIS — Project Agorá pilot announcement](https://www.bis.org/about/bisih/topics/cbdc/agora.htm) · **New**",
  "",
  "## International",
  "",
  "### IMF — WEO April update trims 2026 global growth to 2.9%",
  "The Fund cut its 2026 global growth forecast by 0.1 pp to 2.9%, citing weaker US consumption and soft euro-area industry. Asia was revised up 0.2 pp on stronger intra-regional trade. Risks tilt to the downside: geopolitical fragmentation and a sharper-than-expected credit tightening in commercial real estate lead the list.",
  "- Source: [IMF — World Economic Outlook Update, April 2026](https://www.imf.org/en/Publications/WEO/Issues/2026/04/weo-april-2026-update) · **Changed**",
  "",
  "### BIS Quarterly Review — non-bank intermediation under the microscope",
  "The April BIS Quarterly Review dedicates its special features to the expansion of non-bank financial intermediation and the resulting liquidity-mismatch channels. The review notes that open-ended funds now hold 28% of global corporate bond outstandings.",
  "- Source: [BIS — Quarterly Review April 2026](https://www.bis.org/publ/qtrpdf/r_qt2604.htm) · **New**",
  "",
  "## Agenda Ahead",
  "",
  "- **Apr 25 (Fri)** — US Q1 GDP advance estimate; euro-area Flash PMIs.",
  "- **Apr 29 (Tue)** — Bank of Japan Monetary Policy Meeting decision.",
  "- **Apr 30 (Wed)** — US PCE inflation (March); MSCI Japan quarterly rebalance.",
  "- **May 01 (Thu)** — ECB lending survey; FOMC minutes (from April).",
  "- **May 02 (Fri)** — US non-farm payrolls; Berkshire Hathaway annual meeting.",
  "",
  "## Sources Consulted",
  "",
  "Article counts by source (Unicode bars scale to the most-active feed):",
  "",
  "| Source | Category | Articles | Share |",
  "|---|---|---:|:---|",
  ...(() => {
    const maxArticles = Math.max(...DEMO_SOURCES.map((source) => source.articleCount));
    return DEMO_SOURCES.map(
      (source) => `| [${source.title}](${source.url}) | ${source.category} | ${source.articleCount} | \`${unicodeBar(source.articleCount, maxArticles)}\` |`,
    );
  })(),
  "",
  "---",
  "",
  "*Auto-generated from registered sources. Verify against primary sources before acting on any single claim. This page is re-written by the `finance-daily-briefing` scheduled task; prior versions are kept in `conversations/summaries/daily/`.*",
].join("\n");

// Beat 3 — user runs the briefing now. The agent simulates the
// scheduled task: reads sources, clusters topics, writes a daily
// wiki page, renders it in the canvas, and confirms.
export const BEAT_3_BRIEFING_GENERATE: AgentEvent[] = [
  { type: "status", message: "Generating today's briefing…" },
  ...streamingText(
    "assistant",
    `I'll pull the latest articles from all ${DEMO_SOURCES.length} registered sources, cluster them into topics, compute day-over-day deltas, and publish the result as a wiki page.\n\n`,
  ),
  {
    type: "tool_call",
    toolUseId: "demo-brief-1",
    toolName: "manageSource",
    args: { action: "readRecent", limit: DEMO_TOTAL_ARTICLES },
  },
  {
    type: "tool_call_result",
    toolUseId: "demo-brief-1",
    content: `Retrieved ${DEMO_TOTAL_ARTICLES} articles from ${DEMO_SOURCES.length} sources (last 24 hours).`,
  },
  {
    type: "tool_call",
    toolUseId: "demo-brief-2",
    toolName: "presentDocument",
    args: { filename: DEMO_WIKI_SLUG },
  },
  {
    type: "tool_call_result",
    toolUseId: "demo-brief-2",
    content: DEMO_BRIEFING_MARKDOWN,
  },
  {
    type: "tool_call",
    toolUseId: "demo-brief-3",
    toolName: "wiki",
    args: { action: "upsertPage", slug: DEMO_WIKI_SLUG, title: DEMO_WIKI_TITLE },
  },
  {
    type: "tool_call_result",
    toolUseId: "demo-brief-3",
    content: `Wiki page saved: "${DEMO_WIKI_TITLE}" at data/wiki/pages/${DEMO_WIKI_SLUG}.md`,
  },
  ...streamingText(
    "assistant",
    [
      "✅ Briefing published:",
      "",
      `- **Seven sections** — Front Page, Monetary Policy, Regulation, Markets, Digital Assets, International, Agenda Ahead`,
      `- **${DEMO_TOTAL_ARTICLES} articles** across ${DEMO_SOURCES.length} sources with day-over-day deltas (New / Changed / Continuing)`,
      "- **Inline citations** back to every primary source",
      "- **Sources-consulted table** at the bottom for provenance",
      "",
      `Saved to the wiki at \`data/wiki/pages/${DEMO_WIKI_SLUG}.md\` — the scheduled task rewrites this page every morning, so the wiki accrues a daily record you can browse historically.`,
    ].join("\n"),
  ),
  { type: "session_finished" },
];
