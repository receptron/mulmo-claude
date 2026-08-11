// The AUTHORED app declaration — everything in `<root>/app.json` that is not
// `aid`.
//
// WHY THIS IS NOT IN `appManifest.ts`. That module reads ONE field, and its
// header says why: every key added there is a key `publish` and the discovery
// loader could disagree about. Discovery needs to know which app a collection
// belongs to; it has no business knowing who is on the roster. So the roster
// and the public config are read HERE, by the only thing that consumes them.
// `aid` is still read through `parseAppManifest` — one parse of one field, not
// a second opinion about it.
//
// AUTHORED, NOT PUBLISHED. What this module produces is the shape a human
// wrote. The Firestore document is derived from it by `publishProject.ts`
// (epoch-millis windows, a derived `memberEmails`, publisher stamps). The two
// are deliberately different and the difference is written down in exactly one
// place — see that module's header.
//
// WHERE `collections[cid]` COMES FROM. From this file, authored by hand, as the
// samples in `mulmoterminal plans/feat-shareable-collections.md` (S1-S4) write
// it. The design note also describes deriving it from each collection's
// `schema.json` (`actions[].then.email` → `mail`, `require`/`set` →
// `transitions`), and that remains the intent — but the schema keys it would
// read DO NOT EXIST yet: `schemaZ.ts` has `require` and `set` and no `then`,
// no `immutable`, no `peerVisibility`, no `submitOnly`. Adding them is
// blocked behind the `.strict()` decision (implementation order 10), because
// today an unknown key is stripped per-variant and would vanish silently.
// Deriving from a source that cannot hold the declaration would mean inventing
// the source first. So: authored here, projected and CHECKED by publish, and
// when the schema can hold it the derivation replaces this arm rather than
// joining it.
//
// STRICT ON PURPOSE. Unlike `schemaZ`, this parser refuses unknown keys. The
// failure mode it prevents is the one the design note keeps warning about: a
// misspelled declaration key is not a broken app, it is a SILENTLY PERMISSIVE
// one — `submitOnl: true` publishes a collection anyone may write to, with
// nothing red anywhere. A schema key that vanishes costs a feature; a
// declaration key that vanishes costs the guarantee.

import { z } from "zod";
import { isValidCollectionName } from "../core/collectionKey";
import { parseAppManifest, type AppManifestResult } from "./appManifest";

/** A collection id / app id, held to the one name rule (`SAFE_SLUG_PATTERN`)
 *  that `sharedCollectionKey` applies. Stated once so a path built later
 *  cannot be a way around it. */
const NameZ = z.string().refine(isValidCollectionName, { message: "is not a valid id (letters, digits, '-' and '_' only)" });

/** An address on the roster. Not validated as an email beyond "has an @":
 *  the rules compare it to `request.auth.token.email` verbatim, so any
 *  narrowing here would refuse addresses Firebase itself accepts. */
const EmailZ = z.string().trim().min(3).includes("@");

/** The four roles the deployed rules understand. `participant` is the layer
 *  that is NAMED but reads only its own rows — see `readerOf` vs `listedIn`. */
export const APP_ROLES = ["owner", "editor", "viewer", "participant"] as const;
const RoleZ = z.enum(APP_ROLES);

/** `{ email: { "*" | cid: role } }`. The `"*"` key is the app-wide role; a
 *  member may hold per-collection roles only (the stylist who is editor of
 *  bookings and viewer of everything else). */
const MembersZ = z.record(EmailZ, z.record(z.union([z.literal("*"), NameZ]), RoleZ));

/** The declarative mail queue, as the rules re-derive it: a transition of the
 *  status field, a recipient read off the RECORD, and a fixed template. */
const MailZ = z
  .object({
    toField: z.string().trim().min(1),
    on: z.record(z.string().trim().min(1), z.object({ from: z.array(z.string().trim().min(1)).min(1), to: z.string().trim().min(1) }).strict()),
    dataFields: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

/** What the rules read out of `collections[cid]`. NOT the schema — the schema
 *  is published beside it, untouched, for clients to render from. */
const CollectionConfigZ = z
  .object({
    statusField: z.string().trim().min(1).optional(),
    /** `{ initial: [...], <status>: [<status>...] }`. Binds writers too, and
     *  binds `create` — that is the point of publishing it. */
    transitions: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))).optional(),
    immutable: z.boolean().optional(),
    submitOnly: z.boolean().optional(),
    peerVisibility: z.enum(["public", "hidden"]).optional(),
    revealGated: z.boolean().optional(),
    gatedFrom: NameZ.optional(),
    revealBy: z.string().trim().min(1).optional(),
    mail: MailZ.optional(),
    /** Which fields an aggregate groups by. Declared here rather than in the
     *  schema for the same reason as everything else in this file — the schema
     *  has no `aggregate` key yet — and it is here at all because the
     *  invariant that guards it ("every aggregation key is a CHECKED field")
     *  is about `public.submit`, which is an app-level declaration. Published
     *  as-is; the rules never read it. */
    aggregate: z
      .object({ by: z.array(z.string().trim().min(1)).min(1) })
      .strict()
      .optional(),
  })
  .strict();

/** An authored submit window. ISO strings, because `app.json` is JSON and a
 *  Firestore `Timestamp` has no JSON form. Publish lowers it to epoch millis —
 *  the rules do not coerce strings, so an ISO string reaching Firestore is a
 *  type error that fails CLOSED (`inWindow` refuses every submission and the
 *  author sees "nobody can submit", not an error). */
const WindowZ = z.object({ from: z.iso.datetime().optional(), until: z.iso.datetime().optional() }).strict();

const ValidateZ = z
  .object({
    required: z.array(z.string().trim().min(1)).optional(),
    /** Capped at two by the rules themselves: rules have no iteration, so
     *  `keyFieldsOk` is unrolled. A third would be accepted here and silently
     *  unchecked there. */
    keyFields: z
      .array(z.object({ field: z.string().trim().min(1), values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1) }).strict())
      .optional(),
  })
  .strict();

const SubmitZ = z
  .object({
    auth: z.enum(["none", "anonymous", "verifiedEmail"]),
    emailField: z.string().trim().min(1).optional(),
    /** The fields a submission may carry — and it may carry NONE.
     *
     *  An empty list is the identity-only submission: a record whose whole
     *  content is the fact that it exists at its id ("I attended", "I voted",
     *  a per-uid marker). The rules read it as `keys().hasOnly([])`, which
     *  admits exactly the empty document.
     *
     *  It is expressible only because the primary key is NOT a create field:
     *  the identity is the document id, which `idFrom` pins and the store
     *  fills in on read. Requiring at least one field here would have made
     *  that shape undeclarable — the only field it wants is the one publish
     *  refuses. */
    createFields: z.array(z.string().trim().min(1)),
    initialStatus: z.string().trim().min(1).optional(),
    idFrom: z.enum(["auto", "auth.uid", "auth.uid+field"]).optional(),
    idField: z.string().trim().min(1).optional(),
    validate: ValidateZ.optional(),
    window: WindowZ.optional(),
    /** Per CURRENT STATUS, never a flat list: a flat list lets a customer move
     *  an approved booking's `startAt` without anyone re-approving it. */
    selfUpdate: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))).optional(),
    selfTransitions: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))).optional(),
    finalize: z.boolean().optional(),
    audience: z.literal("participant").optional(),
    gateOn: z
      .object({ phase: z.string().trim().min(1), match: z.string().trim().min(1) })
      .strict()
      .optional(),
  })
  .strict();

const PublicZ = z
  .object({
    /** The master switch. Anonymous submission (`auth: "none"`) needs it as
     *  well as its own declaration. */
    enabled: z.boolean().optional(),
    read: z.array(NameZ).optional(),
    submit: z.record(NameZ, SubmitZ).optional(),
  })
  .strict();

/** The whole authored declaration.
 *
 *  `owner` is accepted but is NOT the published value — publish stamps the
 *  publisher's uid (or carries the existing one forward, which is what the
 *  rules require on update) and refuses a declaration that disagrees. It is
 *  accepted rather than banned because the sample app.json in the design note
 *  shows it, and a hard refusal on a key the samples contain would be a worse
 *  first experience than a message naming the mismatch. */
export const AuthoredAppZ = z
  .object({
    aid: NameZ,
    name: z.string().trim().min(1).optional(),
    /** Per-worktree app id (design D6, implementation order 7). Accepted so a
     *  repository already carrying it parses; nothing reads it yet. */
    aidEnv: z.string().trim().min(1).optional(),
    owner: z.string().trim().min(1).optional(),
    members: MembersZ,
    collections: z.record(NameZ, CollectionConfigZ).optional(),
    participantRead: z.array(NameZ).optional(),
    public: PublicZ.optional(),
  })
  .strict();

export type AuthoredApp = z.infer<typeof AuthoredAppZ>;
export type AuthoredCollectionConfig = z.infer<typeof CollectionConfigZ>;
export type AuthoredSubmit = z.infer<typeof SubmitZ>;
export type AuthoredMail = z.infer<typeof MailZ>;

export type AuthoredAppResult = { ok: true; app: AuthoredApp } | { ok: false; problems: string[] };

/** Parse the authored declaration out of `app.json`'s text.
 *
 *  Returns a LIST of problems rather than throwing, for the same reason
 *  `loadAppManifest` returns a failure: the caller is a gate whose entire job
 *  is to hand the author something to act on. Every problem is reported at
 *  once — publish is a manual step, and a parser that stops at the first key
 *  makes it N round trips. */
export function parseAuthoredApp(raw: string): AuthoredAppResult {
  // Reuse the one-field parse so `aid`'s rule has a single statement, and so a
  // file that is not even JSON says so in the same words discovery uses.
  const manifest: AppManifestResult = parseAppManifest(raw);
  if (!manifest.ok) return { ok: false, problems: [manifest.kind === "missing" ? "app.json is missing" : manifest.detail] };
  const parsed = AuthoredAppZ.safeParse(JSON.parse(raw));
  if (!parsed.success) return { ok: false, problems: authoredProblems(parsed.error) };
  return { ok: true, app: parsed.data };
}

/** zod issues as one actionable line each: `public.submit.responses.auth: …`. */
export function authoredProblems(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join(".") : "app.json";
    return `${where}: ${issue.message}`;
  });
}
