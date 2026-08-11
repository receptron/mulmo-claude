// What publish REFUSES, and why the refusal lives here rather than in a linter.
//
// A linter runs on the author's machine, when the author remembers to run it.
// Publish is the only gate every published byte passes through, so the
// guarantees are put here — the same argument the rules make for themselves
// against `require` in an action ("a linter is not a substitute for a rule").
//
// Two kinds of refusal, and the difference matters when reading this file:
//
//   SECURITY invariants — the declaration is internally consistent and the
//   rules will happily enforce it, but what it permits is not what the author
//   meant. `submitOnly` is the archetype: without it the rules do exactly as
//   told, and the owner can fabricate records in a collection whose entire
//   meaning is "the submitter said this".
//
//   FAIL-CLOSED traps — the rules will refuse EVERY write the declaration was
//   written to allow, and refuse it silently. `initialStatus` without a
//   `statusField` is not a weaker app, it is an app where nobody can submit
//   and nothing says why. These are worth as much as the security ones,
//   because a permission denial carries no explanation to the person hitting
//   it, and the author is not the person hitting it.
//
// Every check returns a LINE the author can act on, and every check has a test
// for the refusal AND a test for the neighbouring declaration that must still
// pass. A refusal test on its own is satisfied by a function that refuses
// everything, which is the one bug this file could have that would look like
// safety.

import type { AuthoredApp, AuthoredCollectionConfig, AuthoredSubmit } from "./publishManifest";

/** What publish knows about a shared collection in this repository, as far as
 *  these checks are concerned: its cid and the schema key its records are
 *  identified by. The whole schema is deliberately not threaded in — these
 *  checks are about the DECLARATION, and the primary key is the one part of
 *  the schema the declaration can contradict. */
export interface PublishableCollection {
  cid: string;
  primaryKey: string;
}

/** Does this submit declaration bind a record to the submitter's identity?
 *
 *  The condition for requiring `submitOnly`, and deliberately NOT "declares an
 *  `audience`": `audience` appears only in the rules' public-create branch, so
 *  an owner or editor never meets it and can add records freely. `immutable`
 *  is the wrong condition too — a survey's responses are not immutable and
 *  can be padded exactly the same way.
 *
 *  What these four have in common is that each one makes the record MEAN "the
 *  person who submitted it said this": a per-uid id, a per-uid+field id, a
 *  row stamped with the submitter's verified address, or a submission
 *  restricted to a named participant. A record created through the writer
 *  branch carries the same shape and none of that meaning. */
export function bindsSubmitterIdentity(submit: AuthoredSubmit): boolean {
  return submit.idFrom === "auth.uid" || submit.idFrom === "auth.uid+field" || submit.emailField !== undefined || submit.audience === "participant";
}

/** The fields a rule actually CHECKS the value of, for one collection.
 *
 *  `keyFields` pins a value against a declared set, `gateOn.match` pins it
 *  against the session's current question, and the status field is pinned by
 *  the transition machine. An aggregation grouped by anything else is grouped
 *  by a field any submitter may write anything into — so the published
 *  aggregate is whatever the noisiest respondent decided it should be. */
function checkedFields(collection: AuthoredCollectionConfig | undefined, submit: AuthoredSubmit | undefined): Set<string> {
  const fields = new Set<string>();
  for (const keyField of submit?.validate?.keyFields ?? []) fields.add(keyField.field);
  if (submit?.gateOn) fields.add(submit.gateOn.match);
  if (collection?.statusField) fields.add(collection.statusField);
  return fields;
}

/** INVARIANT 1 — a submission bound to its submitter needs `submitOnly`. */
function submitOnlyProblems(app: AuthoredApp): string[] {
  const problems: string[] = [];
  for (const [cid, submit] of Object.entries(app.public?.submit ?? {})) {
    if (!bindsSubmitterIdentity(submit)) continue;
    if (app.collections?.[cid]?.submitOnly === true) continue;
    problems.push(
      `collections.${cid}.submitOnly must be true: public.submit.${cid} binds each record to its submitter ` +
        `(${identityBindings(submit).join(", ")}), so a record created any other way would carry that meaning without having earned it. ` +
        `Without submitOnly the rules let an owner or editor write rows directly into ${cid}.`,
    );
  }
  return problems;
}

function identityBindings(submit: AuthoredSubmit): string[] {
  const bindings: string[] = [];
  if (submit.idFrom === "auth.uid" || submit.idFrom === "auth.uid+field") bindings.push(`idFrom: "${submit.idFrom}"`);
  if (submit.emailField !== undefined) bindings.push(`emailField: "${submit.emailField}"`);
  if (submit.audience === "participant") bindings.push(`audience: "participant"`);
  return bindings;
}

/** INVARIANT 2 — every aggregation key is a field some rule checks. */
function aggregateProblems(app: AuthoredApp): string[] {
  const problems: string[] = [];
  for (const [cid, collection] of Object.entries(app.collections ?? {})) {
    const keys = collection.aggregate?.by;
    if (!keys) continue;
    const checked = checkedFields(collection, app.public?.submit?.[cid]);
    const loose = keys.filter((field) => !checked.has(field));
    const spelled = loose.map((field) => `'${field}'`).join(", ");
    if (loose.length > 0) {
      problems.push(
        `collections.${cid}.aggregate.by names ${spelled}, which no rule checks the value of. ` +
          `An aggregation key must appear in public.submit.${cid}.validate.keyFields, in gateOn.match, or be the statusField — ` +
          `otherwise a submitter chooses their own bucket and the published aggregate is not a count of anything.`,
      );
    }
  }
  return problems;
}

/** INVARIANT 3 — `auth: "verifiedEmail"` only.
 *
 *  A product decision, not a rules limitation: the rules keep all three stages
 *  and the emulator tests keep exercising them, because deleting a stage from
 *  the rules turns a change of mind into a cross-repo deploy. Publish is where
 *  the current decision is expressed, and it is one line to move. */
function authProblems(app: AuthoredApp): string[] {
  return Object.entries(app.public?.submit ?? {})
    .filter(([, submit]) => submit.auth !== "verifiedEmail")
    .map(
      ([cid, submit]) =>
        `public.submit.${cid}.auth is "${submit.auth}": only "verifiedEmail" may be published. ` +
        `The rules still implement "none" and "anonymous" — this is a product decision, and lifting it is a change here, not a rules deploy.`,
    );
}

/** INVARIANT 5 — a mail transition's origins and destination must be disjoint.
 *
 *  Overlap means the same write can satisfy the same template twice over, and
 *  the deterministic mail id is the only other thing stopping a duplicate
 *  send. The rules also require the status to have CHANGED, so an overlapping
 *  declaration is not merely redundant: `from` containing `to` is a transition
 *  that can never fire, which is a mail nobody ever receives. */
function mailProblems(app: AuthoredApp): string[] {
  return Object.entries(app.collections ?? {}).flatMap(([cid, collection]) => collectionMailProblems(cid, collection));
}

function collectionMailProblems(cid: string, collection: AuthoredCollectionConfig): string[] {
  const { mail } = collection;
  if (!mail) return [];
  const problems: string[] = [];
  if (!collection.statusField) {
    problems.push(
      `collections.${cid}.mail needs collections.${cid}.statusField: the rules read the status before and after the write to decide the mail is warranted.`,
    );
  }
  for (const [template, transition] of Object.entries(mail.on)) {
    problems.push(...templateMailProblems(cid, collection, template, transition));
  }
  return problems;
}

function templateMailProblems(cid: string, collection: AuthoredCollectionConfig, template: string, transition: { from: string[]; to: string }): string[] {
  const problems: string[] = [];
  if (transition.from.includes(transition.to)) {
    problems.push(
      `collections.${cid}.mail.on.${template} lists "${transition.to}" in both \`from\` and \`to\`. ` +
        "The rules require the status to CHANGE in the same write, so this template can never send.",
    );
  }
  const allowed = collection.transitions;
  if (allowed) {
    const unreachable = transition.from.filter((from) => !(allowed[from] ?? []).includes(transition.to));
    const spelled = unreachable.map((from) => `'${from}' -> '${transition.to}'`).join(", ");
    if (unreachable.length > 0) {
      problems.push(
        `collections.${cid}.mail.on.${template} sends on ${spelled}, ` +
          `which collections.${cid}.transitions does not allow. The record write is refused first, so the mail never fires.`,
      );
    }
  }
  return problems;
}

/** INVARIANTS 6 and 7 — the window is a real interval, and `keyFields` fits
 *  the unrolled check in the rules. */
function submitShapeProblems(app: AuthoredApp): string[] {
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => [...windowProblems(cid, submit), ...keyFieldCountProblems(cid, submit)]);
}

function windowProblems(cid: string, submit: AuthoredSubmit): string[] {
  const { window } = submit;
  if (window?.from === undefined || window.until === undefined) return [];
  if (Date.parse(window.until) > Date.parse(window.from)) return [];
  return [`public.submit.${cid}.window closes at or before it opens (${window.from} -> ${window.until}): nothing could ever be submitted.`];
}

function keyFieldCountProblems(cid: string, submit: AuthoredSubmit): string[] {
  const keyFields = submit.validate?.keyFields ?? [];
  if (keyFields.length <= 2) return [];
  return [
    `public.submit.${cid}.validate.keyFields declares ${keyFields.length}; the rules check at most 2. ` +
      "Rules have no iteration, so the check is unrolled — a third would be published and never enforced.",
  ];
}

/** The fail-closed traps: declarations the rules read together, where the
 *  missing half denies every write instead of loosening one. */
function coherenceProblems(app: AuthoredApp): string[] {
  const fromSubmits = Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => submitCoherenceProblems(app, cid, submit));
  const fromCollections = Object.entries(app.collections ?? {}).flatMap(([cid, collection]) => gateCoherenceProblems(cid, collection));
  return [...fromSubmits, ...fromCollections];
}

/** `initialStatus` is read together with the collection's `statusField` and
 *  with `createFields`; miss either and every submission is refused. */
function statusCoherenceProblems(cid: string, submit: AuthoredSubmit, collection: AuthoredCollectionConfig | undefined): string[] {
  if (submit.initialStatus === undefined) return [];
  if (!collection?.statusField) {
    return [
      `public.submit.${cid}.initialStatus needs collections.${cid}.statusField: the rules look the status up by that name, and refuse every submission without it.`,
    ];
  }
  if (new Set(submit.createFields).has(collection.statusField)) return [];
  return [
    `public.submit.${cid}.createFields must include "${collection.statusField}": a submission may carry ONLY the createFields, ` +
      "and the rules also require the status field to be present and equal to initialStatus. As written, every submission is refused.",
  ];
}

/** Every field a RULE reads off a submitted record, other than the status
 *  field (which `statusCoherenceProblems` words for itself).
 *
 *  `emailField` and `idField` belong here for exactly the reason `required`
 *  and `keyFields` do, and forgetting them was the same oversight twice: the
 *  rules read `request.resource.data[s.emailField]` and rebuild the document
 *  id from `s.idField`, while `hasOnly(createFields)` decides what a
 *  submission may carry at all. A field in one list and not the other is a
 *  contradiction the submitter cannot resolve — including it is refused,
 *  omitting it fails the check. */
function ruleReadFields(submit: AuthoredSubmit): { field: string; why: string }[] {
  const fields: { field: string; why: string }[] = [];
  if (submit.emailField !== undefined) {
    fields.push({ field: submit.emailField, why: `public.submit.<cid>.emailField — the rules compare it to the submitter's verified address` });
  }
  if (submit.idFrom === "auth.uid+field" && submit.idField !== undefined) {
    fields.push({ field: submit.idField, why: `public.submit.<cid>.idField — the rules rebuild the document id from it` });
  }
  return fields;
}

/** A checked field a submission is not allowed to carry can never be
 *  satisfied: carrying it fails `hasOnly`, omitting it fails the check. */
function createFieldProblems(cid: string, submit: AuthoredSubmit): string[] {
  const createFields = new Set(submit.createFields);
  const ruleRead = ruleReadFields(submit)
    .filter((entry) => !createFields.has(entry.field))
    .map(
      (entry) =>
        `public.submit.${cid}.createFields must include "${entry.field}" (${entry.why.replace("<cid>", cid)}): ` +
        "a submission may carry only the createFields, so as written every submission is refused whether or not it carries the field.",
    );
  const required = (submit.validate?.required ?? [])
    .filter((field) => !createFields.has(field))
    .map(
      (field) =>
        `public.submit.${cid}.validate.required names "${field}", which is not in createFields: a submission may carry only the createFields, so the requirement can never be met.`,
    );
  const keyFields = (submit.validate?.keyFields ?? [])
    .filter((keyField) => !createFields.has(keyField.field))
    .map(
      (keyField) =>
        `public.submit.${cid}.validate.keyFields checks "${keyField.field}", which is not in createFields: a submission carrying it is refused, and one omitting it fails the check.`,
    );
  return [...ruleRead, ...required, ...keyFields];
}

function submitCoherenceProblems(app: AuthoredApp, cid: string, submit: AuthoredSubmit): string[] {
  const collection = app.collections?.[cid];
  const problems = [...statusCoherenceProblems(cid, submit, collection), ...createFieldProblems(cid, submit)];
  if (submit.idFrom === "auth.uid+field" && submit.idField === undefined) {
    problems.push(
      `public.submit.${cid}.idFrom is "auth.uid+field" but no idField is declared: the rules rebuild the document id from that field and refuse every create.`,
    );
  }
  if ((submit.selfUpdate !== undefined || submit.selfTransitions !== undefined) && !collection?.statusField) {
    problems.push(
      `public.submit.${cid}.selfUpdate / selfTransitions are declared per CURRENT STATUS, but collections.${cid} declares no statusField: ` +
        "the rules read the current status first and refuse every self-edit without it.",
    );
  }
  if (submit.audience === "participant" && Object.keys(app.members).length === 0) {
    problems.push(
      `public.submit.${cid}.audience is "participant" but the roster is empty: the rules resolve the submitter's role from members, so every submission is refused.`,
    );
  }
  return problems;
}

/** The staged reveal reads its flag off the PARENT record, so the path to that
 *  parent is not optional decoration — without it the gate never opens. */
function gateCoherenceProblems(cid: string, collection: AuthoredCollectionConfig): string[] {
  if (collection.revealGated !== true) return [];
  if (collection.gatedFrom !== undefined && collection.revealBy !== undefined) return [];
  return [
    `collections.${cid}.revealGated needs both gatedFrom and revealBy: the flag is read off the PARENT record, and without the path the gate never opens.`,
  ];
}

/** The publisher must be able to write what they are about to write.
 *
 *  On a first publish the rules require the creator to name themselves owner,
 *  in the roster, under `'*'`. Getting this wrong produces a bare permission
 *  error from Firestore with nothing in it about rosters — worth one line
 *  here instead. */
function publisherProblems(app: AuthoredApp, publisherEmail: string): string[] {
  const roles = app.members[publisherEmail];
  if (roles?.["*"] === "owner") return [];
  return [
    `members must give you app-wide owner: add "${publisherEmail}": { "*": "owner" }. ` +
      `The rules require the publisher to hold that role (and to name themselves owner when the app is first created); otherwise the write is refused with no explanation.`,
  ];
}

/** Every cid the declaration mentions must be a collection that exists.
 *
 *  A typo'd cid is not an error anywhere else: the app document simply carries
 *  a configuration for a collection nobody publishes, and the collection the
 *  author meant is published with no configuration at all — i.e. with the
 *  status machine and the submit path silently absent. */
function unknownCidProblems(app: AuthoredApp, collections: readonly PublishableCollection[]): string[] {
  const known = new Set(collections.map((collection) => collection.cid));
  const mentions: [string, string[]][] = [
    ["collections", Object.keys(app.collections ?? {})],
    ["public.read", app.public?.read ?? []],
    ["public.submit", Object.keys(app.public?.submit ?? {})],
    ["participantRead", app.participantRead ?? []],
  ];
  return mentions.flatMap(([where, cids]) =>
    cids
      .filter((cid) => !known.has(cid))
      .map(
        (cid) =>
          `${where} names '${cid}', which is not a shared collection in this repository. ` +
          `Shared collections here: ${known.size > 0 ? [...known].sort().join(", ") : '(none - a schema needs storage.type "firestore")'}.`,
      ),
  );
}

/** Everything publish refuses, as lines the author can act on.
 *
 *  All of them, every time. Publish is a manual step with a human waiting on
 *  it; stopping at the first problem turns one review into five. */
export function publishProblems(app: AuthoredApp, collections: readonly PublishableCollection[], publisherEmail: string): string[] {
  return [
    ...unknownCidProblems(app, collections),
    ...publisherProblems(app, publisherEmail),
    ...submitOnlyProblems(app),
    ...aggregateProblems(app),
    ...authProblems(app),
    ...mailProblems(app),
    ...submitShapeProblems(app),
    ...coherenceProblems(app),
    ...primaryKeyProblems(app, collections),
  ];
}

/** A public submission must NOT be allowed to name its own primary key.
 *
 *  The rules constrain the DOCUMENT ID (`idFrom`) and cannot constrain the
 *  value of a field — nothing compares `request.resource.data[primaryKey]`
 *  with the path being written. So a submit path that accepts the primary key
 *  as a `createField` lets a submitter write at their one permitted document
 *  id while CLAIMING another record's identity, or a duplicate.
 *
 *  It is refused rather than tolerated because there is nothing for the field
 *  to do: `firestoreStore` takes a shared record's identity from the document
 *  id and overwrites the field on read, so a submitted value is either equal
 *  to the id (noise) or a lie (silently discarded). Publishing a form field
 *  whose value is thrown away is worse than not having it — the author will
 *  believe submitters choose their ids.
 *
 *  This is the second answer to the same question. The first was the reverse —
 *  REQUIRE the key, because a record without one was rejected by every reader
 *  — and it was right about the symptom and wrong about the cure: the identity
 *  belongs to the id the rules can pin, not to a field they cannot. */
function primaryKeyProblems(app: AuthoredApp, collections: readonly PublishableCollection[]): string[] {
  const primaryKeyOf = new Map(collections.map((collection) => [collection.cid, collection.primaryKey]));
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => {
    const primaryKey = primaryKeyOf.get(cid);
    if (primaryKey === undefined || !submit.createFields.includes(primaryKey)) return [];
    return [
      `public.submit.${cid}.createFields must NOT include "${primaryKey}", the schema's primaryKey: the rules can pin the document id but not the value of a field, ` +
        "so a submitter could write at their own id while claiming another record's. A shared record's identity is its document id — the store fills the field from it, " +
        "and a submitted value is either the same thing or a lie that is thrown away.",
    ];
  });
}
