// Boundary tests for the AccountsModal client-side validator. Pure
// function — no Vue / i18n / network. Mirrors the server's
// `_`-prefix rule and the duplicate-code guard so the user sees the
// localized message instead of round-tripping for an obvious
// failure. Also covers the 4-digit / type-prefix numbering rule
// the form enforces on new accounts (1xxx asset / 2xxx liability /
// 3xxx equity / 4xxx income / 5xxx expense).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAccountDraft } from "../../../src/plugins/accounting/components/accountValidation.ts";
import type { Account } from "../../../src/plugins/accounting/api.ts";
import type { AccountDraft } from "../../../src/plugins/accounting/components/accountDraft.ts";

const EXISTING: readonly Account[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "5100", name: "Rent", type: "expense" },
];

function draft(overrides: Partial<AccountDraft> = {}): AccountDraft {
  return { code: "5500", name: "Marketing", type: "expense", note: "", ...overrides };
}

describe("validateAccountDraft", () => {
  describe("happy path", () => {
    it("accepts a brand-new code that doesn't collide", () => {
      assert.equal(validateAccountDraft(draft(), EXISTING, true), null);
    });

    it("accepts an edit of an existing account (same code is allowed when !isNew)", () => {
      assert.equal(validateAccountDraft(draft({ code: "1000", name: "Petty Cash" }), EXISTING, false), null);
    });

    it("trims surrounding whitespace before validating", () => {
      assert.equal(validateAccountDraft(draft({ code: "  5800  ", name: "  Travel  " }), EXISTING, true), null);
    });
  });

  describe("emptyCode", () => {
    it("rejects an empty code", () => {
      assert.equal(validateAccountDraft(draft({ code: "" }), EXISTING, true), "emptyCode");
    });

    it("rejects whitespace-only code (treated as empty after trim)", () => {
      assert.equal(validateAccountDraft(draft({ code: "   " }), EXISTING, true), "emptyCode");
    });
  });

  describe("reservedCode", () => {
    it("rejects a code starting with the reserved `_` prefix", () => {
      assert.equal(validateAccountDraft(draft({ code: "_synthetic" }), EXISTING, true), "reservedCode");
    });

    it("rejects on edit too — server would also reject", () => {
      assert.equal(validateAccountDraft(draft({ code: "_synthetic" }), EXISTING, false), "reservedCode");
    });

    it("checks reservedCode before invalidCodeFormat (reserved wins)", () => {
      // `_synthetic` would also fail the 4-digit format check, but
      // the reserved-prefix message is more actionable for the
      // edge case of someone trying the namespace deliberately.
      assert.equal(validateAccountDraft(draft({ code: "_synth" }), EXISTING, true), "reservedCode");
    });
  });

  describe("invalidCodeFormat", () => {
    it("rejects a code that isn't exactly 4 digits", () => {
      assert.equal(validateAccountDraft(draft({ code: "55" }), EXISTING, true), "invalidCodeFormat");
    });

    it("rejects a code with embedded non-digits", () => {
      assert.equal(validateAccountDraft(draft({ code: "5_10" }), EXISTING, true), "invalidCodeFormat");
    });

    it("does NOT enforce format on edit — preserves legacy codes from books created before the rule landed", () => {
      assert.equal(validateAccountDraft(draft({ code: "55", name: "Legacy" }), EXISTING, false), null);
    });
  });

  describe("codeTypeMismatch", () => {
    it("rejects a 4-digit code whose leading digit doesn't match the type", () => {
      // 1000 → asset prefix; type is expense → mismatch.
      const next = draft({ code: "1500", type: "expense", name: "Mismatch" });
      assert.equal(validateAccountDraft(next, EXISTING, true), "codeTypeMismatch");
    });

    it("does NOT enforce on edit — type changes on existing accounts are caller-controlled", () => {
      assert.equal(validateAccountDraft(draft({ code: "1500", type: "expense", name: "Mismatch" }), EXISTING, false), null);
    });

    it("checks invalidCodeFormat before codeTypeMismatch (format wins)", () => {
      // "12" fails the 4-digit check; without the precedence, the
      // mismatch message would show first and confuse the user.
      assert.equal(validateAccountDraft(draft({ code: "12" }), EXISTING, true), "invalidCodeFormat");
    });
  });

  describe("emptyName", () => {
    it("rejects an empty name", () => {
      assert.equal(validateAccountDraft(draft({ name: "" }), EXISTING, true), "emptyName");
    });

    it("rejects whitespace-only name", () => {
      assert.equal(validateAccountDraft(draft({ name: "   " }), EXISTING, true), "emptyName");
    });

    it("checks code before name (emptyCode wins when both are empty)", () => {
      // Stable error precedence so the user fixes one issue at a
      // time instead of seeing the message change as they type.
      assert.equal(validateAccountDraft(draft({ code: "", name: "" }), EXISTING, true), "emptyCode");
    });
  });

  describe("duplicateCode", () => {
    it("rejects a new entry with a code that already exists", () => {
      assert.equal(validateAccountDraft(draft({ code: "5100" }), EXISTING, true), "duplicateCode");
    });

    it("does NOT flag duplicate when editing (isNew=false) — that's the upsert path", () => {
      // Editing an existing account naturally re-submits its own
      // code; the duplicate check would otherwise block every
      // legitimate edit.
      assert.equal(validateAccountDraft(draft({ code: "1000", name: "Cash on Hand" }), EXISTING, false), null);
    });

    it("matches duplicate against the trimmed code", () => {
      assert.equal(validateAccountDraft(draft({ code: "  5100  " }), EXISTING, true), "duplicateCode");
    });

    it("checks codeTypeMismatch before duplicateCode (mismatch wins)", () => {
      // 1000 is a duplicate of EXISTING[0] but with type=expense
      // the prefix mismatch message fires first — same precedence
      // logic as reserved-vs-duplicate: tell the user about the
      // structural rule before the collision.
      assert.equal(validateAccountDraft(draft({ code: "1000" }), EXISTING, true), "codeTypeMismatch");
    });
  });
});
