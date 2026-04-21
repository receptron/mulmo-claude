# MulmoClaude — Product Hunt Launch Strategy

**Owner:** CMO (strategy), Engineering (demo assets), Community (day-of ops)
**Target launch:** Tuesday, one week out — 12:01 AM PT kickoff
**Positioning one-liner:** *Claude Code that creates documents, videos, and your personal knowledge base.*
**Core thesis (the story behind the product):** **Every AI agent in 2026 has amnesia.** Claude Code, Devin, Codex, ChatGPT, Cursor — they all start each task from zero. ChatGPT's "memory" is a fragmented bullet list. Claude.ai Projects require manual uploads. Mem.ai and Obsidian are inert — they don't grow themselves. **MulmoClaude is the cure.** It gives Claude Code a file system, a scheduler, and a memory that compounds — all in one local folder (`~/mulmoclaude/`) on the user's machine. The AI has a home. It remembers. It works while you sleep. You own it. That's the whole thesis.

**2026 reality check (what's commoditized vs. what's frontier):** Rich output (Artifacts), mobile AI (ChatGPT app, OpenClaw), sandboxing, and code generation are all **commoditized** — don't lead with them. The remaining frontier, and where MulmoClaude wins, is **memory + autonomy + ownership**. These three are still unsolved by every major player. That's the category-defining gap, and this plan is organized entirely around filling it.
**Target early adopter (one audience, not four):** Claude Code power users who have already hit the limits of the terminal. Everyone else — productivity users, knowledge workers, AI enthusiasts — is phase 2 and will come via these users, not in parallel to them.

---

## 1. Positioning & Tagline

### Primary tagline (Product Hunt hero line)

> **MulmoClaude — Claude Code that creates documents, videos, and your personal knowledge base.**

This one sentence is the whole product. Three nouns do the entire job: *documents* and *videos* tell the viewer what they get back (concrete outputs); *your personal knowledge base* is the moat — local, yours, and compounding across every session. Every surface — hero video, PH headline, tweet #1, gallery captions — must trace back to it. Everything else (parallel sessions, bridges, sandbox, roles, skills, charts) is *evidence*, not the message.

**Drafting rule:** whenever you're tempted to write "artifacts," write the concrete nouns (documents, videos) and the moat ("your personal knowledge base") instead. Abstractions lose upvotes.

### Supporting taglines (A/B candidates for social + hero imagery)

1. *Docs. Presentations. Spreadsheets. Videos. Out of Claude Code. And it remembers.*
2. *Claude Code that produces the things you actually ship — and gets smarter every chat.*
3. *Turn any research paper into a document, a deck, and a narrated video — without opening anything else.*
4. *Run five Claude Code agents in one browser tab. Get documents, decks, and videos back — not text.*
5. *`~/mulmoclaude/` — a local knowledge base that grows itself. Web, files, conversations — all here. Reach it from anywhere.* **(Geek-targeted; use on HN, X-dev, terminal-native audiences.)**

### Category pick

Primary: **Developer Tools** · Secondary: **Artificial Intelligence**
Dev Tools is where our one audience (Claude Code power users) lives. We skip Productivity entirely — chasing two audiences on PH day means landing neither. AI is a defensive tertiary at most.

---

## 2. The One-Sentence Pitch

**MulmoClaude turns Claude Code into a system that produces real documents, presentations, spreadsheets, and narrated videos, runs multiple agents at once, and builds a personal knowledge base from everything you do.**

Three clauses, in the order a user asks them: *What does it make? How fast? Does it get smarter?* Everything else in this plan is supporting evidence.

### The deeper frame (use when the viewer is ready for more)

> **An AI-built workspace that grows itself. Research, organizing, file management — all automatic. Reach it from anywhere. All local, all yours.**

The real differentiator is not any feature — it's the **location**. Web articles (via source crawling), chat conversations (via automatic wiki extraction), local files (via the file explorer), scheduled runs, phone messages — *everything converges into one folder*, as plain Markdown, maintained by Claude. Notion is cloud. Google Drive is cloud. Obsidian is local but the AI doesn't grow it for you. MulmoClaude is **all three properties in one place: local, AI-maintained, multi-source.**

### The anti-wrapper line (use this whenever "is it just a ChatGPT clone?" shows up)

> **This doesn't call the Claude API. It runs Claude Code directly — your auth, your tools, your files, your environment.**

That distinction is the whole reason the product can do what it does. Repeat it verbatim in the maker post, the HN title, and tweet #1.

---

## 3. Why This Wins on Product Hunt

Product Hunt voters reward three things: **a clear "aha"**, **a short demo**, and **a narrative that isn't another wrapper**. MulmoClaude lands all three:

| Hunt instinct                                   | MulmoClaude's answer                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| "Is this just another AI chat wrapper?"         | No — it runs the Claude Code CLI directly (not the API). And the pitch isn't "chat + pretty output" — it's **fixing agent amnesia.** |
| "What's the new idea?"                          | **Every AI agent has amnesia. This one doesn't.** Claude gets a file system, a scheduler, and a memory that compounds across sessions. |
| "Isn't that just ChatGPT Memory / Obsidian?"    | ChatGPT Memory is a bullet list. Obsidian is inert. Mem.ai needs manual curation. **MulmoClaude builds a cross-linked knowledge base as a byproduct of the chat.** Zero manual effort. |
| "Can Claude.ai Projects do this?"               | Projects need manual uploads. MulmoClaude auto-accumulates — every chat, every crawled article, every scheduled run lands in the wiki. |
| "Why should I care tomorrow?"                   | It **works while you sleep.** Register a source, get a morning briefing. Schedule a task, find the report done. No other agent ships this. |

---

## 4. Key Messages (3, collapsed from 5 — 2026 re-cut)

A PH viewer skims for ~10 seconds and remembers **one** idea. Five is too many. The 2026 market has commoditized rich output, mobile AI, and sandboxing — so those can't anchor the pitch anymore. The three remaining anchors are **memory, autonomy, ownership.** That's it.

### The three (rank-ordered)

**1. The agent that remembers.** — *Every AI agent has amnesia. This one doesn't.*

A personal wiki grows from every chat — automatically, cross-linked, in plain Markdown on your machine. Three days later, Claude wires today's question to what it learned then, without you saving anything. **This is the moat.** The longer you use it, the more painful it is to switch away.

- **vs ChatGPT Memory:** fragmented bullet points, not a knowledge base. MulmoClaude gives you a *cross-linked wiki*.
- **vs Mem.ai / Obsidian:** zero manual effort. Knowledge grows as a byproduct of conversation — you never stop to "file" anything.
- **vs Claude.ai Projects:** no manual uploads. Chats, crawled articles, generated images, search results, temporary summaries — *all* flow into memory automatically and become available from any future session.
- *Eventually, memory itself should be inferred:* the agent decides what's worth remembering, the way it already decides what to generate. That's the endgame.

**2. The agent that works while you sleep.** — *Other agents wait for you. This one has a schedule.*

Register a source — get a morning briefing waiting when you open the lid. Schedule a weekly report — find it in the workspace without asking. Close the laptop, come back to a catch-up. **GUI + persistent state + catch-up after missed runs — no other AI agent ships this combination.** The memory moat (#1) plus autonomous execution (#2) is what compounds: the agent keeps learning while you're not looking.

- **vs Devin / Codex / Claude Code today:** they're one-shot executors. You open them, they work, they stop. MulmoClaude runs in the background.
- **vs cron + Claude API hacks:** power users cobble these together, but nobody ships GUI + persistence + catch-up out of the box.
- *Eventually, scheduling should be autonomous too:* like memory, the agent should infer what to schedule, not wait for the user to specify cron expressions. That's what "an agent that works while you sleep" means at full resolution.

**3. Your machine, your data, your agent.** — *It all lives in `~/mulmoclaude/`. Plain Markdown. Git-friendly. No cloud. No lock-in.*

Web articles, chats, local files, generated images and videos, search results, scheduled outputs — everything lands in one folder as plain text. `git push` to a private repo and it's backed up. Open any file in any editor. Read it in 10 years without a migration.

- **vs Notion / Mem.ai / ChatGPT:** not cloud. No export flow because there's nothing to export — it's already plain text on your disk.
- **vs Obsidian:** local, but the AI grows it for you. Zero manual curation.
- Hits the "own your AI" sentiment directly — a phrase that already travels on X.
- Sandbox (Docker, auto-detected) gets folded in here, not its own message: it's *how* we keep "your machine, your data" honest, not a separate pitch.

### The visual hook (not a message — a demo banger)

**Three parallel Claude Code sessions running at once** is still the single strongest shareable visual we have. But it's no longer a *message* — it's the **hook**. Use it to earn attention on Twitter and in the PH gallery; use the three messages above to earn the follow-through. Visuals sell the click; memory + autonomy + ownership sell the try.

### Kept in reserve (2026 table stakes — don't lead, but keep warm for FAQ)

- **Multi-modal output — documents, decks, spreadsheets, videos.** Claude Artifacts commoditized this. Still a capability, still strong demo material, but no longer category-defining. Mention after the three messages have landed.
- **Mobile bridges (Telegram, Slack, LINE, WhatsApp, Discord, Matrix).** OpenClaw (Claude's mobile app) arrived first to the "Claude on your phone" story. Our unique angle now: *your phone writes into the same persistent memory as your laptop* — but that's a message-#1 proof point, not its own pillar.
- **Docker sandbox.** Expected hygiene in 2026, not a headline. Absorbed into message #3.
- **Roles, skills launcher, Markdown-as-database, ECharts, file attachments.** Comment-thread fuel — deploy when a specific question opens the door.

---

## 5. Product Hunt Listing Copy

### Headline (60 char max)
`MulmoClaude — Docs, videos, and a growing knowledge base` *(56 chars — short form of the 91-char hero tagline)*

### Tagline (60 char max)
`Parallel sessions. Personal wiki. Phone bridges. Sandboxed.` *(58 chars)*

### First comment (the maker post — pinned)

```
Hi Product Hunt 👋

I'm Satoshi Nakajima. I spent thirteen and half years at Microsoft working on
operating systems (lead architect on early Windows releases), then
spent the last year obsessing over a single question: **what does an
AI-native OS actually look like?**

I don't think it's ChatGPT. I don't think it's Copilot. I think the
kernel is something like Claude Code — an agent with direct access to
your files, your tools, your environment. Powerful, but living inside
a terminal.

Terminals were the OS shell of 1975. We can do better.

MulmoClaude is my attempt at the **shell for that new kernel**. It
does three things:

**1. Claude replies with real documents, decks, spreadsheets, and videos — not text.**
Documents, spreadsheets, ECharts dashboards, forms, 3D scenes — and
full narrated slide decks and AI-generated videos via the built-in
MulmoScript / MulmoCast engine (Gemini image + Veo 3.1 video +
audio). Drop in a research paper, get back a summary doc, a deck, and
a narrated video. No other tools opened.

**2. It runs many Claude Code agents in parallel, in one browser tab.**
Kick off a video render in one session, refactor code in another,
draft an email in a third. While one is working, you keep working.
Claude Code is no longer single-threaded.

**3. It gets smarter every conversation.**
Every ingested article, every decision, every fact becomes a
cross-linked page in a personal wiki Claude builds and maintains
itself (inspired by @karpathy's *LLM Knowledge Bases* post). It's
all plain Markdown in `~/mulmoclaude/` — git-friendly, portable,
yours. This is the part I'm proudest of: **every other Claude client
starts from zero; this one compounds.**

Two details that matter:

- **Not a wrapper.** This doesn't call the Claude API. It runs the
  actual Claude Code CLI — your auth, your filesystem, your skills,
  your MCP servers. That's why it can do what it does.
- **Sandboxed by default.** Claude runs inside a Docker container
  that only sees your workspace. SSH keys, `.env` files, home
  directory — invisible. Auto-detected on launch, no configuration.

You can also reach the same workspace from Telegram, Slack, LINE,
Discord, WhatsApp, Matrix — same agent, same wiki memory. Fire a
task from the subway, see the result on your laptop.

Open source, MIT.

If you're already a Claude Code power user who's hit the walls of
the terminal, this is built for you. Would love your honest feedback
— this is the first visible surface of a much bigger thesis about
what computing looks like when AI is the kernel.

— Satoshi
```

### Description / gallery captions (one per screenshot)

5 captions. Caption #1 is the parallel-sessions visual hook; captions #2–#4 are the three key messages; caption #5 is the anti-wrapper proof. No orphans, no reserve features.

1. **Hook — Parallel sessions** — "Three Claude Code agents in one browser tab. One researches, one writes docs, one builds charts. Now watch what happens tomorrow."
2. **#1 Memory** — "Every AI agent has amnesia. This one doesn't. A cross-linked wiki grows from every chat — automatically, in plain Markdown on your machine."
3. **#2 Autonomy** — "Other agents wait for you. This one has a schedule. Register a source, get a morning briefing. Close the lid, come back to catch-up."
4. **#3 Ownership** — "It all lives in `~/mulmoclaude/`. Plain Markdown. `git push` is the backup. No cloud, no lock-in."
5. **Proof — not a wrapper** — "Runs the Claude Code CLI directly. Your auth, your tools, your files. Sandboxed in Docker so it stays in its lane."

---

## 6. Demo Video Plan

Three videos — each serves a different channel. **Always record silent first; add a single-voice narration pass; ship captions.**

### Video A — The 60-second hero (Product Hunt gallery + Twitter/X)

- **Goal:** earn one upvote per viewer. No feature-listing.
- **The single moment we must land:** a session "tomorrow" asking about something learned "yesterday" — and Claude answers grounded in the wiki it built itself. *That* is the amnesia cure made visible. The parallel-sessions splash is the eye-catcher; the memory payoff is the heart.
- **Hook (opener):** three parallel Claude Code sessions already running when the video starts. It reads as "wait, it runs multiple agents at once?" — attention earned in 3 seconds.
- **Structure:**
  - 0:00–0:08 — Cold open: split-screen, three sessions already mid-stream. Session 1 researches a topic, Session 2 drafts docs from it, Session 3 renders charts. No logo, no title card. Caption fades in: *"3 Claude Code agents. One browser tab."*
  - 0:08–0:15 — Wiki sidebar zoom: new pages appear, auto-cross-linked to existing ones as the sessions work. Caption: *"Everything they learn is saved — automatically."*
  - 0:15–0:30 — **The memory payoff (money shot).** Time-cut overlay: *"Tomorrow."* A fresh session opens. User types a question that touches yesterday's topic. Claude answers with the wiki cross-link visible. Caption: *"Every AI agent has amnesia. This one doesn't."*
  - 0:30–0:40 — Scheduler beat. Show the scheduler view: a registered source triggers overnight, a morning briefing appears on the canvas. Caption: *"Other agents wait for you. This one works while you sleep."*
  - 0:40–0:50 — Ownership beat. Finder / terminal open `~/mulmoclaude/` — plain Markdown files visible. A `git push` scrolls by. Caption: *"It all lives on your machine. Plain Markdown. Git-friendly. No cloud."*
  - 0:50–0:55 — Anti-wrapper beat. Single white-on-black frame: *"Not an API wrapper. Claude Code, directly."*
  - 0:55–1:00 — Logo + `npx create-mulmoclaude` + github URL. (If a hosted demo or `--demo` mode ships — see §10.5 — swap in that CTA.)
- **Production notes:** 1080p screen capture, 24fps, no zoom transitions, monospace captions. Music: one royalty-free lo-fi track at 40% — cut it at 0:55. **Non-negotiable:** zero spinner time. Pre-render, splice, don't wait. The 0:15–0:30 memory payoff is the money shot — shoot it twice, pick the crisper take.

### Video B — The 3-minute deep-dive (YouTube + landing page)

- **Goal:** convert a developer watcher into a `git clone` (or a hosted-demo click).
- **Narrative arc:** *What does it make? How fast? Does it get smarter? Can I trust it?* — exactly the order the user's brain asks.
- **Outline:**
  - 0:00–0:20 — Problem framing, in Satoshi's voice: "I worked on Windows for eight years. Claude Code is the kernel of an AI-native OS. But kernels need shells. Here's the shell I wanted."
  - 0:20–0:50 — **Shock demo.** Drop a research paper PDF. Out comes a summary document, a slide deck, and a narrated MulmoCast video. Call out: *the answer isn't text, it's an artifact. Powered by GUI Chat Protocol.*
  - 0:50–1:30 — Open two more sessions in parallel. Kick off another MulmoCast video in one, refactor a real codebase in another. Three artifacts produced simultaneously. Call out: *"one browser tab, many Claude Code workers."*
  - 1:30–2:10 — **The compounding moment.** Ingest two related articles. Show wiki backlinks appearing. Open a fresh session tomorrow's simulated morning and ask a question — Claude answers grounded in the wiki it built itself. Call out: *"every other Claude client starts from zero. This one compounds."*
  - 2:10–2:30 — Bridges. Message from **Telegram** and **LINE**; show desktop canvas updating live. Same memory, same workspace.
  - 2:30–2:50 — Trust layer. Docker sandbox banner. Show Claude being *unable* to read a file outside the workspace. Frame against tools that run Claude directly on `~/`. Anti-wrapper line on-screen.
  - 2:50–3:00 — Open source, MIT. Hosted demo link + github link.
- **Production notes:** talking-head inset bottom-right for the first 20 seconds, then pure screencast.

### Video C — The 15-second loop (Instagram, LinkedIn, PH gallery motion)

- Single prompt → single rich visual result → fade to logo. Meant to be muted.
- Shoot 3 variants: **(a)** three parallel sessions running at once, **(b)** a full MulmoCast narrated video rendering, **(c)** Telegram-to-canvas round trip. Pick the strongest for PH; post the other two on launch day.

### Filming checklist (applies to all)

- Use a clean workspace (fresh `~/mulmoclaude/`) so the file tree isn't cluttered.
- Record at 1920×1080 minimum; export H.264 at 8 Mbps.
- Pre-compose all prompts in a text file — don't let live-typing slow the pace. Paste and hit send.
- Do a dry run with the exact network Claude will hit. Agent latency is the #1 demo killer.
- If a plugin takes >8s to render, **cut the wait** — PH viewers don't forgive dead air.

---

## 7. Launch Week Timeline (T = launch day)

### T-14 to T-8 — Asset build

- [ ] Finalize hero video, 3-min video, 3× 15s loops, 7 screenshots
- [ ] Register Product Hunt account, link to X, warm up with 2 comments on other launches
- [ ] Line up **4 hunters** who will commit to launch-day engagement. Brief them on the product in a 5-min Loom.
- [ ] Draft all tweets, LinkedIn posts, Reddit posts, HN post
- [ ] QA install on clean macOS, clean Windows WSL, clean Ubuntu — fix any friction
- [ ] Decide: do we ship a `npx create-mulmoclaude` or keep `git clone` as the CTA? **Recommendation: ship the npx wrapper, it halves the install funnel.**

### T-7 — Pre-announce

- [ ] "Coming Tuesday on PH" tweet with the 15s loop (no link)
- [ ] Post in r/ClaudeAI, r/LocalLLaMA teasers — product demos, not launch CTAs (Reddit hates launch posts)
- [ ] DM 10 Claude Code power users you know — ask for a Tuesday morning try + honest feedback

### T-3 — Warm-up

- [ ] Publish a **blog post** on the Karpathy-KB connection: *"What I learned building a personal wiki for Claude."* This is the intellectual anchor.
- [ ] Submit the blog post to HN. Don't mention PH yet.
- [ ] Draft the PH listing in Maker Studio (do **not** publish — just stage)

### T-0 — Launch day

- **00:01 PT** — Publish on PH. First comment goes up within 90 seconds.
- **00:05 PT** — Tweet thread (7 tweets, one per key message). Pin the tweet.
- **00:10 PT** — LinkedIn, Mastodon, Bluesky cross-post (adapted, not copy-pasted)
- **01:00 PT** — HN "Show HN: MulmoClaude — visual GUI + personal wiki for Claude Code"
- **06:00 PT** — Reddit r/ClaudeAI post (value-first, not launch-y — "I built this, here's the wiki memory idea, here's the code")
- **09:00 PT / 12:00 PT / 15:00 PT / 18:00 PT** — Respond to **every** PH comment within 30 minutes. Non-negotiable.
- **17:00 PT** — Mid-day check: if we're not top-10, ship the Telegram bridge demo video as a fresh post and tag @ProductHunt.
- **21:00 PT** — Thank-you post regardless of placement. Name the top commenters.

### T+1 to T+7 — Compound

- Newsletter sends (dev.to, Hacker Newsletter submission, TLDR Dev pitch)
- Record a "Day after launch — what we learned" post. This outperforms the launch itself 30% of the time.
- Start the interview circuit: pitch the Changelog, Latent Space, and the Anthropic community call.

---

## 8. Channel-by-Channel Playbook

### X / Twitter

**Opening tweet (sells the click with the parallel-sessions visual):**
> *"3 Claude Code agents running in parallel. One researches, one writes docs, one builds charts. Tomorrow they remember everything. [GIF]"*

**Launch thread (6 tweets) — Order: hook → 3 messages → CTA. Memory/autonomy/ownership are the anchors; parallel sessions is the visual opener, not a message.**

1. **[Hook — parallel sessions GIF]** *"3 Claude Code agents running in parallel. One researches, one writes docs, one builds charts. Tomorrow they remember everything. This is MulmoClaude — live on Product Hunt today. 🧵"*
2. **[Message #1 — Memory]** *Every AI agent has amnesia. This one doesn't. A cross-linked wiki grows from every chat, automatically, in plain Markdown on your machine. ChatGPT Memory is a bullet list. Obsidian is inert. This is the moat. [wiki-compounding gif]*
3. **[Message #2 — Autonomy]** *Other agents wait for you. This one has a schedule. Register a source → morning briefing. Set a recurring task → weekly report done. Close the lid, come back to a catch-up. No other AI agent ships this. [scheduler gif]*
4. **[Message #3 — Ownership]** *It all lives in `~/mulmoclaude/`. Plain Markdown. `git push` is the backup. No cloud, no lock-in, no export flow. Your machine, your data, your agent. [folder + git gif]*
5. **[Anti-wrapper beat]** *This is not an API wrapper. It runs the Claude Code CLI directly — your auth, your tools, your files. That's why it can do what it does.*
6. **[CTA]** *Install with `npx create-mulmoclaude` or `git clone` — open source, MIT. One upvote on PH costs you nothing and means everything today: [link]* (If a hosted demo or `--demo` mode ships by launch, swap the first clause.)

### Hacker News

**Title:** `Show HN: MulmoClaude – Every AI agent has amnesia. I gave Claude Code a memory that compounds.`

**Opening line of the body:** *"Every AI agent has amnesia. I gave Claude Code a file system, a scheduler, and a memory that compounds. Here's what happened."* Then walk through the thesis (2026 is saturated; memory/autonomy/ownership is the frontier), the three messages, and the AI-native-OS context at the end. HN rewards ideas over features — sell the amnesia framing first. Explicitly state: *this runs the Claude Code CLI directly, not the API — that's why it can do what it does.*

### Reddit (r/ClaudeAI, r/LocalLLaMA, r/selfhosted)

- NOT a launch post. A build log: *"I spent 8 months giving Claude Code a shell. Here's the wiki-memory idea and what I learned."*
- PH link at the very bottom, one line.

### LinkedIn

**Skip on launch day.** LinkedIn is a phase-2 channel for the productivity audience. Chasing it on day one splits focus and signals "enterprise tool" to PH voters scanning categories. Queue a LinkedIn post for T+3 once the dev wave has landed.

### Japanese community (Note, X-JP)

Satoshi has a strong JP audience. Ship a Japanese version of the maker post and the hero video captions. Launch-day JP tweet at 09:00 JST = 17:00 PT the day before — catches the Asia-Pacific vote window.

---

## 9. Hunters & Community Seed List

- **Hunter target:** someone with 5k+ PH followers, ideally in the Claude/LLM space. If we can't land one, self-hunt — Satoshi's direct network is strong enough.
- **Seed voter list:** 50 people who've starred the repo or engaged with MulmoChat. DM them a calendar reminder Monday evening.
- **Commenter priming:** 4–6 people who will leave substantive (not cheerleading) comments in hours 1, 3, 6, 9. PH's algorithm weights comment velocity and diversity, not just upvotes.

---

## 10. Risks & Mitigations

| Risk                                                   | Probability | Mitigation                                                                                                                           |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Activation gap — setup too heavy for PH day**        | **High**    | **Commit to an activation path by T-10 (see §10.5):** a hosted demo *if* we build one (currently not built), or `--demo` replay mode, or a scripted walkthrough. `npx create-mulmoclaude` alone = 50% drop-off. |
| Claude Code CLI auth fails on first run                | Medium      | Pre-flight check in the app; friendly error page linking to Claude Code docs                                                          |
| "It's just a wrapper" objection                        | Medium      | Lead with the anti-wrapper line verbatim: *"It runs Claude Code directly — not the API."* Reinforce with wiki + multi-session proof.  |
| Cognitive overload (too many features in one message)  | Medium      | Already addressed in §4 — 9 messages collapsed to 5, rest kept in reserve. Hold the line; don't let screenshots creep the list back. |
| Demo video latency from live Claude calls              | Medium      | Pre-record, splice, never show >3s of spinner                                                                                        |
| MIT + Docker read as "hacker tool, not safe"           | Low-Medium  | **Reframe:** sandbox = *"the level of care a real shell needs."* MIT = *"maximally permissive open source — fork it, ship it, use it commercially."* (MIT de-risks the license objection that AGPL would have created.) |
| Anthropic ships their own GUI the same week            | Low         | Frame as complementary — local-first, open-source, plugin-extensible                                                                 |
| PH algorithm — late US vote surge from JP timing       | Low         | JP launch tweet timed to catch evening-JP as launch-day-morning-PT                                                                   |

### 10.5 The activation problem — solve this or lose the day

This is the single biggest gap in the v1 plan. Reality check: even with `npx create-mulmoclaude`, the install path is **Node + Claude Code CLI auth + Gemini API key + Docker** — 5 to 10 minutes, developer-only, zero mobile. PH winners are instant gratification. We get upvotes mid-morning, then momentum dies by afternoon because nobody actually tried it.

**Three options, ranked by impact:**

**Option A (strongly recommended, but NOT yet built) — a hosted read-only demo**
- Pre-loaded workspace with 10 prepared sessions: the "tomorrow, it remembers" memory moment, a scheduler catch-up, a wiki with backlinks, a multi-session snapshot, an ingested article → wiki page flow.
- Visitors click through existing artifacts and replay the canvas — no typing required, no auth, no API key, no Docker.
- Budget: ~3 engineer-days + hosting. Ship by T-3. **This is the single highest-leverage change in the entire plan, but we don't have a domain or instance yet.** If we commit, reserve a subdomain and provision a VM at T-10.
- If shipped, CTA in the hero video and every tweet becomes *"try it in your browser"* (with whatever URL we land on) instead of *"git clone"*.

**Option B (minimum viable) — "Watch Claude work" mode**
- A local mode that runs without a Gemini key or Claude auth, using pre-recorded session replays baked into the repo. `npx create-mulmoclaude --demo` drops the user into an interactive walkthrough in 30 seconds.
- Halves drop-off vs. a real install; doesn't match Option A but keeps the activation cost manageable.

**Option C (last resort) — Scripted screenshot walkthrough on the landing page**
- Click-through of the shock demo, parallel sessions, wiki backlinks, Telegram round-trip.
- No real interactivity but preserves the "I experienced it" feeling for PH skimmers.

**Decision:** commit to **Option A by T-7**. If scope slips, fall back to B before touching C.

---

## 11. Success Metrics

**Day of:**
- Product Hunt: **Top 5 of the day**; Top 10 is floor.
- GitHub stars: **+500** in 24h.
- **Activation-path sessions: 3,000 unique** if a hosted demo or `--demo` replay ships (§10.5); otherwise this line is N/A.
- Installs (Gemini key inputs as proxy): **500** if a demo absorbs casual traffic; **~1,500** if install is the only path (higher volume but lower quality — most drop off).
- PH comments: **50+ substantive** (not counting our team).

**Week of:**
- Stars: **+1,500 cumulative.**
- HN: front page for >2 hours.
- Twitter: 2M+ impressions on launch thread.
- 3+ inbound podcast/interview requests.

**Month of:**
- 2,000 active weekly users (sessions logged).
- 5 community-contributed custom roles or plugins.
- One mention by @karpathy, @alexalbert, or an Anthropic engineer (aspirational but trackable).

---

## 12. The Two Bets

There are two things we have to land. Miss either and the launch is a 6 out of 10.

**Bet 1 — The memory moment (earns the upvote).**
The hero video's 0:15–0:30 window: **a fresh session "tomorrow" asking a question that touches yesterday's work, and Claude answering grounded in the wiki it built itself.** That single sequence is the pitch — "every AI agent has amnesia; this one doesn't" — made visible. The parallel-sessions opener (0:00–0:08) earns the click; the memory payoff earns the upvote. Without the memory beat, the video is just "another Claude wrapper with a pretty UI." With it, we're the only ones claiming the amnesia cure.

**Bet 2 — The activation path (earns the try).**
A zero-install way for a PH skimmer to experience the memory moment and the scheduler beat. Today this means one of: (a) a hosted read-only demo if we commit to building it before T-3 (§10.5 Option A, currently NOT built), (b) `npx create-mulmoclaude --demo` with pre-recorded session replays baked in (§10.5 Option B), or (c) a scripted screenshot walkthrough on the landing page (§10.5 Option C). Without *one* of these, the upvote from Bet 1 doesn't convert into a star, a follow, or a build. **Decision owed by T-10.** Bet 1 gets you noticed; Bet 2 gets you remembered.

Everything else in this plan — bridges, sandbox, roles, wiki tour, skills launcher, multi-modal output — is confirmation bias for a viewer who already believes. Cut anything that doesn't serve one of the two bets.

---

## 13. The Story Underneath (why we're doing this at all)

The PH-day frame is *"every AI agent has amnesia; this one doesn't."* But the deeper frame — the one we hold for HN, for long-form writing, for the people who want to know where this is going — is that **every AI agent today is homeless.** They have no persistent filesystem, no schedule, no memory that compounds. They're summoned, they work, they're gone. That's not an agent. That's a function call.

MulmoClaude gives the agent a home: `~/mulmoclaude/`. A bookshelf (the wiki), filing cabinets (documents), a calendar (the scheduler), phones (the bridges). Because it has a home, it accumulates. Because it accumulates, it gets smarter. Because it gets smarter, it can be trusted with more autonomy. Memory → compounding → trust → delegation. That's the loop this plan is trying to open.

This is the first visible surface of a much bigger thesis: **computing is being re-platformed on top of AI agents, and the shell that platform needs doesn't exist yet.** Claude Code is the kernel. MulmoClaude is the first draft of the shell, and the shell's user-facing form is that single folder that every input flows into and every output comes out of. In 1975 the home directory was where your files lived. In 2026 it's where your files, your research, your conversations, your scheduled work, and the knowledge extracted from all of them live — maintained by an AI that knows what to remember, what to file, and eventually what to schedule on its own.

That last clause matters. **Both memory and scheduling should become autonomous.** Today, MulmoClaude remembers automatically but still asks the user to set up schedules by hand. The endgame is an agent that decides for itself what to repeat, what to watch, what to summarize every morning — the way it already decides what's worth writing into the wiki. Everything the user does (searches, temp notes, generated images and videos, scheduled outputs) flows into the same memory and is available from any session, any device, any time. At that point, "MulmoClaude" stops being a tool you open and becomes an ambient collaborator that's already been working.

If the launch goes well, we're not celebrating a successful product launch — we're announcing the existence of a new computing surface. Phase 2 audiences (productivity users, knowledge workers, JP market, enterprise) come later, pulled in by the dev-native gravity we establish on day one.

That framing is what makes this plan aggressive rather than cautious. We're not trying to be a "very advanced tool." We're trying to show a glimpse of the future of computing, through one sharp product.

---

*Prepared for the MulmoClaude launch. Revise after the asset dry-run at T-7. **Activation-path decision owed at T-10** — pick one of §10.5 Options A / B / C. This is the critical-path item.*
