// The plugin-side confirm mirror must settle a still-pending confirm
// as "cancelled" before replacing state (same rule as the host mirror
// `src/composables/useConfirm.ts`) — otherwise the earlier caller's
// `await` hangs forever.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { confirmState, useConfirm } from "../../../packages/plugins/shared/components/confirm";

const settleProbe = async (promise: Promise<boolean>): Promise<{ pending: boolean; value: boolean | null }> => {
  const probe: { pending: boolean; value: boolean | null } = { pending: true, value: null };
  void promise.then((value) => {
    probe.pending = false;
    probe.value = value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return probe;
};

describe("plugins/shared confirm", () => {
  const { openConfirm, handleConfirm } = useConfirm();

  afterEach(() => {
    if (confirmState.value.resolve) {
      handleConfirm(false);
    }
  });

  it("resolves via handleConfirm and clears state", async () => {
    const pending = openConfirm("delete?");
    assert.equal(confirmState.value.isOpen, true);
    assert.equal(confirmState.value.message, "delete?");
    handleConfirm(true);
    assert.equal(await pending, true);
    assert.equal(confirmState.value.isOpen, false);
    assert.equal(confirmState.value.resolve, null);
  });

  it("settles a still-pending confirm as false when a new confirm replaces it", async () => {
    const first = openConfirm({ title: "First", message: "first?" });
    const second = openConfirm({ title: "Second", message: "second?" });

    assert.deepEqual(await settleProbe(first), { pending: false, value: false });
    assert.equal(confirmState.value.message, "second?");

    handleConfirm(true);
    assert.equal(await second, true);
  });
});
