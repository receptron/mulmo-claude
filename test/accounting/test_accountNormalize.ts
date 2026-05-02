// Boundary tests for normalizeStoredAccount — the pure helper that
// owns the field-whitelist + active-flag policy. Mirrors the behavior
// asserted by the integration tests in test_service.ts but pins it
// without the file-IO + book-creation overhead, so a regression
// surfaces here first with a precise diagnostic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStoredAccount } from "../../server/accounting/accountNormalize.ts";
import type { Account } from "../../server/accounting/types.ts";

const BASE: Account = { code: "1500", name: "Equipment", type: "asset" };

describe("normalizeStoredAccount", () => {
  describe("field whitelist", () => {
    it("keeps code, name, type", () => {
      assert.deepEqual(normalizeStoredAccount(BASE), { code: "1500", name: "Equipment", type: "asset" });
    });

    it("stores note only when non-empty", () => {
      assert.equal(normalizeStoredAccount({ ...BASE, note: "tax bucket A" }).note, "tax bucket A");
      assert.equal(normalizeStoredAccount({ ...BASE, note: "" }).note, undefined);
    });

    it("drops unknown keys (mistyped LLM payload)", () => {
      // The Account type has no `tag` field; cast through `unknown`
      // and verify nothing leaks into the persisted record.
      const messy = { ...BASE, tag: "bogus" } as unknown as Account;
      const stored = normalizeStoredAccount(messy);
      assert.equal((stored as unknown as { tag?: string }).tag, undefined);
    });
  });

  describe("active flag policy", () => {
    it("explicit false → stored false (deactivate)", () => {
      assert.equal(normalizeStoredAccount({ ...BASE, active: false }).active, false);
    });

    it("explicit true → omitted (reactivate; default-active)", () => {
      // explicit true on a previously-inactive account: the flag
      // is dropped from the stored record so the file stays clean
      // for default-active accounts.
      const inactive: Account = { ...BASE, active: false };
      assert.equal(normalizeStoredAccount({ ...BASE, active: true }, inactive).active, undefined);
    });

    it("omitted on an active existing → omitted (no change)", () => {
      assert.equal(normalizeStoredAccount(BASE, BASE).active, undefined);
    });

    it("omitted on an inactive existing → inherit false (no silent reactivation)", () => {
      // The bug this helper was extracted to fix: an LLM tool call
      // that only sends {code, name, type} on an inactive account
      // must not flip it back into entry/ledger dropdowns.
      const inactive: Account = { ...BASE, active: false };
      assert.equal(normalizeStoredAccount(BASE, inactive).active, false);
    });

    it("omitted on a brand-new account → omitted (default-active)", () => {
      assert.equal(normalizeStoredAccount(BASE, undefined).active, undefined);
    });
  });
});
