// The app's pages, per audience: what normalizes, what is refused, and what a
// participant may reach.
//
// The PROJECTION — turning these views into each tier's `config` document — is
// no longer here: it belongs to the host, and is covered by MulmoTerminal
// `test/server/backends/appViewProjection.spec.ts`. What is left is what the
// publish gate and the rules' own read branches depend on.
//
// Every refusal here is paired with the neighbouring declaration that must
// still pass — a file of refusals alone is satisfied by an implementation that
// refuses everything, which from inside its own suite looks like safety.

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeViews, participantScope, viewDocId, PUBLIC_VIEW_ID } from "../../src/collection/server/appViews";
import { AuthoredAppZ } from "../../src/collection/server/publishManifest";

const OWNER = "owner@salon.jp";

const app = (overrides: Record<string, unknown>) => AuthoredAppZ.parse({ aid: "app_views", members: { [OWNER]: { "*": "owner" } }, ...overrides });

const DESK = { id: "desk", audience: "member", path: "views/desk.html", collections: ["bookings"] };

const problemsOf = (overrides: Record<string, unknown>): string[] => {
  const result = normalizeViews(app(overrides));
  return result.ok ? [] : result.problems;
};

function refuses(problems: string[], fragment: string): void {
  const bullets = problems.map((problem) => `  - ${problem}`).join("\n");
  assert.ok(
    problems.some((problem) => problem.includes(fragment)),
    `expected a problem mentioning ${JSON.stringify(fragment)}, got:\n${bullets || "  (none)"}`,
  );
}

// --- normalization ----------------------------------------------------------

test("the older public.view spelling normalizes into the list, under the reserved id", () => {
  const result = normalizeViews(app({ public: { view: { path: "views/booking.html", collections: ["slots"] } } }));
  assert.ok(result.ok);
  assert.deepEqual(result.views, [{ id: PUBLIC_VIEW_ID, audience: "public", path: "views/booking.html", collections: ["slots"], where: "public.view" }]);
});

test("an app declaring neither spelling normalizes to nothing, not to a problem", () => {
  const result = normalizeViews(app({}));
  assert.ok(result.ok);
  assert.deepEqual(result.views, []);
});

test("refuses both spellings at once rather than choosing one silently", () => {
  refuses(problemsOf({ views: [DESK], public: { view: { path: "views/booking.html", collections: ["slots"] } } }), "declares both");
});

test("refuses an id that is not a legal document id — it IS the document id", () => {
  // The one that matters: staging would write one path and withdrawal would
  // tidy another, and neither says anything.
  refuses(problemsOf({ views: [{ ...DESK, id: "desk/../evil" }] }), "It becomes the document id");
  refuses(problemsOf({ views: [{ ...DESK, id: "live:desk" }] }), "It becomes the document id");
  refuses(problemsOf({ views: [{ ...DESK, id: "Desk" }] }), "It becomes the document id");
  refuses(problemsOf({ views: [{ ...DESK, id: "-desk" }] }), "It becomes the document id");
  assert.deepEqual(problemsOf({ views: [{ ...DESK, id: "front-desk-2" }] }), []);
});

test("refuses the id the projection itself is published at", () => {
  refuses(problemsOf({ views: [{ ...DESK, id: "config" }] }), "which is reserved");
});

test("refuses the public id on a page that is not the public one", () => {
  refuses(problemsOf({ views: [{ ...DESK, id: "public" }] }), "belongs to the public page");
  assert.deepEqual(problemsOf({ views: [{ ...DESK, id: "public", audience: "public" }] }), []);
});

test("refuses two views at one id — they would be one page", () => {
  refuses(problemsOf({ views: [DESK, { ...DESK, path: "views/stock.html" }] }), "already uses");
});

test("accepts two views for one audience, which is the point of the id", () => {
  assert.deepEqual(problemsOf({ views: [DESK, { ...DESK, id: "stock", path: "views/stock.html" }] }), []);
});

test("refuses an audience outside the closed set, at the parser", () => {
  assert.throws(() => app({ views: [{ ...DESK, audience: "editor" }] }));
});

// --- what each audience is handed -------------------------------------------

test("a participant reads a participantRead collection whole, and their own row otherwise", () => {
  const declared = app({
    participantRead: ["notices"],
    public: {
      submit: {
        bookings: { auth: "verifiedEmail", createFields: ["email"], emailField: "email" },
        seats: { auth: "anonymous", createFields: ["x"], idFrom: "auth.uid" },
      },
    },
  });
  const promoted = ["notices"];
  assert.deepEqual(participantScope(declared, "notices", promoted), { cid: "notices", scope: "all" });
  assert.deepEqual(participantScope(declared, "bookings", promoted), { cid: "bookings", scope: "own", emailField: "email" });
  assert.deepEqual(participantScope(declared, "seats", promoted), { cid: "seats", scope: "own", ownDocId: "auth.uid" });
  // Neither: the rules would refuse the read, so there is nothing to hand a page.
  assert.equal(participantScope(declared, "ledger", promoted), null);
});

test("the participant scope follows what will be PROMOTED, not what the manifest says", () => {
  // `projectPublish` overwrites `participantRead` with the staged schemas' own,
  // so a cid added to app.json since the last deploy is not in the rules.
  // Reading the manifest here would hand a page `scope: "all"` for a collection
  // the rules then deny — the page fails rather than showing less. The caller
  // passes the set that will actually be in force; this is why it is a
  // parameter and not read off `app`.
  assert.equal(participantScope(app({ participantRead: ["notices"] }), "notices", []), null);
});

test("more than one public page is refused: there is only one document to publish it at", () => {
  // Nothing would error. `config/view` is a single document, so the second
  // entry is published nowhere and which one is live depends on the order they
  // were written in.
  refuses(
    problemsOf({
      views: [
        { ...DESK, id: "one", audience: "public" },
        { ...DESK, id: "two", audience: "public" },
      ],
    }),
    "a second audience",
  );
  // The member tiers have no such limit — the id IS the address there.
  assert.deepEqual(problemsOf({ views: [DESK, { ...DESK, id: "stock" }] }), []);
});

test("the document id carries the stage, and the id the author wrote", () => {
  assert.equal(viewDocId("live", "desk"), "live:desk");
  assert.equal(viewDocId("staged", "desk"), "staged:desk");
});
