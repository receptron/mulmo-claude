import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, getCurrentSessionId, sendChatMessage, startNewSession, waitForAssistantResponseComplete } from "../fixtures/live-chat.ts";

const L06_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

test.describe.configure({ mode: "parallel" });

test.describe("roles (real LLM)", () => {
  test("L-06: General ロールで 1 ターン → 入力欄 enabled + 応答完走", async ({ page }) => {
    test.setTimeout(L06_TIMEOUT_MS);
    // Covers B-15 (General used to be disabled when GEMINI_API_KEY
    // was missing) and B-41 (deferred-tools switch broke role tool
    // calls). The "single word" prompt is enough to drive a full
    // turn without paying for TTS / image generation.
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      // The visible role label is localized in eight UI dictionaries
      // (CLAUDE.md keeps them in lockstep), so we assert on the
      // chip's `data-role` attribute instead — that's the locale-
      // agnostic identity of the active role and is the actual B-15
      // regression net (the bug disabled the General role
      // specifically).
      await expect(page.getByTestId("role-selector-btn"), "default role must be General — B-15 canary").toHaveAttribute("data-role", "general");
      await expect(page.getByTestId("user-input"), "input must be enabled — B-15 used to disable it on this role").toBeEnabled();
      await sendChatMessage(page, "Reply with the single word: hello");
      await waitForAssistantResponseComplete(page);
      // The empty-session placeholder lingers in DOM longer than the
      // thinking-indicator on chromium even after the reply lands, so
      // assert the durable signal instead: a chat session URL got
      // assigned. /chat/<id> means the turn made it past the deferred-
      // tools switch and produced a session record.
      const sessionId = getCurrentSessionId(page);
      expect(sessionId, "session id should be present after a successful turn (B-41 canary)").not.toBeNull();
      sessionIdForCleanup = sessionId;
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });
});
