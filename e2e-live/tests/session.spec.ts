import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, getCurrentSessionId, sendChatMessage, startNewSession, waitForAssistantResponseComplete } from "../fixtures/live-chat.ts";

const L11_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// Each scenario opens its own chat session, so they do not share
// state. Run them in parallel to cut wall time.
test.describe.configure({ mode: "parallel" });

test.describe("session (real LLM)", () => {
  test("L-11: 新規セッション → 1 ターン → reload → 履歴復元", async ({ page }) => {
    test.setTimeout(L11_TIMEOUT_MS);
    // Covers B-14: history persisted on reload, no "Start a
    // conversation" empty-state regression. The prompt asks for a
    // one-word reply so the assistant never spins up TTS / image
    // generation; we only need *some* reply to confirm restore.
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, "Reply with the single word: pong");
      await waitForAssistantResponseComplete(page);
      const sessionIdBeforeReload = getCurrentSessionId(page);
      expect(sessionIdBeforeReload, "session URL should be /chat/<id> after the first turn").not.toBeNull();
      sessionIdForCleanup = sessionIdBeforeReload;

      await page.reload();

      expect(getCurrentSessionId(page), "session id must survive a reload").toBe(sessionIdBeforeReload);
      // The empty-session placeholder is the canary we don't want — if
      // history failed to restore, the panel collapses to that label.
      await expect(page.getByText("Start a conversation")).toBeHidden();
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });
});
