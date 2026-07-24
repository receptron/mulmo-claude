# feat: Full-resolution photo attachments on remote chat messages

## Goal

The mobile remote can start a chat on the host (`startChat`), but today it can
only send **text**. We want the remote to attach **full-resolution photos** to a
chat message. The command channel can't carry the bytes — a Firestore command
document is capped at ~1 MiB and full-res photos are many MiB — so the bytes
travel through **Firebase Storage** instead, and the command carries only a
reference.

The shape the remote sends becomes:

```jsonc
// startChat params
{ "message": "...", "attachments": [{ "storage_id": "<uuid>" }, ...] }
```

> **Contract update (2026-07-03): `images` → `attachments`, non-image types.**
> Attachments are no longer image-only — the remote can attach **photos, videos
> and PDFs**. The param is renamed `images` → **`attachments`** (both repos + the
> Storage rule updated to match), and the Storage rule's content-type allowlist
> is widened from `image/*` to `image/* | video/* | application/pdf` with the
> size cap raised to 100 MiB (short mobile videos). The host ingest is otherwise
> unchanged — `data/attachments/` + `saveAttachment` already accepts any type.
> References to `params.images` / "photos" / "images" below should be read as
> `params.attachments` / "files".

The host downloads each referenced object from Storage into its **workspace
attachment store** (`data/attachments/{year}/{month}/`), **deletes the Storage
object**, and passes the resulting file path(s) to the LLM together with the
message. Everything the LLM does with the file after that is up to the LLM —
this feature only gets the bytes from the phone into the workspace and hands the
path to the agent.

> **Correction (supersedes the original `artifacts/images/` plan).** The first
> draft stored ingested photos under `artifacts/images/{year}/{month}/`. That
> root is **PNG-only** in the attachment pipeline: `isImagePath` accepts `.png`
> only, so a `.jpg`/`.webp`/`.heic` photo there is rejected by
> `collectAttachedPaths` / `loadFromPath` and never reaches the LLM, and its
> loader hardcodes `image/png`. The correct home is `data/attachments/`, written
> via `saveAttachment(base64, contentType)` — `isAttachmentPath` accepts any
> extension and `inferMimeFromExtension` maps the real type. This is exactly the
> path Vue uploads and bridge photos already take. It is **host-internal**, so
> the cross-repo contract (which only carries `storage_id`) is unaffected.

This mirrors the existing **read** direction (see
`feat-remote-view-images.md`): there, a workspace image path is turned into a
`data:` URL so the phone can render it. Here, in the **write** direction, a
full-res photo is too big to inline, so **Storage plays the role that the
`data:` URL plays on the read path** — a transport across the Firestore
boundary. Storage is a *staging area*, not the photo's home; the workspace is
its home.

## Two repos, two parallel PRs

- **mulmoserver (remote client + contract)** — being implemented in parallel by
  another Claude Code. Uploads the photos to Storage, extends `startChat` params
  with `attachments`, adds the compose-sheet attach UI, and adds the Storage security
  rule. Detailed in that repo; summarized here only so the contract is legible
  from one document.
- **mulmoclaude (host) — THIS PLAN.** Extend the `startChat` handler to ingest
  the referenced Storage objects into the workspace and hand their paths to the
  spawned chat.

The two sides meet **only** at the contract in the next section. Nothing else is
shared.

---

## The contract (both sides depend on exactly this)

### Storage staging path

```
users/{uid}/uploads/{storage_id}
```

- `uid` — the shared Google account UID. Host and remote both sign in as the
  same account (`signInHost` / `signInWithCredential`), so the host resolves the
  full path from its own `currentUid()` + the `storage_id` in the command. The
  command never carries the uid or the full path — just the `storage_id`.
- `storage_id` — a plain **UUID** (`crypto.randomUUID()`), no extension, no
  year/month. The remote mints one per photo. (The year/month bucketing is a
  *workspace* concern the host decides at download time — Storage stays flat.)

### `startChat` params

```jsonc
{
  "message": "string (required, unchanged)",
  "attachments": [ { "storage_id": "uuid" }, ... ]   // optional; omitted when no files
}
```

- `attachments` is an **array** (decided: keep it plural for future multi-attach
  even though today's UI may send one at a time).
- Absent / empty `attachments` ⇒ current behaviour, byte-for-byte. This is a
  **purely additive** change to the handler; the existing `{ message }` and
  legacy `{ slug, … }` forms are untouched.

### Storage security rule (owned by mulmoserver's `storage.rules`)

```
match /users/{uid}/uploads/{storageId} {
  allow read, delete: if request.auth != null && request.auth.uid == uid;      // host ingests + cleans up
  allow write:        if request.auth != null && request.auth.uid == uid
                      && request.resource.size < 100 * 1024 * 1024              // full-res cap (short mobile video)
                      && (request.resource.contentType.matches('image/.*')      // photos
                        || request.resource.contentType.matches('video/.*')     // videos
                        || request.resource.contentType == 'application/pdf');   // PDFs
}
```

The host relies on **read + delete** being allowed for the owning uid.

### Lifecycle

The **host deletes the Storage object after ingesting it** (decided). Storage is
staging only. The host should delete after a *successful download into the
workspace*, independent of whether the chat spawn later succeeds (the bytes are
safely in the workspace by then). A Storage lifecycle TTL rule is a belt-and-
suspenders follow-up for orphans (uploads whose host never ran), not required
for v1.

---

## Host-side implementation (this PR)

### 1. Expose Storage from the host's Firebase init

`server/remoteHost/firebase.ts` already initializes the modular web SDK signed
in as the user. Add Storage alongside Firestore/Auth:

```ts
import { getStorage } from "firebase/storage";
// ...
export const storage = getStorage(firebaseApp);
```

Because the host is authenticated as the owning uid, `getBytes` / `deleteObject`
against `users/{uid}/uploads/{storage_id}` are authorized by the same rule the
remote's upload passed — no admin SDK, no service account.

### 2. An attachment-ingest module

New `server/remoteHost/handlers/ingestAttachments.ts` (kept separate from
`startChat.ts` so the handler stays thin and this is unit-testable with the
Storage + fs deps stubbed):

Responsibilities, per `storage_id`:

1. Build the ref `users/{uid}/uploads/{storage_id}` from `currentUid()`. Reject
   the command if the host isn't signed in (`uid === null`). Validate each
   `storage_id` is a safe token (letters/digits/hyphens, no `/` or `..`) before
   it goes into the Storage path.
2. `getBytes(ref)` to pull the full-res bytes + `getMetadata(ref)` for the
   `contentType`. **Use `getBytes`, not `getBlob`** — `getBlob` is browser-only
   in the Firebase SDK; `getBytes` returns an `ArrayBuffer` and works on the
   Node host (the web SDK already "runs unchanged in Node" for Firestore here —
   Storage over the web SDK in Node is less trodden, so smoke-test that
   `getBytes`/`deleteObject` authorize as the signed-in uid).
3. Persist via **`saveAttachment(base64, contentType)`**
   (`server/utils/files/attachment-store.ts`) — it derives the extension from
   the mime, shards under `data/attachments/{YYYY}/{MM}/`, writes atomically, and
   returns `{ relativePath, mimeType }`. This is the exact store Vue uploads and
   bridge inline-bytes already use, so the ingested file is validated by
   `isAttachmentPath` and mime-typed by `inferMimeFromExtension` downstream. (We
   let `saveAttachment` mint the on-disk id; the `storage_id` is only a Storage
   staging reference and needn't be the workspace filename.)
4. `deleteObject(ref)` after the file is written.
5. Return an **`Attachment`** (`{ path: relativePath, mimeType }`) per file, in
   order — the path-only + mime form the spawn/`startChat` attachment channel
   consumes directly (see RESOLVED section).

Signature sketch (deps injected for tests):

```ts
export interface IngestDeps {
  uid: () => string | null;                                              // currentUid
  fetchObject: (storagePath: string) => Promise<{ base64: string; contentType: string }>;
  saveAttachment: (base64: string, mimeType: string) => Promise<{ relativePath: string; mimeType: string }>;
  deleteObject: (storagePath: string) => Promise<void>;
}

// storage_ids -> path-only Attachments, in order. Rejects if any download fails.
export const createIngestAttachments = (deps: IngestDeps) =>
  async (storageIds: string[]): Promise<Attachment[]> => { /* ... */ };
```

Validate each entry defensively (it arrives as JSON): coerce `params.attachments`
to an array, each element to `{ storage_id: string }`. **Reject the whole command** on
a malformed entry OR a referenced object that can't be downloaded — the remote
already uploaded and is waiting on the result, so surfacing the error beats
silently starting a chat with a missing photo. `saveAttachment` /
`writeFileAtomic` already apply the path-containment guard.

**Known trade — partial-ingest orphan.** With per-`storage_id` "delete after
write" plus "reject the whole command on any failure", a later photo failing
leaves earlier photos already written to `data/attachments/` AND their Storage
objects already deleted, while the command rejects and no chat spawns. The
result is an orphaned workspace attachment no chat references. Accepted for v1
(no data loss, no broken chat); a cleanup pass is not worth the complexity now.

### 3. Wire it into `startChat`

In `server/remoteHost/handlers/startChat.ts`, after computing `seed` and before
spawning, ingest any attachments and hand their paths to the spawner:

```ts
const message = /* unchanged */;
const seed = hasSlug(params.slug) ? await composeCollectionSeed(...) : message;

const ingestedAttachments = await deps.ingest(readStorageIds(params.attachments));

const result = await deps.spawn({
  message: seed,
  roleId: DEFAULT_ROLE_ID,
  hidden: false,
  // Path-only Attachments — the blessed form (see RESOLVED section). The
  // server loads bytes for these before the model sees them.
  attachments: ingestedAttachments,
});
```

Extend `StartChatDeps` with the ingest dependency; keep `createStartChat`
factory-injectable so the existing unit tests keep stubbing spawn/loadCollection
and a new test can stub ingest. Update `handlers/index.ts` only if the wiring of
the default export changes (it registers `startChat` already).

### 4. Tests (`test/remoteHost/`)

- `test_ingestAttachments.ts` — with stubbed deps: builds the right Storage path from
  uid + storage_id; calls `saveAttachment` with the fetched bytes + contentType;
  deletes the object after writing (ordering); returns path-only `Attachment`s
  (`{ path, mimeType }`); rejects when the host isn't signed in; rejects on a
  failed download; no-ops on empty input; rejects a malformed `storage_id`.
- Extend `test_startChat.ts` — `{ message }` with no `attachments` behaves
  exactly as today (no ingest calls); `{ message, attachments:[{storage_id}] }`
  ingests and the spawned call carries the resulting attachment(s); a malformed
  `attachments` entry rejects the command without spawning.

---

## RESOLVED: the ingested paths ride the existing `Attachment` channel

The former open question ("how does the ingested path reach the LLM?") is
settled by the prior art — **Option 1 (first-class attachments), not a
message-text append.**

The underlying `startChat` in `server/api/routes/agent.ts` already accepts
`attachments?: Attachment[]` (agent.ts:126), and a **path-only** `Attachment`
is a blessed, supported form: `Attachment` (`packages/protocol/src/attachment.ts`)
is `{ path?: "data/attachments/…"; mimeType?; filename? }`, with
`data/attachments/...` (any extension) an allowed root. Server-internal
normalisation (`prepareRequestExtras`) loads the bytes for path-only entries
before the agent sees them, so the image reaches the model as a **native image
block** — exactly how the Vue UI's path-only attachments already flow. This is
precisely the shape `ingestAttachments` returns, so there is nothing new to invent.

The **only gap** is that `spawnSystemWorker({ message, roleId, hidden })` drops
everything but those three fields — it calls
`startChat({ message, roleId, chatSessionId, origin })` (agent.ts:174) and never
forwards attachments. So the plumbing is a one-param addition:

```ts
// spawnSystemWorker: add attachments, forward it
export async function spawnSystemWorker(args: {
  message: string; roleId: string; hidden: boolean;
  attachments?: Attachment[]; onComplete?: CompletionHook;
}) {
  ...
  result = await startChat({ message, roleId, chatSessionId: chatId, origin, attachments: args.attachments });
```

`startChat` (the remote handler) maps each ingested workspace-relative path to
`{ path }` and passes the array as `attachments`. `mimeType` is optional (the
server infers it from the extension), but since ingest already reads
`contentType` to pick the extension, setting `mimeType` too is free and slightly
more robust.

**Option 2 (append the path into the seed text) is rejected**: it bypasses the
byte-loading/conversion pipeline, so the model would receive a path *string* it
can't see unless it separately reads the file — strictly worse than a native
image block.

The mulmoserver side does **not** depend on any of this — it only sends
`storage_id`s.

---

## Decisions already locked (do not re-litigate)

- `storage_id` is a bare **UUID**; Storage path is `users/{uid}/uploads/{uuid}`,
  flat (no year/month in Storage).
- The param is **`attachments`** (renamed from `images`), an **array** on
  `startChat` params (future multi-attach), even if the first UI ships
  single-select. Allowed types: **image/\*, video/\*, application/pdf**; size cap
  **100 MiB**.
- The **host deletes** each Storage object after ingesting it into the
  workspace.
- Workspace destination: **`data/attachments/{year}/{month}/<id>.<ext>`** via
  `saveAttachment(base64, contentType)` (ext from contentType). This supersedes
  the original `artifacts/images/` decision — see the Correction under Goal: the
  images root is PNG-only in the attachment pipeline, so non-PNG photos wouldn't
  reach the LLM. Host-internal, so the contract is unaffected.
- The ingested paths reach the LLM as **path-only `Attachment`s** forwarded
  through `spawnSystemWorker` → `startChat` (Option 1), NOT appended into the
  message text. See the RESOLVED section.

## Non-goals

- No new Cloud Function — the whole flow is Storage + the existing Firestore
  command channel (per mulmoserver's "avoid Functions" rule).
- No change to the read/thumbnail path (`feat-remote-view-images.md`).
- No image transform/resize on ingest — full-res lands in the workspace as-is;
  what the LLM does with it is out of scope.
