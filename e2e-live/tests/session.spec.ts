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
    // Covers B-14: history persisted on reload. The prompt asks
    // for a one-word reply so the assistant never spins up TTS /
    // image generation; we only need a session to be created and
    // its URL to survive the reload.
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, "Reply with the single word: pong");
      await waitForAssistantResponseComplete(page);
      const sessionIdBeforeReload = getCurrentSessionId(page);
      expect(sessionIdBeforeReload, "session URL should be /chat/<id> after the first turn").not.toBeNull();
      sessionIdForCleanup = sessionIdBeforeReload;

      await page.reload();

      // The session id surviving the reload is the structural
      // signal that history was restored. Asserting visible text
      // like "Start a conversation" would couple the test to the
      // active locale (CLAUDE.md keeps eight UI dictionaries in
      // lockstep), so it stays out of this spec — see Codex review
      // iteration-1 for the rationale.
      expect(getCurrentSessionId(page), "session id must survive a reload").toBe(sessionIdBeforeReload);
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });
});
