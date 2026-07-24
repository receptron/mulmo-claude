# feat: Remote host over Firestore — phase 1: list collections

## Goal

Let a **mobile remote** (a phone browser) invoke capabilities on the user's own
MulmoClaude **Node server** over a Firestore-backed request/response channel —
**no Cloud Functions, no polling** — reusing the command-channel protocol proven
in the `mulmoserver` project (`../mulmoserver`).

The MulmoClaude server becomes a **host**: it signs in to Firebase *as the user*,
listens to that user's command queue in Firestore, runs a handler, and writes the
result back. The remote reads the result via a real-time listener.

**Phase 1 scope (this plan):** stand up the auth + host loop and ship exactly one
capability — `listCollections` — that returns the same data as
`GET /api/collections` (`{ collections: CollectionSummary[] }`). Everything else
(more handlers, a full mobile UI, concurrency limits) is later phases.

## Background / reference

The command channel — **now including per-host channels and heartbeat presence** —
is implemented and proven in `../mulmoserver`:

- Protocol: one document per call under
  **`users/{uid}/hosts/{hostId}/commands/{commandId}`** with fields `method`,
  `params`, `status` (`queued → processing → done | error`), `result`, `error`,
  `createdBy`.
- `src/firestore/commandChannel.ts` — types + `Channel = { uid, hostId }`,
  `commandsCollection(channel)`, `hostDoc(channel)`.
- `src/firestore/hostRunner.ts` — host side: `startHostRunner(channel, handlers)`
  listens `onSnapshot(where status == "queued")`, claims each doc via a
  `runTransaction` (`queued → processing`), runs the handler, writes `done`/`error`.
  **It also announces presence** — a heartbeat every 15s on
  `users/{uid}/hosts/{hostId}` (`{ online, updatedAt }`), `online:false` on stop.
  **Uses the modular `firebase/firestore` API, which runs in Node** → portable to
  this server almost verbatim. Depends on `src/firestore/commandFormat.ts`
  (`errorMessage`).
- `src/firestore/callHost.ts` — remote side: `callHost(channel, method, params)`.
- `src/composables/useHostPresence.ts` — remote side: live `connected` flag
  (heartbeat + a local staleness timer; robust to crashes since Firestore has no
  `onDisconnect`).
- Firestore rule (already deployed): `match /users/{uid}/{document=**} { allow
  read, write: if request.auth != null && request.auth.uid == uid; }` — covers
  presence docs and per-host command queues.
- **Firestore must be in Native mode** (Datastore mode silently no-ops the web SDK).

## Auth model (decided: Option B — server signs in as the user)

The server authenticates to Firestore **as the user** using the Firebase JS SDK's
`signInWithCredential`, so **no Admin SDK and no project service account** is
distributed to self-hosted MulmoClaude installs. Security rules keep the server
scoped to that user's own `users/{uid}/…` subtree.

Flow:

```text
Toolbar control (browser)               MulmoClaude server (Node)
  Google sign-in (Firebase Web SDK)
  GoogleAuthProvider.credentialFromResult(result).idToken
        │  POST /api/remote-host/connect { idToken }   (localhost, express POST)
        ▼
                                        signInWithCredential(
                                          auth,
                                          GoogleAuthProvider.credential(idToken))
                                        → auth.currentUser.uid
                                        startHostRunner(
                                          { uid, hostId: "mulmoclaude" }, handlers)
                                          + presence heartbeat on hosts/mulmoclaude
                                          onSnapshot(users/{uid}/hosts/mulmoclaude/commands
                                                     where queued)
                                          handler "listCollections" → discoverCollections()
                                          write result back
  Remote callHost({ uid, hostId:"mulmoclaude" }, "listCollections") ◄── result
```

The credential handed to the server is a short-lived **Google OAuth ID token**. It
is used **once** to establish the Firebase session; the JS SDK then holds its own
refresh token for the process lifetime. Treat the token as a secret: never log it,
POST over the existing localhost channel only.

### ⚠️ Step 0 — de-risk the auth path FIRST (standalone spike)

`signInWithCredential` in Node with a browser-minted Google ID token has known
sharp edges (token single-use / nonce set by the Firebase popup, ~1h lifetime,
Node auth persistence defaults to in-memory). Before wiring any MulmoClaude code,
write a throwaway `tsx` script that:

1. Takes a Google ID token (paste from a browser popup for the spike).
2. `signInWithCredential(...)`, prints `auth.currentUser.uid`.
3. Attaches `onSnapshot` to `users/{uid}/hosts/mulmoclaude/commands` and logs changes.

If the browser-popup token can't be reused server-side, fall back options (in
preference order): (a) run a **separate** Google OAuth id_token request in the
browser dedicated to the server; (b) pass the Web SDK **refresh token** and manage
tokens manually against `securetoken.googleapis.com`; (c) reconsider Admin SDK
(Option A) for a single-trusted-server deployment. **Do not proceed past Step 0
until the host loop authenticates and receives a live snapshot.**

## Firebase project

Reuse the **`mulmoserver` Firebase project** so the mobile remote and this host
share one project (default; confirm). The web config (apiKey, authDomain,
projectId, …) is public and can live in a MulmoClaude config module + `.env`.

## Channels & presence (decided)

- **Channel = a hardcoded `hostId`, no discovery.** MulmoClaude's server host uses
  **`hostId = "mulmoclaude"`**; the mulmoserver test pages use `"test"`. The remote
  and host just agree on the id — no registry, no host list.
- **Isolation by subcollection.** Each host owns
  `users/{uid}/hosts/{hostId}/commands`, so a user running several hosts (their
  laptop + this MulmoClaude, both signed in as the same account) never compete for
  each other's commands.
- **Presence is automatic.** `startHostRunner(channel, …)` heartbeats
  `users/{uid}/hosts/{hostId}` while running and writes `online:false` on stop —
  nothing extra to wire on the server. The mobile remote uses `useHostPresence` to
  show whether the `"mulmoclaude"` host is up and to fail fast when it isn't.
- The top-level **toolbar** Connect/Disconnect control is what starts/stops the
  host loop, which in turn drives presence.

## Target structure (new files)

```text
server/remoteHost/
  firebase.ts        # initializeApp + getAuth + getFirestore (default DB, Native mode)
  auth.ts            # connect(idToken) → signInWithCredential → uid; disconnect(); status()
  hostRunner.ts      # ported from ../mulmoserver/src/firestore/hostRunner.ts (channel + presence)
  commandChannel.ts  # ported types + Channel + commandsCollection(channel) + hostDoc(channel) + HOST_ID
  handlers/
    index.ts         # CommandHandlers table: { listCollections }
    listCollections.ts  # calls discoverCollections()/toSummary() → { collections }
  index.ts           # startHostRunner wiring + lifecycle (start on connect, stop on disconnect)
  # (commandFormat.ts NOT ported — reuse server/utils/errors.ts errorMessage)

server/api/routes/remoteHost.ts   # POST /connect {idToken}, POST /disconnect, GET /status
  # register in server/index.ts; add path to src/config/apiRoutes.ts

src/config/firebaseConfig.ts      # pure public web-config (source of truth, no SDK init)
src/config/firebase.ts            # browser web SDK init (firebaseApp, auth)
src/components/RemoteHostControl.vue  # TOP-LEVEL TOOLBAR control: Google login + Connect/Disconnect + status
  # mount in the App.vue top toolbar/chrome row (NOT in SettingsModal) — see docs/ui-controls.md + docs/ui-cheatsheet.md
```

Dependency: add `firebase` (web SDK) to `package.json` — used both in the browser
(`signInWithPopup`, extract `idToken`) and in the Node server
(`signInWithCredential`, `onSnapshot`).

## Reuse vs. copy

`commandChannel.ts` and `hostRunner.ts` are modular-`firebase/firestore` and run
unchanged in Node. The server is **host-only**, so it needs those two but **not**
the remote-side `callHost.ts` / `useHostPresence.ts`. `commandFormat.ts` is
**not** copied — its only host-side dependency was `errorMessage`, which already
exists as the canonical `server/utils/errors.ts` helper (reused instead).
Options: (1) copy the two into `server/remoteHost/` now (fastest); (2) later
extract the protocol into a shared package (e.g. `@mulmoclaude/…` or publish from
`mulmoserver`). **Phase 1: copy.** Note the reuse for a future refactor; don't
block phase 1 on packaging.

## The `listCollections` handler

Runs in-process on the server, so it bypasses the HTTP view-token layer and calls
the engine directly:

```ts
// server/remoteHost/handlers/listCollections.ts
import { discoverCollections, toSummary } from "../../workspace/collections/index.js";
export const listCollections = async () => {
  const collections = (await discoverCollections()).map(toSummary);
  return { collections };            // mirrors GET /api/collections
};
```

Confirm the exact `discoverCollections()` signature/return in
`server/workspace/collections/index.ts` when implementing (it backs the existing
route, so the shape is known-good).

## Steps

**Reordered (per request): ship a testable login-UI + live-heartbeat slice
first (phase 1a), then the `listCollections` capability (phase 1b).** The
handler is orthogonal to auth/presence, so it can follow once the connect →
heartbeat loop is demonstrable from the browser.

### Done

0. ✅ **Auth spike** (see Step 0 above) — gate passed: `signInWithCredential` in
   Node + live `onSnapshot` + queued-command round-trip + token reuse all proven.
1. ✅ Added `firebase@12.15.0`; `src/config/firebaseConfig.ts` (pure public
   config, source of truth) + `src/config/firebase.ts` (browser init) +
   `server/remoteHost/firebase.ts` (Node init: `firebaseApp`, `auth`, `firestore`).
2. ✅ Ported `commandChannel.ts` + `hostRunner.ts` into `server/remoteHost/`
   (`db`→`firestore`, reuse `server/utils/errors.ts` `errorMessage` instead of
   copying `commandFormat.ts`, heartbeat from `ONE_SECOND_MS`, exported
   `HOST_ID = "mulmoclaude"`). Heartbeat code exists but is **not yet wired**.

### Phase 1a — login UI + live heartbeat (testable slice)

3. `server/remoteHost/auth.ts`: `connect(idToken)` → `signInWithCredential` → uid;
   `disconnect()` (signOut + host stop); `status()` (holds current uid + the
   host stop() handle).
4. `server/remoteHost/index.ts`: on connect, `startHostRunner({ uid, hostId:
   HOST_ID }, handlers)` — **this activates the presence heartbeat**; on
   disconnect, call the returned stop() (writes `online:false` + detaches).
   Pass a **minimal/empty handlers table for now** (the real `listCollections`
   lands in phase 1b); an empty table still heartbeats and is enough to test.
5. `server/api/routes/remoteHost.ts` (`POST /connect {idToken}`, `POST
   /disconnect`, `GET /status`); register in `server/index.ts` + add the path to
   `src/config/apiRoutes.ts`.
6. `src/components/RemoteHostControl.vue` mounted in the **top-level toolbar**
   (App.vue chrome row) — NOT in SettingsModal: Google sign-in, extract
   `idToken`, POST to `/connect`, show connected uid + Connect/Disconnect +
   status. Use a Material Icons control (no emoji) sized per `docs/ui-controls.md`;
   respect the region naming / testid discipline in `docs/ui-cheatsheet.md` and
   update the ASCII layout map there if the chrome row changes.
7. **Test the slice**: connect from the toolbar → verify the presence doc
   `users/{uid}/hosts/mulmoclaude` flips `online:true` and its `updatedAt`
   refreshes every ~15s (watch via the Step 0 spike listener or the Firebase
   console); disconnect → `online:false`. This exercises auth + route + UI +
   heartbeat without any handler.

### Phase 1b — the `listCollections` capability

8. `server/remoteHost/handlers/listCollections.ts` (import `discoverCollections`,
   `toSummary` from `@mulmoclaude/core/collection/server`) + `handlers/index.ts`;
   swap the minimal table from step 4 for this real table.
9. Manual end-to-end: with the host connected, from a phone (or the mulmoserver
   client) signed in as the same account, `callHost({ uid, hostId: "mulmoclaude"
   }, "listCollections")` → returns this server's collections; the remote's
   presence indicator shows the host online.

## Security considerations

- Token is a secret: POST over localhost only, never log, don't persist to disk in phase 1.
- Option B keeps blast radius to the user's own Firestore subtree (rules enforce `uid`); the server holds no project-wide privilege.
- Add a visible **Connect/Disconnect** control so the user chooses when the server listens; disconnect must call the host stop() (which writes `online:false` + detaches) and `signOut`.
- The `users/{uid}/{document=**}` rule is already deployed in the shared project; verify it is in **Native mode**.

## Decisions locked

- **Handoff transport: express POST** (a `/api/remote-host/connect` route). One-shot
  request/response fits "connect"; matches how MulmoClaude already exposes routes;
  simpler to secure than a socket event. (Socket push only if we later want the
  server to notify the toolbar control of state changes.)
- **Channels: hardcoded `hostId`, no discovery** — `"mulmoclaude"` for this host.
- **Presence: heartbeat** (built into `startHostRunner`).
- **Copy the protocol files now**; extract a shared package later.

## Open questions (confirm before/at Step 1)

- Reuse the mulmoserver Firebase project, or create a dedicated one? (default: reuse)
- Node session persistence: accept re-login on server restart (in-memory) for phase 1? (default: yes)

## Out of scope (later phases)

- Additional handlers (read/create collection items, run mulmo scripts, etc.).
- Rich mobile remote UI (phase 1 can be exercised from the mulmoserver client).
- Host-side concurrency limits / backpressure, multi-account, multiple hostIds per install.
- Packaging the protocol into a shared module.

## Test plan (MulmoClaude test mechanism: `tsx --test`)

- Pure-logic: handler registry shape (`handlers.listCollections` exists), and a
  `listCollections` unit test with `discoverCollections` stubbed → asserts
  `{ collections }` mapping.
- Contract/source-text: `remoteHost/hostRunner.ts` claims via `runTransaction`,
  listens on `status == "queued"`, and heartbeats presence; commands live under
  `users/{uid}/hosts/{hostId}/commands`; the remoteHost route exposes
  connect/disconnect/status.
- Auth path is validated by the Step 0 spike (not a CI unit test in phase 1).
