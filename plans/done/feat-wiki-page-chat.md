# feat: Chat about the current Wiki page

## Problem

To ask Claude about a wiki page today, the user has to switch to `/chat`, remember or paste the slug, and phrase an instruction like "read data/wiki/pages/foo.md, then …". There's no affordance on the Wiki page itself. The page is already on screen — the prompt surface should be too.

## Goal

On a wiki leaf page (`action === "page"` in `src/plugins/wiki/View.vue`), show a small chat input below the rendered markdown. When the user sends a message:

1. Open a **new** chat session, using the currently selected role.
2. Send a message that instructs the agent to read the current wiki page *before* responding to the user's text.
3. Navigate the UI to that new session.

The user should end up on `/chat/:newSessionId` with one pending turn in flight and the prior wiki view left behind in history.

## Non-goals

- Continuing an existing chat session (a "reply here" flow). Spec is explicit: **always** a new session.
- Chat input on the Index / Log / Lint views — leaf pages only.
- Attachments / pasted images in the wiki chat input. Plain text only for v1.
- Persisting draft text across navigations.
- A "chat about this paragraph" (selection-scoped) variant.

## Design

### UI

A thin composer docked at the bottom of the leaf-page content area in `View.vue`, below the rendered markdown div at `View.vue:86`:

- Single-line-ish `<textarea>` (2 rows, `resize-none`) with placeholder like *"Ask about this page…"*.
- Send button (paper-plane icon) on the right, disabled when text is empty.
- Enter submits, Shift+Enter inserts a newline. IME-safe (reuse the `imeEnter` pattern from `src/components/ChatInput.vue` if it's trivial to import; otherwise inline a minimal `isComposing` check — full parity with ChatInput is **not** a goal).
- Only rendered when `action === "page" && content`. Hidden on index / log / lint / empty.
- `data-testid="wiki-page-chat-input"` + `data-testid="wiki-page-chat-send"` for E2E.

**Not reusing `ChatInput.vue` verbatim.** ChatInput carries `pastedFile`, `isRunning`, expand-editor, and attach buttons that are out-of-scope here. A ~30-line inline composer keeps this self-contained.

### Message format

The text sent to the agent prepends a read instruction to the user's message:

```text
Before answering, read the wiki page at data/wiki/pages/<slug>.md.

<user's message verbatim>
```

Rationale:

- The system prompt (`server/agent/prompt.ts:160`) already tells the agent the wiki lives at `data/wiki/pages/<slug>.md`, so a plain `Read` tool call resolves it. No need to invoke `manageWiki` with an action.
- `<slug>` comes from `props.selectedResult?.data?.pageName` when the wiki is mounted as a tool result, and from `route.query.page` when mounted as `/wiki?page=<slug>`. The watcher at `View.vue:173-187` already normalises these; read from `route.query.page` (string) on `/wiki`, fall back to `props.selectedResult?.data?.pageName` for the tool-result context.
- We send the slug, not the title, because title → slug resolution is fuzzy on the server side and the slug is what the file system actually uses.

### Session creation + send

`createNewSession(roleId?)` already exists at `App.vue:545` and does exactly what we need: removes an empty current session, seeds a new one with the given role, sets `currentRoleId.value`, and navigates to `/chat/:newId` via `navigateToSession`. After it returns, `currentSessionId.value` is synchronously the new id (see the comment at `App.vue:240-244`), so a follow-up `sendMessage(text)` lands in the right session.

Order inside App.vue:

```ts
function startNewChat(message: string): void {
  createNewSession(currentRoleId.value);
  sendMessage(message);
}
```

- `sendMessage` is `async`, but we don't need to await it — it kicks off the agent run and returns. The View has already navigated away (or is about to, via `router.push` inside `navigateToSession`).
- Passing `currentRoleId.value` explicitly is belt-and-suspenders; `createNewSession(undefined)` would use the same value today.

### AppApi surface

Add one method to `src/composables/useAppApi.ts`:

```ts
/** Open a new chat session with the given message as the first turn. */
startNewChat: (message: string) => void;
```

Provided in `App.vue:769-773` as `startNewChat: (message) => startNewChat(message)`. `View.vue` injects via `useAppApi()` (same pattern as `manageRoles/View.vue:275,312`) rather than wiring a new prop, because:

- `sendTextMessage` prop at `View.vue:114` is plumbed only when WikiView is mounted as a tool result (see `StackView.vue:51,62,115`). The standalone `/wiki` route mounts WikiView without that prop, so relying on it would silently break the more common case.
- `AppApi` is the established cross-component channel (see `useAppApi.ts:1-13`).

### Interaction with existing wiki behaviour

- The URL-driven navigation watcher at `View.vue:173-187` is untouched — this feature only adds a new composer surface.
- `useFreshPluginData` refresh on `/wiki?page=<slug>` is untouched — after `startNewChat` runs, the user has navigated to `/chat/:newId` and WikiView unmounts, so any in-flight refresh is naturally cancelled.
- The "back" arrow at `View.vue:6-8` is unaffected. If the user browser-backs out of the new chat, they land back on the wiki page.

## Implementation steps

1. **Extend `AppApi`.** Add `startNewChat(message: string): void` to the interface in `src/composables/useAppApi.ts`.
2. **Implement in `App.vue`.** Add the two-liner `startNewChat` function and include it in the `provideAppApi(...)` object at `App.vue:769-773`.
3. **Add the composer to `View.vue`.**
   - Template: new `<form>` / `<div>` block after the markdown content div (View.vue:86), rendered behind `v-if="action === 'page' && content"`.
   - Script: `const chatInput = ref("")`, `const appApi = useAppApi()`, and `function submitChat()` that reads the slug (priority: `route.query.page` on `/wiki`, else `props.selectedResult?.data?.pageName`), bails if no slug or empty input, then calls `appApi.startNewChat(formatted)`.
   - Style: match the existing Tailwind vibe in the file (gray borders, blue send button). Scope to `<style scoped>`.
4. **i18n strings.** Add `pluginWiki.chatPlaceholder` and `pluginWiki.chatSend` to the locale files used by `t(...)` in `View.vue`.
5. **No server changes.** The prepended "read the page first" instruction is handled by Claude using the existing `Read` tool — no new plugin, route, or tool definition.

## Test plan

### E2E (Playwright — extend `e2e/tests/wiki-plugin.spec.ts`)

- Navigate to `/wiki?page=<known-slug>`, type a question, click send → assert URL moves to `/chat/<uuid>`, the last user entry in the transcript contains the user's question verbatim, and the agent has received a message prefixed with `Before answering, read the wiki page at data/wiki/pages/<slug>.md` (use the existing API mock to inspect the agent-run payload).
- Enter and Shift+Enter behaviour mirrors ChatInput (Enter submits, Shift+Enter newline).
- Composer hidden on `/wiki` (index view), `/wiki?view=log`, `/wiki?view=lint_report`.
- From a `manageWiki` tool result on `/chat/:sessionId`, opening a leaf page and sending a message lands on a **different** `/chat/:newId` — not the original session.
- Send button disabled on empty / whitespace-only input.

### Unit

No new server unit tests. The only logic worth isolating is the message formatter; keep it as a local `function buildPrompt(slug, text)` inside `View.vue` — no separate utility file unless a second caller appears.

### Manual

- Role switch: change role via the selector, visit a wiki page, chat → new session carries the new role (confirm via `?role=` query on the resulting chat URL or the role badge in the header).
- Japanese input: IME composition doesn't send on Enter mid-composition.
- With no current chat session yet (fresh install, empty `conversations/chat/`), sending from a wiki page still works — `createNewSession` handles the cold-start case.

## Out of scope / future work

- Attachments (images, files) in the wiki chat input.
- Suggestions / prompt chips tailored to the current page (e.g. "summarise", "what's missing?").
- A "continue in current chat" mode for users who explicitly want to thread a wiki question into an existing session.
- Passing the rendered-but-not-saved state of the wiki page (e.g. unsaved edits in a future editor view) — not relevant until such an editor exists.
