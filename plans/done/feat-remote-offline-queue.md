# feat: Queue remote startChat requests while the host is offline

## Problem

The remote-host command channel treats the host as an **always-on RPC target**.
The remote gates its UI on the presence doc's `online` flag and, when the host is
offline, refuses to compose or send — even though the operation the user most
wants from a phone (`startChat`: "send this thought / photo to my Mac") has no
reason to require the host be awake *right now*. A laptop that's asleep, closed,
or mid-restart makes the phone a dead end until it wakes.

Yet the transport is **already a durable queue**: commands are Firestore docs
that persist regardless of host presence, and the host's listener
(`hostRunner.ts`, `where("status","==","queued")`) reports every pre-existing
`queued` doc as an `added` change the instant it (re)attaches. So a command
written while the host is offline is **already drained on reconnect today** — the
mechanism exists; nothing consumes it only because the *client* won't emit it
offline.

The gap is therefore mostly client-side (let the phone compose + emit offline)
plus a small amount of host-side **hygiene** so a reconnect after a long sleep
doesn't replay stale or expired work, or lose attachments to a Storage sweep.

## Decision (locked)

- **Reuse the existing `commands` channel — no new queue collection.** The
  claim/process/writeback/exactly-once machinery (`claimCommand` runTransaction,
  `runHandler`, `unknown_method`, write-after-delete swallowing) is byte-for-byte
  identical for a command drained late. "Offline-ness" is a property of *when the
  doc is drained*, not a different transport. Differences are expressed as
  **fields on the command** + host-side policy, never a parallel collection.
- **Same channel, differentiated treatment.** A `queuedOffline` command is not a
  fire-and-forget RPC that happens to be slow — it's a **user-visible pending
  item** on both ends:
  - **Remote:** renders the list of its own `queued` commands and lets the user
    **delete** one before the host drains it (delete the command doc *and* its
    staged Storage uploads). Delete is offered for `status == "queued"` only —
    once `processing`/`done` the chat has spawned on the host and removing the
    doc won't un-spawn it.
  - **Host:** an **expired** command is not just error-marked — the host
    **deletes** it *and* its staged attachments (see edge #3). So a queue that
    the host never got to reap leaves nothing behind but what the Storage TTL
    backstop would anyway.
- **Drain-on-reconnect is the delivery mechanism — keep it.** No explicit
  "flush" call. The initial `onSnapshot` snapshot already reports all `queued`
  docs as `added` (see `hostRunner.ts:101-104`). We only add ordering + a
  staleness gate around that existing loop.
- **The phone caches its pick-lists in local storage.** To compose `startChat`
  offline the UI needs roles / skills / collections, which normally come from
  `listCollections` / `listSkills` (host-online only). The remote persists the
  last-known lists to `localStorage` and composes against them offline. Cache
  staleness is tolerated because the host validates on drain (see edge #2).
- **Attachments stage to Storage offline, unchanged.** The phone holds its own
  Storage credentials, so `users/{uid}/uploads/{storage_id}` uploads work with
  the host asleep. `ingestAttachments` is untouched.

## Contract additions (both repos depend on exactly this)

New optional fields on the command doc (`@mulmoclaude/core/remote-host`
`Command`), all backward-compatible — absent ⇒ today's behavior:

```jsonc
// users/{uid}/hosts/mulmoclaude/commands/{id}
{
  "method": "startChat",
  "params": { … },
  "status": "queued",
  "createdBy": "remote",
  "createdAt":  1751760000000,        // NEW — enqueue time (epoch ms); age + best-effort dispatch bias
  "expiresAt":  1752364800000,        // NEW — deadline (epoch ms); host DELETES past this (doc + attachments)
  "queuedOffline": true               // NEW — set when emitted with host offline;
                                      //   the ONLY signal that exempts the doc
                                      //   from the remote's ack-timeout rollback
}
```

- `createdAt` — enqueue time (epoch ms). Used for a **best-effort** oldest-first
  dispatch bias on drain + age display. **Not** a strict ordering guarantee:
  commands are processed concurrently and out-of-order completion is by design
  (chat is asynchronous), so `createdAt` only nudges which starts first.
- `expiresAt` — remote-chosen wall-clock deadline. The host **deletes** a command
  past it (doc + staged attachments) rather than acting on it, so a weekend of
  queued chats doesn't all spawn on Monday and no bytes are stranded (edge #3).
  Must be `< now + StorageTTL` (edge #1).
- `queuedOffline` — distinguishes "sent while offline, will be acked whenever the
  host wakes" from "sent while online, expecting a prompt ack." The remote's
  attachment-rollback safeguard keys on this (edge #1).

Plus a **presence-doc gate**: `REMOTE_HOST_PROTOCOL_VERSION` bumps **1 → 2**. v2
means "this host honours `expiresAt` (deletes an expired command + its uploads)".
A remote MUST see `protocolVersion >= 2` before queueing offline — a v1 host
ignores `expiresAt` and would spawn a stale chat on reconnect with its uploads
never cleaned. This is exactly what `protocolVersion` exists for (a wire-shape
change the remote must react to), so no new capability string is needed.

## The three load-bearing decisions (edges)

### Edge #1 — Attachment staging TTL is the tightest coupling

`ingestAttachments` pulls each staged object and, on the **first** `getBytes`
failure, rejects the whole `startChat` (`ingestAttachments.ts:60`,
`startChat.ts:136`). Staged uploads are reaped by a Storage lifecycle TTL sweep.
If a command can sit `queued` for days but the TTL reaps its upload in hours, the
host reconnects to a command whose bytes are gone → hard, unrecoverable failure.

- **Invariant: max queue age (`expiresAt` horizon) < Storage lifecycle TTL.**
  They must be chosen together and documented as a pair; whoever sets one owns
  the other. **Chosen values: 7-day `expiresAt` under a 14-day Storage TTL** —
  the 2× gap guarantees a still-valid queued command never finds its staged
  attachment already swept. (Storage TTL = a Firebase Storage lifecycle rule that
  auto-deletes objects under `users/{uid}/uploads/` older than 14 days — the
  server-side backstop reaper for the one case nothing else covers: a host that
  never reconnects.)
- **The remote's ack-timeout rollback must exempt `queuedOffline` commands.**
  Today the remote best-effort deletes its own staged objects if `startChat`
  never gets a host ack — correct for online sends, **fatal** for offline queueing
  (no ack is coming for a while; deleting the upload strands the queued command).
  Rollback keys on `queuedOffline !== true`. (mulmoserver-side change.)
- **Attachment cleanup ownership is now explicit, not just the TTL.** With delete
  on expiry (edge #3) and delete-from-the-list (the remote), every staged upload
  has a definite reaper: the host on ingest-success (`ingestAttachments` already
  deletes), the host on expiry, or the remote on user-delete. The Storage
  lifecycle TTL drops from *primary* orphan safeguard to *last-resort backstop*
  for the one case nobody covers — the host never reconnects at all.

### Edge #2 — Stale pick-lists fail closed, cleanly

A cached role / `/slug` may no longer exist when the host drains the command.
`startChat` already fails **closed and cleanly**: `resolveRoleId` rejects an
unknown role (`startChat.ts:118`), legacy `composeCollectionSeed` rejects an
unknown slug (`startChat.ts:98`). So a stale pick surfaces as a normal `error` on
the command doc, not a wrong-assistant chat. **Decision: keep reject-on-unknown**
(don't silently fall back to the default role) — a chat seeded to the wrong role
is worse than a visible "that role no longer exists" the phone shows on reopen.

### Edge #3 — Expired commands are deleted (doc + attachments), not error-marked

The drain loop is `docChanges().forEach(... processCommand ...)` — commands are
dispatched concurrently, so N weekend chats `spawnSystemWorker` near-simultaneously
on wake.

- **Best-effort drain order, NOT a guarantee.** The runner sorts each drained
  batch by `createdAt` **in memory** (oldest-first) to bias which command starts
  first — deliberately *not* `orderBy("createdAt")` on the query, which would
  silently exclude pre-offline-queue docs missing the field. But processing is
  concurrent and **out-of-order completion is by design** (chat is asynchronous),
  so this only nudges dispatch order; it is not a strict replay guarantee.
- **Expiry ⇒ delete, not error.** Inside `processCommand`, before the handler
  lookup, a command past `expiresAt` is **removed entirely**: delete its staged
  attachments, then `deleteDoc(ref)`. It never reaches the handler and leaves no
  terminal `error` doc behind (contrast edge #2, where a command that *ran* and
  failed validation keeps its `error` so the phone can explain it). The phone set
  `expiresAt` itself, so it renders "expired" from the vanished doc without
  needing a status flag.
- **Attachment deletion is host-specific — inject it, keep the runner generic.**
  Core's runner must not know about Storage or the `attachments` param shape. Add
  an optional `onExpire?(command)` hook to `HostRunnerOptions`; the host
  (`server/remoteHost/index.ts`) wires it to read `storage_id`s off
  `command.params.attachments` and delete `users/{uid}/uploads/{storage_id}`
  (best-effort, same tolerance as `ingestAttachments`' cleanup). Absent hook ⇒
  the runner just deletes the doc. Deletion is idempotent, so it needn't go
  through the `claimCommand` transaction — a double-delete from a racing snapshot
  replay simply no-ops.
- **Throttle spawns (open question).** Sequential-or-small-cap spawning avoids a
  worker stampede but adds latency and state to the runner. Leaning: ship
  ordering + expiry-delete first; add throttling only if the stampede is observed.
  Noted as a follow-up, not v1.

## Host-side implementation (this repo — step 1, SHIPPED)

- `packages/core/src/remote-host/index.ts` — extended the `Command` type with
  optional `createdAt` / `expiresAt` / `queuedOffline` (epoch-millisecond numbers,
  not Firestore Timestamps, so the helpers stay pure + browser-safe). Added pure
  `isExpired(command, now)` and `byCreatedAt(left, right)` helpers (`now` injected
  for deterministic tests; the runner passes `Date.now()`). Bumped
  `REMOTE_HOST_PROTOCOL_VERSION` **1 → 2** so the remote gates offline queueing on
  host support.
- `packages/core/src/remote-host/server/hostRunner.ts` — (a) sort each drained
  batch by `createdAt` **in memory** as a *best-effort* dispatch bias, NOT
  `orderBy("createdAt")` on the query (a Firestore `orderBy` silently excludes docs
  missing the field). Processing stays concurrent — out-of-order completion is by
  design (chat is async), so this is not a strict ordering guarantee; (b)
  `processCommand` takes the command data + `now` + the session `uid` and, before
  claiming, routes an expired command to `expireCommand` → `onExpire(command, uid)`
  then `deleteDoc(ref)` (a `deleteDoc` failure is surfaced via `onEvent`, symmetric
  with the `onExpire` failure path; both best-effort/idempotent, no claim
  transaction); (c) added the optional `onExpire?(command, uid)` field to
  `HostRunnerOptions` — `uid` is `channel.uid`, passed in (not read from a global)
  so a concurrent reconnect as a different account can't misdirect cleanup.
- `packages/core/src/remote-host/server/lifecycle.ts` — added `onExpire?` to
  `RemoteHostDeps` and thread it verbatim into the runner options.
- `packages/core/test/remote-host/test_expiry.ts` — pure-helper tests
  (`isExpired` deadline boundary, `byCreatedAt` ordering incl. missing-field);
  `test_lifecycle.ts` — asserts `deps.onExpire` reaches the runner options.
  (Runner orchestration — claim → expire → delete under a live Firestore — is not
  unit-tested here: the runner imports `firebase/firestore` at module scope with
  no injection seam, matching the existing boundary where only pure helpers + the
  lifecycle are unit-tested. Covered by step-3 manual testing instead.)
- `server/remoteHost/onExpire.ts` (new) — the host's `onExpire`: leniently reads
  `storage_id`s off `command.params.attachments` and best-effort
  `deleteObject(users/{uid}/uploads/{storage_id})`. Wired into `createRemoteHost`
  in `server/remoteHost/index.ts`. The handler table, `startChat`, and
  `ingestAttachments` are untouched, so both hosts get ordering + expiry from the
  shared runner and each supplies its own attachment-cleanup wiring (MulmoTerminal
  does its own in step 5).
- `docs/remote-host.md` — new "Offline queueing" section: the drain-on-reconnect
  guarantee, the three new command fields, the ordered-drain / expiry-delete /
  cleanup-ownership rules, and the **TTL-below-expiry invariant** (7-day expiry
  under a 14-day TTL), cross-linked from the attachments section.

## Cross-repo follow-up (mulmoserver — NOT this repo)

The mobile client owns the actual offline experience and depends on a **published**
`@mulmoclaude/core` carrying the extended `Command` type:

- Cache `listCollections` / `listSkills` / roles to `localStorage`; render the
  compose UI from the cache when presence is offline.
- **Gate on `protocolVersion >= 2`** in the presence doc before offering offline
  queueing at all — a v1 host ignores `expiresAt` and would spawn stale chats.
- Change offline gating from **block → queue**: emit the `startChat` command with
  `queuedOffline: true`, `createdAt`, and an `expiresAt` inside the Storage-TTL
  horizon, with a clear "will send when your Mac is online" affordance.
- **Pending-queue UI:** list the user's own `status == "queued"` commands and let
  the user **delete** one before the host drains it — delete the command doc *and*
  its staged Storage uploads. Offer delete for `queued` only (a `processing`/`done`
  command has already spawned on the host). This is the "differentiated treatment"
  half on the client.
- **Exempt `queuedOffline` commands from the ack-timeout attachment rollback**
  (edge #1) — user-delete and host-expiry now own that cleanup instead.
- On reopen, re-read command docs to show sent ✓ / role-gone ✗ (an `error` doc)
  or expired ✗ (a vanished doc past its own `expiresAt`). The phone need not hold
  a live listener — `startChat` is fire-and-forget; the chat is visible on the
  host, not streamed back.

## Implementation order

The contract lives in `@mulmoclaude/core`, which MulmoClaude consumes via
workspace linking (immediate) but MulmoServer + MulmoTerminal consume as a
**published** dep. **Release rule (this repo): a launcher-pinned shared package
must be published DURING the PR — publish-after-merge does not work here.** The
`smoke` CI job (`scripts/mulmoclaude/tarball.mjs`) `npm pack`s the launcher and
`npm install`s it, resolving the launcher's `@mulmoclaude/*` deps **from the npm
registry** (a real user install, no workspace fallback). So a bumped-but-unpublished
version fails `smoke` with `ETARGET No matching version found`, even though the
launcher-sync gate (npm-agnostic) stays green. Publish core first, then dependents;
then `gh run rerun <run-id> --failed` (a new npm version doesn't auto-retrigger CI).

| # | Repo | Deliverable | Status |
|---|---|---|---|
| 1 | **MulmoClaude** | Core contract (`Command` fields, `isExpired` / `byCreatedAt`, best-effort in-memory drain order, expiry-delete + `onExpire(command, uid)` hook, `protocolVersion` 1→2) **and** this host's `onExpire` cleanup (`server/remoteHost/onExpire.ts`). Version **bumped to `core@0.12.0` + `collection-plugin@0.7.3`** in-PR. Works immediately via workspace linking. | ✅ in PR |
| 2 | **shared pkgs** | **Publish DURING the PR** (`smoke` needs it): `@mulmoclaude/core@0.12.0` then `@mulmoclaude/collection-plugin@0.7.3` (`/publish` skill), then re-run failed CI. | ⏳ blocking CI |
| 3 | **MulmoServer** | Client: localStorage pick-list cache, `protocolVersion >= 2` gate, block→queue gating, pending-list + delete UI, `queuedOffline` rollback exemption. **Dev-links** the local workspace core during development; pins the published version. | — |
| 4 | — | Manual test end-to-end: phone composes offline → command queues → host reconnect drains / expired command deletes doc + attachments / user deletes a pending item. | — |
| 5 | **MulmoTerminal** | Bump its `@mulmoclaude/core` dep to the published version; wire its **own** `onExpire(command, uid)` cleanup. Gets drain-order + expiry-delete for free from the shared runner — only the host-specific Storage cleanup is per-host. | — |

**Contract-freeze rule:** the `Command` fields + `HostRunnerOptions.onExpire`
shape + `protocolVersion` must be settled before step 3 consumes them. A late
contract change loops back to **step 1** (change core, re-bump + re-publish).

The in-PR version bump is a `chore(release)` that bumps the package versions +
the `@mulmoclaude/core` / `@mulmoclaude/collection-plugin` dep **ranges** in the
launcher, **not** the launcher's own `version` (see CLAUDE.md). Earlier
intermediate publishes (`core@0.11.0`, `collection-plugin@0.7.2`) were superseded
by `0.12.0` / `0.7.3` — harmless, just unused version numbers.

## Non-goals

- **No new queue channel** — the existing `commands` collection is the queue.
- **No streaming results to the phone** — `startChat` stays fire-and-forget; the
  command doc's terminal `status` is the only feedback, read lazily on reopen.
- **No spawn throttling in v1** — ordering + expiry first; throttle only if a
  stampede is observed (edge #3).
- **No silent role fallback** — stale pick-lists reject cleanly (edge #2).
- **No offline support for other methods** — read methods (`listCollections`,
  `getCollection`, `getRemoteView`, …) are pointless to queue; they serve the
  phone's *current* view and are simply unavailable offline (served from cache
  where the phone already has data). Only `startChat` is a genuine deferred
  action.
