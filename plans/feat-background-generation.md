# Background Generation for MulmoScript

## Problem

The MulmoScript view (`src/plugins/presentMulmoScript/View.vue`) runs four
long-running "generate" flows:

| Flow                | Function                          | Route                       |
| ------------------- | --------------------------------- | --------------------------- |
| Beat image          | `renderBeat` / `regenerateBeat`   | `mulmoScript.renderBeat`    |
| Character image     | `renderCharacter`                 | `mulmoScript.renderCharacter` |
| Beat audio          | `generateAudio`                   | `mulmoScript.generateBeatAudio` |
| Whole movie         | `generateMovie`                   | `mulmoScript.generateMovie` (SSE) |

All four store their "in progress" state in component-local `reactive` refs
(`renderState`, `charRenderState`, `audioState`, `movieGenerating`). When the
user navigates away from the view (switches session, opens a different tool
result, etc.), the component unmounts and that state is lost. Spinners
disappear, the movie SSE stream is torn down, and the user has no cross-view
indication that anything is still happening.

The generation itself continues — the fetch has no `AbortController`, the
server finishes the job, and files land on disk — so the *result* is not
lost. Only the *visibility* is.

## Goal

Let the user start a generation, leave the view, and

- see a "busy" indicator in the same place chat completion shows one
  (`ChatInput`), so they know work is still in flight,
- return to the MulmoScript view and see completed results without a manual
  refresh.

Explicitly *in* scope:

- **Switching sessions mid-generation must stay unblocked.** User starts a
  render in session A, switches to session B, chats freely in B. B's
  `ChatInput` is not disabled by A's work.
- **Cross-session visibility.** While on B, the sidebar entry for A shows a
  "busy" indicator so the user knows A still has work running.

Non-goals:

- Surviving a full app close / reload. If the app closes mid-generation, the
  "in progress" signal is lost; completed files simply reappear via the
  existing `loadExistingBeatImage` / `loadExistingBeatAudio` path on next
  mount.
- Cancel / abort. Out of scope; follow-up if needed.

## Design

The filesystem is the ledger. Pub/sub is just a nudge — "look again."

### Wire format

Two new event types, flowing through the existing per-session channel
(`session.${chatSessionId}`, `src/config/pubsubChannels.ts:21`):

```ts
// packages/protocol/src/events.ts — extend EVENT_TYPES
generationStarted:  "generation_started",
generationFinished: "generation_finished",

// payload shape
interface GenerationEvent {
  type: "generation_started" | "generation_finished";
  kind: "beatImage" | "characterImage" | "beatAudio" | "movie";
  filePath: string;   // MulmoScript file path — scopes the generation
  key: string;        // beatIndex for beat*, character key for characterImage, "" for movie
  error?: string;     // only on generation_finished if it failed
}
```

The `{kind, filePath, key}` triple is the generation's identity. The client
uses it both as a map key (for per-beat spinners) and to decide which
`loadExisting*` to call on completion.

### Server changes

1. **Extend `EVENT_TYPES`** (`packages/protocol/src/events.ts`) with the two
   new strings.

2. **Plumb `chatSessionId` through generate routes.** The four routes in
   `server/api/routes/mulmo-script.ts` currently take `{ filePath, … }`.
   Extend the request body with an optional `chatSessionId`. When present,
   publish generation events on `sessionChannel(chatSessionId)`.

   > *Optional* because the same routes can be called from contexts
   > without a session (scripts, tests); absent ID = no events published,
   > existing behavior preserved.

3. **Add a publish helper** in `server/api/routes/mulmo-script.ts` (or a
   small `server/events/generation.ts` if it gets reused):

   ```ts
   function publishGeneration(
     chatSessionId: string | undefined,
     kind: GenerationKind,
     filePath: string,
     key: string,
     finished: false,
   ): void;
   function publishGeneration(
     chatSessionId: string | undefined,
     kind: GenerationKind,
     filePath: string,
     key: string,
     finished: true,
     error?: string,
   ): void;
   ```

   Reaches `publishToSessionChannel` via `pushSessionEvent`
   (`server/events/session-store/index.ts:166`) so the existing plumbing
   handles delivery.

4. **Wrap each handler.** In `mulmo-script.ts`, wrap the four handlers
   (`renderBeat` at L436?/L495? — verify, `renderCharacter`, `generateBeatAudio`,
   `generateMovie`) so that:

   ```ts
   publishGeneration(chatSessionId, kind, filePath, key, /*finished*/ false);
   try {
     // existing work
     publishGeneration(chatSessionId, kind, filePath, key, true);
   } catch (err) {
     publishGeneration(chatSessionId, kind, filePath, key, true, errorMessage(err));
     throw;
   }
   ```

   `generateMovie` already streams SSE — publish `generation_finished` at
   the same point it emits its final `done` SSE frame, and
   `generation_started` at the top of the handler.

5. **Mutate session state in `pushSessionEvent`**
   (`server/events/session-store/index.ts:166`) so the session summary
   returned by the sessions REST endpoint carries the in-flight set.

   ```ts
   interface Session {
     // existing fields…
     pendingGenerations: Record<string, GenerationKind>; // key = `${kind}:${filePath}:${key}`
   }
   ```

   On `generation_started`: set the entry. On `generation_finished`: delete.
   Call `notifySessionsChanged()` on both (debounced — see Risk section)
   so the sidebar refetches `/api/sessions` and shows the indicator on
   session A while the user is on B.

6. **Merge pending generations into the summary's `isRunning`.** The
   sessions REST handler (and whatever serializes a `Session` to a
   `SessionSummary`) should compute:

   ```ts
   isRunning: session.isRunning || Object.keys(session.pendingGenerations).length > 0
   ```

   This is what makes cross-session visibility "fall out for free": the
   sidebar already reads `summary.isRunning` per session, so session A's
   entry lights up even while the user is on B. No sidebar changes
   needed.

### Client changes

1. **Extend the client session type** (`src/types/session.ts` or wherever
   the active-session interface lives) with `pendingGenerations:
   Record<string, GenerationKind>`. Initialize to `{}`.

2. **Handle the two new events in `applyAgentEvent`**
   (`src/App.vue` ~L1184). Switch on `event.type`, mutate
   `activeSession.pendingGenerations`:

   ```ts
   case EVENT_TYPES.generationStarted:
     session.pendingGenerations[keyOf(event)] = event.kind;
     break;
   case EVENT_TYPES.generationFinished:
     delete session.pendingGenerations[keyOf(event)];
     // forward to any listening MulmoScript view — see step 4
     break;
   ```

3. **`isRunning` computed stays almost as-is** (`src/App.vue:513`) —
   `currentSummary.value?.isRunning` already reflects pending
   generations once the server merges them into the summary (step 6 on
   the server side). The only change needed is the in-memory fallback
   for the brief window before the first `/api/sessions` fetch lands:

   ```ts
   const isRunning = computed(() => {
     const summary = currentSummary.value;
     if (summary) return summary.isRunning;
     const a = activeSession.value;
     if (!a) return false;
     return a.isRunning ||
       Object.keys(a.pendingGenerations ?? {}).length > 0;
   });
   ```

   Key semantic: this reads the **active** session's state. Switching to
   a non-busy session B ⇒ `isRunning` is false ⇒ `ChatInput` in B is
   unblocked. Session A's busy-ness is visible only via its sidebar
   entry (driven by `summaries[a].isRunning`, step 6 server-side).

4. **Bridge events into the MulmoScript view.** The view needs to know
   when *its* generations finish so it can call `loadExistingBeatImage` /
   `loadExistingBeatAudio` / movie-status refresh. Two options:

   - **Option A (preferred, simpler):** View reads
     `activeSession.pendingGenerations` via a prop or a shared composable
     and `watch`es it. When an entry for *its* `filePath` disappears, it
     calls the matching `loadExisting*`.
   - **Option B:** App.vue emits a dedicated "generationFinished" signal
     on a small event bus the view subscribes to. More ceremony; same
     outcome.

   Go with A.

5. **Drop (or thin out) the local state in `View.vue`.** The view still
   needs its own state for per-beat error messages and for the
   drop-to-upload path (which isn't a server-initiated generation), but
   the "is rendering" booleans should derive from `pendingGenerations`:

   ```ts
   const renderState = computed<Record<number, RenderState>>(() => {
     const out: Record<number, RenderState> = {};
     const pending = session.pendingGenerations ?? {};
     for (const k of Object.keys(pending)) {
       const [kind, fp, key] = k.split(":");
       if (kind === "beatImage" && fp === filePath.value) {
         out[Number(key)] = "rendering";
       }
     }
     // merge in any local error/done states
     return out;
   });
   ```

   Same pattern for `charRenderState`, `audioState`, `movieGenerating`.
   Local `renderErrors` / `charErrors` / `audioErrors` stay component-local
   — errors for completed generations are one-shot and don't need to
   survive unmount.

6. **Pass `chatSessionId` in request bodies.** View.vue's `renderBeat`,
   `renderCharacter`, `generateAudio`, `generateMovie` POST bodies get
   `chatSessionId: activeSessionId.value` (new prop or injection).

### UI

Nothing new to build. Three existing consumers of `SessionSummary.isRunning`
pick up the new behavior automatically once the server merges
`pendingGenerations` into the summary:

- `ChatInput` (`src/components/ChatInput.vue:30,48,113`) — disables the
  input when the *active* session is busy. Switching to a non-busy session
  unblocks it.
- `SessionTabBar` (`src/components/SessionTabBar.vue:31,90`) — spins the
  role icon and tints it yellow on any session with `isRunning === true`.
  This is the cross-session indicator: session A's tab keeps spinning
  while the user is on session B.
- `SessionHistoryPanel` (`src/components/SessionHistoryPanel.vue:177`) —
  same signal, used in the dropdown list + the `activeSessionCount`
  yellow badge at `SessionTabBar.vue:50`.

The MulmoScript view still shows per-beat / per-character spinners when
open; they're now derived from the same `pendingGenerations` map instead
of component locals, so they survive remount.

## Edge cases

- **Duplicate start events.** If a user hammers "Regenerate," the server
  publishes `generation_started` twice for the same key. Map-set is
  idempotent — fine.
- **Finish event for a generation we never saw start.** Mount-after-start
  race: view mounts after the start event already fired, or a non-session
  caller triggered the work. The delete is a no-op; the view still picks
  up the result via `loadExisting*`. Fine.
- **App closes mid-generation.** `pendingGenerations` is rebuilt from
  scratch on next session load (empty). File appears on disk; next visit
  to the view shows it. Signal lost, result preserved. Matches the
  "simple" constraint.
- **Movie SSE stream aborted on unmount.** Today `streamMovieEvents`
  drives beat reloads as frames arrive. After this change, the SSE stream
  still runs while the view is open (nice-to-have: faster updates) but
  the pub/sub events are the load-bearing path. If the user leaves
  mid-movie, the SSE closes, the server keeps working, and
  `generation_finished` fires when the movie completes.

## Risk / complexity

- Cognitive complexity on `pushSessionEvent` and `applyAgentEvent` grows;
  may need to extract per-event-type helpers to stay under the
  `sonarjs/cognitive-complexity` threshold (15).
- Need to verify `notifySessionsChanged()` on every generation event
  isn't too chatty for the sidebar. If it is, gate it behind a debounce
  or only fire on the set transitioning empty↔non-empty.

## Implementation order

1. Add `EVENT_TYPES.generationStarted` / `generationFinished` +
   `GenerationEvent` type to `packages/protocol`.
2. Server: `publishGeneration` helper + wrap the four handlers. Manual
   smoke-test: watch websocket frames in devtools while rendering a beat.
3. Server: extend session store with `pendingGenerations`, wire
   `pushSessionEvent`, expose on the session summary.
4. Client: extend session type, handle the two events in
   `applyAgentEvent`, extend `isRunning`.
5. Client: pass `chatSessionId` in View.vue generate requests.
6. Client: derive View.vue render/audio/movie state from
   `pendingGenerations`; drop the matching local refs.
7. Unit tests for the `pushSessionEvent` branch + client reducer branch.
8. Manual pass: start a beat render, switch session, confirm ChatInput is
   busy; switch back, confirm thumbnail appears.

## Out of scope / follow-ups

- Abort / cancel a running generation.
- Cross-session visibility (e.g., notification badge on session A's
  sidebar entry while the user is on session B).
- Persisting `pendingGenerations` across app reloads (would require a
  server-side job registry keyed by `{filePath, kind, key}`).
