// What publish refuses — and, for every refusal, the neighbouring declaration
// it must still accept.
//
// The pairing is the point. A file of refusal assertions is satisfied by
// `publishProblems = () => ["no"]`, and an implementation that refuses
// everything looks exactly like a safe one from inside its own test suite. So
// each case below states the accepted form first or immediately after.

import { test } from "node:test";
import assert from "node:assert/strict";

import { AuthoredAppZ } from "../../src/collection/server/publishManifest";
import { publishProblems } from "../../src/collection/server/publishChecks";

const OWNER = "owner@salon.jp";
/** The repository's shared collections, as publish sees them: a cid and the
 *  schema key its records are identified by. `id` throughout, which is why
 *  `id` throughout, and NO submit fixture below names it in createFields: a
 *  shared record's identity is its document id, and a submitter that could
 *  name its own would be claiming an identity the rules cannot check. */
const CIDS = [
  { cid: "bookings", primaryKey: "id" },
  { cid: "responses", primaryKey: "id" },
  { cid: "services", primaryKey: "id" },
  { cid: "answers", primaryKey: "id" },
];

/** Build + parse a declaration through the real zod schema, so no fixture can
 *  assert about a shape publish would have rejected before it got this far. */
function app(overrides: Record<string, unknown>) {
  return AuthoredAppZ.parse({ aid: "app_test", members: { [OWNER]: { "*": "owner" } }, ...overrides });
}

const problemsFor = (overrides: Record<string, unknown>, cids: readonly { cid: string; primaryKey: string }[] = CIDS) =>
  publishProblems(app(overrides), cids, OWNER);

/** Assert exactly which check fired, by a distinctive fragment of its line —
 *  not merely that SOMETHING was refused, which would pass on an unrelated
 *  failure and hide the check under test being dead. */
function listed(fragment: string, problems: string[]): string {
  const bullets = problems.map((problem) => `  - ${problem}`).join("\n");
  return `expected a problem mentioning ${JSON.stringify(fragment)}, got:\n${bullets || "  (none)"}`;
}

function refuses(problems: string[], fragment: string): void {
  assert.ok(
    problems.some((problem) => problem.includes(fragment)),
    listed(fragment, problems),
  );
}

// --- invariant 1: submitOnly ------------------------------------------------

const IDENTITY_BOUND: Record<string, unknown>[] = [
  { auth: "verifiedEmail", createFields: ["a"], idFrom: "auth.uid" },
  { auth: "verifiedEmail", createFields: ["a", "who"], idFrom: "auth.uid+field", idField: "who" },
  { auth: "verifiedEmail", createFields: ["a", "email"], emailField: "email" },
  { auth: "verifiedEmail", createFields: ["a"], audience: "participant" },
];

test("a submission bound to its submitter must declare submitOnly", () => {
  // Each of the four bindings makes the record MEAN "the submitter said this".
  // The writer branch of `allow create` never meets any of them, so without
  // submitOnly an owner or editor can manufacture the same rows.
  for (const submit of IDENTITY_BOUND) {
    const problems = problemsFor({ public: { submit: { responses: submit } }, collections: { responses: {} } });
    refuses(problems, "collections.responses.submitOnly must be true");
  }
});

test("declaring submitOnly satisfies it", () => {
  for (const submit of IDENTITY_BOUND) {
    const problems = problemsFor({ public: { submit: { responses: submit } }, collections: { responses: { submitOnly: true } } });
    assert.deepEqual(problems, [], `must accept ${JSON.stringify(submit)}`);
  }
});

test("a submission NOT bound to its submitter must not be forced to submitOnly", () => {
  // The counter-case that keeps the rule from being "always require it": S1's
  // ledger-style booking form, where staff enter records on a customer's
  // behalf. Requiring submitOnly there would break the feature.
  const problems = problemsFor({
    public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["customerName"], idFrom: "auto" } } },
    collections: { bookings: {} },
  });
  assert.deepEqual(problems, []);
});

test("immutable is not the condition — a mutable survey is padded the same way", () => {
  // `immutable` was the tempting condition and it is wrong: S2's responses are
  // not immutable and can be inflated exactly as a vote can.
  const problems = problemsFor({
    public: { submit: { responses: { auth: "verifiedEmail", createFields: ["q1"], idFrom: "auth.uid" } } },
    collections: { responses: { immutable: false } },
  });
  refuses(problems, "submitOnly must be true");
});

// --- invariant 2: aggregation keys -----------------------------------------

test("an aggregation key no rule checks is refused, and a checked one is not", () => {
  const loose = problemsFor({
    collections: { responses: { submitOnly: true, aggregate: { by: ["q1"] } } },
    public: { submit: { responses: { auth: "verifiedEmail", createFields: ["q1"], idFrom: "auth.uid" } } },
  });
  refuses(loose, "aggregate.by names 'q1'");

  const checked = problemsFor({
    collections: { responses: { submitOnly: true, aggregate: { by: ["q1"] } } },
    public: {
      submit: {
        responses: { auth: "verifiedEmail", createFields: ["q1"], idFrom: "auth.uid", validate: { keyFields: [{ field: "q1", values: ["a", "b"] }] } },
      },
    },
  });
  assert.deepEqual(checked, []);
});

test("the status field and gateOn.match also count as checked", () => {
  // The transition machine pins the status; the session gate pins the match
  // field. Both are checked by a rule, so both are legitimate group-by keys.
  const byStatus = problemsFor({ collections: { responses: { statusField: "status", aggregate: { by: ["status"] } } } });
  assert.deepEqual(byStatus, []);

  const byGate = problemsFor({
    collections: { answers: { submitOnly: true, aggregate: { by: ["questionId"] } } },
    public: {
      submit: { answers: { auth: "verifiedEmail", createFields: ["questionId"], idFrom: "auth.uid", gateOn: { phase: "open", match: "questionId" } } },
    },
  });
  assert.deepEqual(byGate, []);
});

// --- invariant 3: auth stage ------------------------------------------------

test("only verifiedEmail may be published, and the rules keep the other two", () => {
  for (const auth of ["none", "anonymous"]) {
    refuses(problemsFor({ public: { submit: { bookings: { auth, createFields: ["a"] } } } }), `public.submit.bookings.auth is "${auth}"`);
  }
  assert.deepEqual(problemsFor({ public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a"] } } } }), []);
});

// --- invariant 4: names -----------------------------------------------------

test("a cid the repository does not have is refused rather than published as dead config", () => {
  // Nothing else notices this: the app document simply configures a collection
  // nobody publishes, and the collection that WAS meant goes out with no
  // status machine and no submit path.
  refuses(problemsFor({ collections: { bookingz: {} } }), "collections names 'bookingz'");
  refuses(problemsFor({ public: { read: ["servicez"] } }), "public.read names 'servicez'");
  refuses(problemsFor({ participantRead: ["nope"] }), "participantRead names 'nope'");
  assert.deepEqual(problemsFor({ collections: { bookings: {} }, public: { read: ["services"] }, participantRead: ["services"] }), []);
});

test("a name that no downstream encoding could carry is refused by the parser itself", () => {
  // The rule is `isValidCollectionName`, stated once. A second rule here is how
  // the layers come to disagree.
  assert.throws(() => app({ collections: { "book/ings": {} } }));
});

// --- invariant 5: mail ------------------------------------------------------

const MAIL_BASE = {
  statusField: "status",
  transitions: { initial: ["pending"], pending: ["approved", "rejected"], approved: [], rejected: [] },
};

test("a mail transition whose from includes its to can never send", () => {
  refuses(
    problemsFor({
      collections: {
        bookings: { ...MAIL_BASE, mail: { toField: "customerEmail", on: { "booking-approved": { from: ["pending", "approved"], to: "approved" } } } },
      },
    }),
    'lists "approved" in both',
  );
  assert.deepEqual(
    problemsFor({
      collections: { bookings: { ...MAIL_BASE, mail: { toField: "customerEmail", on: { "booking-approved": { from: ["pending"], to: "approved" } } } } },
    }),
    [],
  );
});

test("a mail transition the state machine forbids is refused", () => {
  // The record write is denied first, so the mail simply never fires — a
  // feature that is silently absent rather than broken.
  refuses(
    problemsFor({
      collections: { bookings: { ...MAIL_BASE, mail: { toField: "e", on: { t: { from: ["approved"], to: "rejected" } } } } },
    }),
    "which collections.bookings.transitions does not allow",
  );
});

test("mail needs a statusField, because the rules read the status either side of the write", () => {
  refuses(
    problemsFor({ collections: { bookings: { mail: { toField: "e", on: { t: { from: ["a"], to: "b" } } } } } }),
    "mail needs collections.bookings.statusField",
  );
});

// --- invariants 6 and 7: window and keyFields -------------------------------

test("a window that closes before it opens is refused; a real interval is not", () => {
  refuses(
    problemsFor({
      public: {
        submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], window: { from: "2026-09-30T00:00:00Z", until: "2026-09-01T00:00:00Z" } } },
      },
    }),
    "closes at or before it opens",
  );
  assert.deepEqual(
    problemsFor({
      public: {
        submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], window: { from: "2026-09-01T00:00:00Z", until: "2026-09-30T00:00:00Z" } } },
      },
    }),
    [],
  );
});

test("keyFields is capped at two, because the rules unroll the check", () => {
  const keyFields = (count: number) => Array.from({ length: count }, (_unused, index) => ({ field: `f${index}`, values: ["x"] }));
  const submitWith = (count: number) => ({
    auth: "verifiedEmail",
    createFields: [...keyFields(count).map((keyField) => keyField.field)],
    validate: { keyFields: keyFields(count) },
  });
  refuses(problemsFor({ public: { submit: { bookings: submitWith(3) } } }), "the rules check at most 2");
  assert.deepEqual(problemsFor({ public: { submit: { bookings: submitWith(2) } } }), []);
});

// --- the fail-closed traps --------------------------------------------------

test("initialStatus without a statusField would deny every submission", () => {
  refuses(
    problemsFor({
      collections: { bookings: {} },
      public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], initialStatus: "pending" } } },
    }),
    "initialStatus needs collections.bookings.statusField",
  );
});

test("the status field must be one of the createFields a submission may carry", () => {
  // `hasOnly(createFields)` and "the status must equal initialStatus" are both
  // required by the same rule. Omit the field from createFields and the two
  // cannot be satisfied at once — every submission is refused, silently.
  refuses(
    problemsFor({
      collections: { bookings: { statusField: "status" } },
      public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], initialStatus: "pending" } } },
    }),
    'createFields must include "status"',
  );
  assert.deepEqual(
    problemsFor({
      collections: { bookings: { statusField: "status" } },
      public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a", "status"], initialStatus: "pending" } } },
    }),
    [],
  );
});

test("a required or key-checked field outside createFields can never be satisfied", () => {
  refuses(
    problemsFor({ public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], validate: { required: ["b"] } } } } }),
    'validate.required names "b"',
  );
  refuses(
    problemsFor({
      public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], validate: { keyFields: [{ field: "b", values: ["x"] }] } } } },
    }),
    'validate.keyFields checks "b"',
  );
});

test("auth.uid+field without an idField denies every create", () => {
  refuses(
    problemsFor({
      collections: { responses: { submitOnly: true } },
      public: { submit: { responses: { auth: "verifiedEmail", createFields: ["a"], idFrom: "auth.uid+field" } } },
    }),
    "no idField is declared",
  );
});

test("selfUpdate without a statusField denies every self-edit", () => {
  // `selfUpdate` is declared per CURRENT STATUS; with no status field the
  // rules read null and refuse before looking at the field list.
  refuses(
    problemsFor({
      collections: { bookings: {} },
      public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["a"], selfUpdate: { pending: ["a"] } } } },
    }),
    "declares no statusField",
  );
});

test("revealGated needs the parent it reads the flag off", () => {
  refuses(problemsFor({ collections: { answers: { revealGated: true } } }), "revealGated needs both gatedFrom and revealBy");
  assert.deepEqual(problemsFor({ collections: { answers: { revealGated: true, gatedFrom: "responses", revealBy: "revealed" } } }), []);
});

test("a submit path that lets the submitter name its own primaryKey is refused", () => {
  // The rules pin the DOCUMENT ID (`idFrom`) and cannot pin the value of a
  // field. Accept the primary key as a createField and a submitter can write
  // at their one permitted id while claiming another record's identity.
  refuses(
    problemsFor({ public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["id", "customerName"] } } } }),
    'createFields must NOT include "id", the schema\'s primaryKey',
  );
  assert.deepEqual(problemsFor({ public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["customerName"] } } } }), []);
});

test("the primaryKey check follows the schema, not the name 'id'", () => {
  // A collection keyed by `name` (S1's services) must be held to `name`.
  // Hard-coding "id" would pass this file and fail the first real schema.
  const keyedByName = [{ cid: "bookings", primaryKey: "name" }];
  refuses(
    problemsFor({ public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["name"] } } } }, keyedByName),
    'createFields must NOT include "name"',
  );
  assert.deepEqual(problemsFor({ public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["id"] } } } }, keyedByName), []);
});

test("emailField and idField must be in createFields — the rules read them off the record", () => {
  // The same contradiction `required` and `keyFields` have: the rules read
  // `resource.data[emailField]`, and `hasOnly(createFields)` decides what may
  // be there at all. Declared in one and not the other, every submission is
  // refused whether or not it carries the field.
  refuses(
    problemsFor({
      collections: { responses: { submitOnly: true } },
      public: { submit: { responses: { auth: "verifiedEmail", createFields: ["answer"], emailField: "email" } } },
    }),
    'createFields must include "email"',
  );
  refuses(
    problemsFor({
      collections: { responses: { submitOnly: true } },
      public: { submit: { responses: { auth: "verifiedEmail", createFields: ["answer"], idFrom: "auth.uid+field", idField: "who" } } },
    }),
    'createFields must include "who"',
  );
  assert.deepEqual(
    problemsFor({
      collections: { responses: { submitOnly: true } },
      public: { submit: { responses: { auth: "verifiedEmail", createFields: ["answer", "email"], emailField: "email" } } },
    }),
    [],
  );
});

// --- the publisher ----------------------------------------------------------

test("the publisher must hold app-wide owner in the roster they are publishing", () => {
  // Otherwise Firestore answers with a permission error that says nothing
  // about rosters, on a write the author believes they are entitled to make.
  const problems = publishProblems(app({}), CIDS, "someone-else@salon.jp");
  refuses(problems, 'add "someone-else@salon.jp": { "*": "owner" }');
  assert.deepEqual(publishProblems(app({}), CIDS, OWNER), []);
});

test("a per-collection role is not app-wide owner", () => {
  // `role(a, '*')` falls back to the '*' entry only; a member holding
  // `{ bookings: "owner" }` cannot write the app document.
  const problems = publishProblems(AuthoredAppZ.parse({ aid: "app_test", members: { [OWNER]: { bookings: "owner" } } }), CIDS, OWNER);
  refuses(problems, "members must give you app-wide owner");
});
