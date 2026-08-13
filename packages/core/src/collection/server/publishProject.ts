// authored (`app.json`) → published (`apps/{aid}`). The compilation step.
//
// THE WHOLE CONVERSION LIVES HERE. That is the point of the module, not a
// tidiness claim: the design note's D4 calls publish a compiler, and the
// failure it is guarding against is "I wrote what the sample shows and the
// rules refuse it". Every difference between what a human writes and what the
// rules read is either in this file or is a bug.
//
// What actually differs, and why:
//
//   window.from / window.until (ISO strings)  →  window.fromMs / untilMs (numbers)
//     The rules do not coerce a string to a timestamp. Comparing an ISO string
//     with `request.time` is a TYPE ERROR, and a rules type error denies. The
//     symptom is not an error message, it is "nobody can submit".
//
//   members                                   →  members + memberEmails
//     Denormalised so a client can ask "which apps am I in?" with
//     `array-contains`. It is DERIVED, never authored: `membersConsistent()`
//     refuses any write where the two disagree, so a hand-written value cannot
//     survive anyway — it can only make the whole publish fail with a
//     permission error that says nothing about the cause.
//
//   —                                         →  owner / publishedAt / publishedBy /
//                                                publishedCommit / previousPublished
//     Attribution and rollback. `owner` is a uid and the publisher's identity;
//     see `projectApp`'s parameter for why it is threaded in rather than read
//     from the declaration.
//
// WHAT DOES *NOT* CHANGE, and the temptation to make it change:
// `public.read` and `participantRead` stay ARRAYS. The rules test them with
// `cid in a.public.read`, which in the rules language means "is an element of"
// for a list and "is a key of" for a map — so a `{cid: true}` map would work
// equally well, and an earlier draft of the handoff note specified one. Two
// spellings that both work is exactly the kind of silent divergence this
// module exists to prevent, so the published form is the authored form and
// the emulator round-trip test (`../mulmoserver test/rules/rules_publish.ts`)
// pins that the rules accept it.

import { isRecord } from "@mulmoclaude/common";
import type { CollectionSchema } from "../core/schema";
import { normalizeViews, VIEW_CONFIG_ID, viewDocId } from "./appViews";
import type { AuthoredApp, AuthoredCollectionConfig, AuthoredSubmit } from "./publishManifest";

/** Who and when. Threaded in rather than read from a clock inside the
 *  projection so the projection stays pure and the tests can assert on an
 *  exact document. */
export interface PublishStamp {
  /** The publisher's Firebase uid. The rules require `owner ==
   *  request.auth.uid` on CREATE and `owner` unchanged on UPDATE, so this is
   *  used only when the app document does not exist yet. */
  uid: string;
  /** The publisher's verified email — the principal the roster is keyed by. */
  email: string;
  /** Wall-clock millis of this publish. */
  publishedAt: number;
  /** The git commit the declaration was read from, when the host could
   *  resolve one. Absent is a normal state (a dirty tree, a repository
   *  without git), and absent is more honest than a fabricated value. */
  commit?: string | undefined;
  /** Was the working tree modified when the commit was read?
   *
   *  Recorded as `publishedDirty` on the app document, because a commit that
   *  does not describe what was published is worse than no commit: it looks
   *  auditable. Publish-owned like the rest of the `published*` family — a
   *  deploy must not drop the marker, and a later CLEAN publish must clear it
   *  rather than inherit it forever. */
  dirty?: boolean | undefined;
}

/** One collection's published schema document (`apps/{aid}/collections/{cid}`).
 *
 *  The rules never read `publishedSchema` — `schemaRead` gates the whole
 *  document and stops there. It is here for the CLIENTS: a member's host
 *  renders from it, and a public webview has no other way to know the fields.
 *  The whole schema is published rather than a projection of it, because
 *  every attempt to guess "the part a view needs" is a guess about a view
 *  that has not been written yet. */
export interface PublishedSchemaDoc extends Record<string, unknown> {
  publishedSchema: CollectionSchema;
  publishedAt: number;
  publishedBy: string;
  publishedCommit?: string;
}

/** A STAGED schema document (`apps/{aid}/staging/{cid}`) — what deploy writes
 *  and what `/staging/{aid}` renders from.
 *
 *  Its provenance keys are `deployed*`, not `published*`. The two are different
 *  questions with different answers at almost every moment: `published*` says
 *  which revision the PUBLIC is looking at, and a deploy must not move it —
 *  otherwise staging a draft rewrites the recorded public revision (and, with
 *  `previousPublished`, the thing a rollback would restore) before anyone has
 *  published anything. */
export interface StagedSchemaDoc extends Record<string, unknown> {
  publishedSchema: CollectionSchema;
  /** This collection's RULE-FACING configuration (`transitions`, `immutable`,
   *  `submitOnly`, `peerVisibility`, …) — staged with the schema, not written
   *  straight onto the app document.
   *
   *  It has to be staged for the same reason the `public` block is: the rules
   *  read `apps/{aid}.collections[cid]` when they authorize a PUBLIC write, so
   *  a deploy that landed it would change what anonymous visitors may do
   *  before anyone published. The cost is that `/staging/{aid}` exercises the
   *  new schema against the CURRENTLY PUBLISHED rule configuration; that is
   *  the safe direction to be wrong in. */
  config?: AuthoredCollectionConfig;
  /** Whether this cid is in `participantRead` — same reason, same treatment. */
  participantRead?: boolean;
  deployedAt: number;
  deployedBy: string;
  deployedCommit?: string;
}

/** The public settings document (`apps/{aid}/config/public`).
 *
 *  `allow read: if true` — this is the one document an anonymous visitor can
 *  read, and it is the reason `apps/{aid}` itself is reader-only: a
 *  participant reading the app document would see their classmates'
 *  addresses. So the roster is NOT here, and neither is `owner`. What is here
 *  is what a public form needs in order to render itself and to tell a visitor
 *  "this closed yesterday" instead of failing a write with no explanation. */
export interface PublishedConfigDoc extends Record<string, unknown> {
  name?: string;
  enabled: boolean;
  read: string[];
  submit: Record<string, Record<string, unknown>>;
  /** That the app HAS a published view, and which datasets it asked for.
   *
   *  This is the only place the public page can learn it: the rules' app
   *  document is reader-only and deliberately carries no view, and the HTML
   *  itself lands in a SEPARATE document (`config/view`) because a 1 MiB limit
   *  applies per document. Omitted here, the page has the HTML and no idea
   *  what to send it — the feature does not work at all.
   *
   *  The authored PATH is deliberately not published. It names a file in the
   *  author's repository, which the browser cannot use and which nobody should
   *  be handed on a world-readable document; what the page needs is the
   *  dataset list, and `publishedAt` beside it is what pins this declaration
   *  to the HTML published in the same run. */
  view?: { collections: string[] };
  publishedAt: number;
}

/** Everything one publish writes. Separate documents because they live at
 *  separate paths with separate rules — and in the order given: the app
 *  document authorizes the other two, so it goes first. */
export interface PublishedApp {
  app: Record<string, unknown>;
  schemas: { cid: string; doc: PublishedSchemaDoc }[];
  config: PublishedConfigDoc;
}

/** The document id under `apps/{aid}/config`. One document, named, rather than
 *  a spread of them: a second public document is a second thing to keep in
 *  step, and nothing yet needs one. */
export const PUBLIC_CONFIG_DOC = "public";

/** Drop keys whose value is `undefined`. Firestore rejects an undefined field
 *  value outright, and `"k" in c` — which every optional key in the rules is
 *  read through — must mean "the author declared it". */
function compact(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

/** ISO → epoch millis, the one conversion the rules cannot do for themselves.
 *  The caller has already refused an unparseable string (the authored parser
 *  requires `z.iso.datetime()`), so a NaN here would be a programming error;
 *  it is still checked, because a NaN written to Firestore fails closed in the
 *  same silent way an ISO string does. */
function windowMillis(
  window:
    | {
        from?: string | undefined;
        until?: string | undefined;
        fromField?: Record<string, string> | undefined;
        untilField?: Record<string, string> | undefined;
      }
    | undefined,
): Record<string, unknown> | undefined {
  if (!window) return undefined;
  const out: Record<string, number> = {};
  if (window.from !== undefined) out.fromMs = Date.parse(window.from);
  if (window.until !== undefined) out.untilMs = Date.parse(window.until);
  if (Object.values(out).some((value) => !Number.isFinite(value))) {
    throw new Error(`publish: window bound is not a parseable timestamp (${JSON.stringify(window)})`);
  }
  // `fromField` passes through unlowered — it names a field on another record,
  // and the value it points at is already epoch millis (whoever schedules the
  // class writes it). There is nothing here to convert, and dropping it is the
  // failure this function's own comment warns about: the rules would stop
  // seeing a bound the author declared, and the window would silently be open.
  const projected: Record<string, unknown> = {
    ...out,
    ...(window.fromField === undefined ? {} : { fromField: window.fromField }),
    ...(window.untilField === undefined ? {} : { untilField: window.untilField }),
  };
  return Object.keys(projected).length > 0 ? projected : undefined;
}

/** One `public.submit[cid]`, with its window lowered. Everything else passes
 *  through: the rules read these keys by the names the author wrote.
 *
 *  Exported because the HOST needs the identical conversion: the same
 *  declaration is projected twice, once into `config/public` here (which
 *  `firestore.rules` reads, and which mulmoserver's `test/rules/rules_publish.ts`
 *  checks against the real rules) and once into each tier's `config` document
 *  by MulmoTerminal. Two implementations of an ISO-to-millis lowering is
 *  exactly the divergence that is invisible until a submit window silently
 *  stops closing, so there is one and the host imports it. */
export function projectSubmit(submit: AuthoredSubmit): Record<string, unknown> {
  const { window, ...rest } = submit;
  return compact({ ...rest, window: windowMillis(window) });
}

/** The roster's addresses as a set, in a stable order.
 *
 *  Sorted so two publishes of the same declaration produce the same document
 *  — idempotence is a property this step is tested for, and Firestore compares
 *  arrays by ORDER. `membersConsistent()` compares as sets and would accept
 *  any order; the test that would notice is the one asserting a second publish
 *  changes nothing but `publishedAt`. */
function memberEmailsOf(members: AuthoredApp["members"]): string[] {
  return Object.keys(members).sort();
}

/** The previous document, kept for rollback, with its OWN `previousPublished`
 *  stripped.
 *
 *  One level, deliberately. Chaining would make every publish carry the entire
 *  history of the app inside a single document, which grows without bound and
 *  meets Firestore's 1 MiB document limit as a permission-shaped failure at
 *  some unpredictable publish. One level answers the question rollback
 *  actually asks — "put back what was there before I broke it" — and the
 *  further history is in git, which is where the declaration came from. */
function previousOf(existing: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!existing) return undefined;
  const { previousPublished: __dropped, ...rest } = existing;
  return rest;
}

/** Project the authored declaration into the documents publish writes.
 *
 *  `existing` is the app document as it is in Firestore right now, or null on
 *  a first publish. Two things need it, both required by the rules:
 *    - `owner` must be UNCHANGED on update. Re-stamping the publisher's uid
 *      would be refused for any app whose owner ever signed in as a different
 *      account, and would silently transfer ownership if it were not.
 *    - `previousPublished` is that document, so a rollback has something to
 *      put back.
 *
 *  Pure: no clock, no filesystem, no Firestore. Everything variable arrives as
 *  a parameter, which is what makes the conversion table testable as a table. */
export function projectApp(
  authored: AuthoredApp,
  schemas: { cid: string; schema: CollectionSchema }[],
  stamp: PublishStamp,
  existing: Record<string, unknown> | null,
): PublishedApp {
  const owner = typeof existing?.owner === "string" ? existing.owner : stamp.uid;
  const submit = Object.fromEntries(Object.entries(authored.public?.submit ?? {}).map(([cid, spec]) => [cid, projectSubmit(spec)]));
  const publicBlock = authored.public
    ? compact({
        enabled: authored.public.enabled,
        read: authored.public.read,
        submit: Object.keys(submit).length > 0 ? submit : undefined,
      })
    : undefined;

  const app = compact({
    aid: authored.aid,
    name: authored.name,
    owner,
    members: authored.members,
    memberEmails: memberEmailsOf(authored.members),
    collections: authored.collections,
    participantRead: authored.participantRead,
    public: publicBlock,
    publishedAt: stamp.publishedAt,
    publishedBy: stamp.email,
    publishedCommit: stamp.commit,
    publishedDirty: stamp.dirty === true ? true : undefined,
    previousPublished: previousOf(existing),
  });

  // Refusals belong to the gate (`publishProblems`), which has already run by
  // the time anything is projected. A declaration that cannot be normalized
  // here is a programming error, and projecting half of it would publish a
  // page with no data.
  const normalized = normalizeViews(authored);
  if (!normalized.ok) throw new Error(`publish: views declaration is not publishable (${normalized.problems.join(" ")})`);
  const publicView = normalized.views.find((view) => view.audience === "public");

  const config: PublishedConfigDoc = {
    enabled: authored.public?.enabled === true,
    read: authored.public?.read ?? [],
    submit,
    // Read through the normalization, not off `public.view`: an app that
    // declares its public page in `views[]` must publish the same document, or
    // the page has the HTML and no idea what to send it.
    ...(publicView === undefined ? {} : { view: { collections: publicView.collections } }),
    publishedAt: stamp.publishedAt,
  };
  if (authored.name !== undefined) config.name = authored.name;

  return { app, schemas: schemas.map(({ cid, schema }) => ({ cid, doc: schemaDoc(schema, stamp) })), config };
}

/** Everything `deploy` writes — the host's staging half of the split (the
 *  design's D10).
 *
 *  Two things are deliberately ABSENT from the app document here:
 *
 *  - **`public`**. That block is what the rules read to authorize anonymous
 *    access (`publicOn` / `subOpen` read `apps/{aid}.public`, never the
 *    world-readable `config/public`), so writing it on deploy would open the
 *    app the moment someone deployed to test. It belongs to `publish`.
 *  - **the published schemas**. They go to `staging/{cid}`, which only the
 *    roster can read, so a deploy against a LIVE app does not swap the view
 *    its visitors are looking at.
 *
 *  A host writing this must MERGE the app document rather than replace it:
 *  a replace would drop a `public` block a previous publish put there and
 *  silently unpublish the app. */
export interface DeployedApp {
  /** The COMPLETE app document. **Write it with `set`, replacing — never with
   *  `{ merge: true }`.**
   *
   *  A merge cannot DELETE, and every deletion here is a permission change:
   *  removing `members.<email>` revokes access, and a merge would leave the
   *  entry live. Worse, the rules require `memberEmails` to equal the keys of
   *  `members` (`membersConsistent()`), so a merged member-removal is rejected
   *  outright — a deploy that silently does nothing would be the good case.
   *
   *  Everything publish owns is carried through from `existing` verbatim, so
   *  replacing does not unpublish a live app. */
  app: Record<string, unknown>;
  /** The staged schema documents, for `apps/{aid}/staging/{cid}`. */
  staging: { cid: string; doc: StagedSchemaDoc }[];
}

/** Keys on the app document that publish owns: what is PUBLIC right now, and
 *  the rule-facing configuration anonymous access is judged against. Deploy
 *  carries them through from the existing document and never authors them. */
const PUBLISH_OWNED_KEYS: readonly string[] = [
  "public",
  "collections",
  "participantRead",
  "publishedAt",
  "publishedBy",
  "publishedCommit",
  "publishedDirty",
  "previousPublished",
];

const isPublishOwned = (key: string): boolean => PUBLISH_OWNED_KEYS.includes(key);

export function projectDeploy(
  authored: AuthoredApp,
  schemas: { cid: string; schema: CollectionSchema }[],
  stamp: PublishStamp,
  existing: Record<string, unknown> | null,
): DeployedApp {
  const { app } = projectApp(authored, schemas, stamp, existing);
  // Drop everything publish owns, then carry the LIVE value through — the
  // write replaces, so anything not handed back would be deleted.
  const deployed = Object.fromEntries(Object.entries(app).filter(([key]) => !isPublishOwned(key)));
  for (const key of PUBLISH_OWNED_KEYS) {
    const live = existing?.[key];
    if (live !== undefined) deployed[key] = live;
  }
  deployed.deployedAt = stamp.publishedAt;
  deployed.deployedBy = stamp.email;
  if (stamp.commit !== undefined) deployed.deployedCommit = stamp.commit;
  return {
    app: deployed,
    staging: schemas.map(({ cid, schema }) => ({ cid, doc: stagedDoc(schema, stamp, authored, cid) })),
  };
}

/** One staged schema document, carrying this cid's rule-facing configuration
 *  alongside the schema so publish can promote them together. */
function stagedDoc(schema: CollectionSchema, stamp: PublishStamp, authored: AuthoredApp, cid: string): StagedSchemaDoc {
  const doc: StagedSchemaDoc = { publishedSchema: schema, deployedAt: stamp.publishedAt, deployedBy: stamp.email };
  const config = authored.collections?.[cid];
  if (config !== undefined) doc.config = config;
  if (authored.participantRead?.includes(cid) === true) doc.participantRead = true;
  if (stamp.commit !== undefined) doc.deployedCommit = stamp.commit;
  return doc;
}

/** Everything `publish` writes that is NOT a promotion — the public face.
 *
 *  The schemas are absent on purpose: publish PROMOTES the documents deploy
 *  staged (copy `staging/{cid}` → `collections/{cid}`, re-stamped with
 *  {@link promoteSchema}) rather than re-projecting them from git. What the
 *  roster tested is then exactly what ships; re-projecting would publish
 *  whatever the working tree says at publish time, which nobody has looked at
 *  through `/staging/{aid}`.
 *
 *  WRITE `public` LAST. It is the only one of the three that grants anything,
 *  so a partial failure with it last leaves the app private (fail closed).
 *  See the design note's publish ordering. */
export interface PublishedFace {
  /** The COMPLETE app document **without `public`** — write it with `set`,
   *  replacing.
   *
   *  Replacing (not merging) is what lets a key DISAPPEAR: withdrawing a
   *  collection's rule configuration, or taking `public` out of `app.json`,
   *  has to actually remove the field. Everything deploy owns is carried
   *  through from `existing`, so publishing does not revert an invitation.
   *
   *  `public` is absent HERE on purpose — see {@link PublishedFace.public}. */
  app: Record<string, unknown>;
  /** `apps/{aid}/config/public` — the world-readable projection. */
  config: PublishedConfigDoc;
  /** The `public` block, to be written **LAST, as its own update** — or, when
   *  `undefined`, DELETED from the app document (that is how an app becomes
   *  private again).
   *
   *  Separate from {@link PublishedFace.app} because it is the only one of
   *  publish's writes that GRANTS anything: the rules authorize anonymous
   *  reads and submissions from `apps/{aid}.public`. Writing it inside the
   *  replacement document would open the app before the promoted schemas and
   *  the world-readable config exist, so a failure part-way would leave
   *  anonymous access live against a half-published surface. Written last, the
   *  same failure leaves the app private — which is the direction to fail in.
   *
   *  A re-publish therefore passes through a moment with no `public` block.
   *  That is a brief denial for visitors, not a brief exposure. */
  public: Record<string, unknown> | undefined;
}

/** The rule-facing configuration to promote, read from the STAGED documents
 *  rather than from the manifest as it reads right now.
 *
 *  Otherwise: deploy revision A, edit `app.json` to revision B, publish — and
 *  the promoted schema is A's while the authorization behaviour is B's, a
 *  combination nobody exercised through `/staging/{aid}`.
 *
 *  (`public` is deliberately NOT part of this: it is not staged, because it is
 *  the decision being made AT publish rather than something under test.) */
export function stagedRuleConfig(staged: { cid: string; doc: StagedSchemaDoc }[]): {
  collections: Record<string, AuthoredCollectionConfig> | undefined;
  participantRead: string[] | undefined;
} {
  const entries: [string, AuthoredCollectionConfig][] = [];
  const participantRead: string[] = [];
  for (const entry of staged) {
    const { config } = entry.doc;
    if (config !== undefined) entries.push([entry.cid, config]);
    if (entry.doc.participantRead === true) participantRead.push(entry.cid);
  }
  return {
    collections: entries.length > 0 ? Object.fromEntries(entries) : undefined,
    participantRead: participantRead.length > 0 ? participantRead : undefined,
  };
}

export function projectPublish(
  authored: AuthoredApp,
  staged: { cid: string; doc: StagedSchemaDoc }[],
  stamp: PublishStamp,
  existing: Record<string, unknown> | null,
): PublishedFace {
  const { app, config } = projectApp(authored, [], stamp, existing);
  const staging = stagedRuleConfig(staged);
  app.collections = staging.collections;
  app.participantRead = staging.participantRead;
  // Start from what deploy left, drop everything publish owns — an
  // authored-away key must DISAPPEAR, that is how an app stops being public —
  // then write this publish's values, with `public` held back for its own
  // final update.
  //
  // With no existing document there is nothing deploy left, so the projection
  // itself is the base: publishing into an app that does not exist yet must
  // still carry `aid` / `owner` / `members` / `memberEmails`, or the rules
  // refuse the create and the roster invariant cannot hold.
  const base = existing ?? app;
  const published = Object.fromEntries(Object.entries(base).filter(([key]) => !isPublishOwned(key)));
  for (const key of PUBLISH_OWNED_KEYS) {
    if (key !== "public" && app[key] !== undefined) published[key] = app[key];
  }
  const publicBlock = app.public;
  return { app: published, config, public: isRecord(publicBlock) ? publicBlock : undefined };
}

/** Re-stamp a staged schema document as it is promoted to `collections/{cid}`.
 *
 *  The stamp answers "which version is PUBLIC right now, and who made it so",
 *  so it is written by the operation that changes the answer — publish — not
 *  carried over from the deploy that staged it. */
export function promoteSchema(staged: StagedSchemaDoc, stamp: PublishStamp): PublishedSchemaDoc {
  const doc: PublishedSchemaDoc = { publishedSchema: staged.publishedSchema, publishedAt: stamp.publishedAt, publishedBy: stamp.email };
  if (stamp.commit !== undefined) doc.publishedCommit = stamp.commit;
  return doc;
}

/** One published schema document. Written key by key rather than through
 *  `compact`, so the declared type is the type — an optional commit is the
 *  only variable part. */
function schemaDoc(schema: CollectionSchema, stamp: PublishStamp): PublishedSchemaDoc {
  const doc: PublishedSchemaDoc = { publishedSchema: schema, publishedAt: stamp.publishedAt, publishedBy: stamp.email };
  if (stamp.commit !== undefined) doc.publishedCommit = stamp.commit;
  return doc;
}

/** The app documents' parent path — the `FirestoreDocs` seam takes a
 *  collection path plus a document id, and the app document's id is the aid. */
export const APPS_COLLECTION = "apps";
/** The collection (schema) documents' parent path — what the PUBLIC page
 *  reads, written only by publish (promotion). */
export const appSchemasPath = (aid: string): string => `apps/${aid}/collections`;
/** The URL-slug reservations — `appSlugs/{slug}` → `{ aid, published }`.
 *
 *  A TOP-LEVEL collection, not a field on the app: the public page resolves a
 *  slug to an aid BEFORE it can read anything under `apps/{aid}`, and a slug
 *  has to be claimable atomically (create-if-absent) so two apps cannot hold
 *  the same URL.
 *
 *  `published` is what makes the reservation invisible until publish. The slug
 *  is human-readable, so a readable reservation would let anyone guess the URL
 *  and get the aid — and the aid is the `/staging/{aid}` entrance. The rule is
 *  `allow read: if resource.data.published == true`, which needs no `get()` and
 *  so costs nothing against the rules' expression budget. */
export const APP_SLUGS_COLLECTION = "appSlugs";

/** The reservation document. Written by deploy as `{ aid, published: false }`
 *  and flipped by publish — never re-pointed at another aid, which the rules
 *  enforce on update. */
export interface AppSlugDoc extends Record<string, unknown> {
  aid: string;
  published: boolean;
}

export const appSlugDoc = (aid: string, published: boolean): AppSlugDoc => ({ aid, published });

/** The staged schema documents' parent path — what `/staging/{aid}` reads,
 *  written by deploy. A separate DOCUMENT rather than a field beside
 *  `publishedSchema`, because the rules cannot hide a field: anything inside a
 *  document the public page may read is public. */
export const appStagingPath = (aid: string): string => `apps/${aid}/staging`;
/** The public-config documents' parent path. */
export const appConfigPath = (aid: string): string => `apps/${aid}/config`;

/** Where one audience's pages live. `member` is read by anyone holding a role;
 *  `roster` by anyone on the roster, participants included. */
export const appViewTierPath = (aid: string, tier: "member" | "roster"): string => `apps/${aid}/${tier}`;

/** The document a tier's projection is published at. Beside the views
 *  themselves, under one `match` — see `firestore.rules`. */
export const viewConfigDocId = (stage: "live" | "staged"): string => viewDocId(stage, VIEW_CONFIG_ID);
