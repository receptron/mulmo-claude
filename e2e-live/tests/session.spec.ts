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
    const userPrompt = "Reply with the single word: pong";
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      await waitForAssistantResponseComplete(page);
      const sessionIdBeforeReload = getCurrentSessionId(page);
      expect(sessionIdBeforeReload, "session URL should be /chat/<id> after the first turn").not.toBeNull();
      sessionIdForCleanup = sessionIdBeforeReload;

      await page.reload();

      // Two complementary signals — together they cover B-14:
      //  1. URL-level: the /chat/<id> route survived the reload.
      //  2. DOM-level: the user's own prompt is back in the
      //     transcript. The user-typed string is locale-agnostic
      //     (the app never localizes user input), so this catches
      //     "URL stayed but transcript failed to hydrate" without
      //     coupling to UI dictionaries (CLAUDE.md keeps eight in
      //     lockstep). See Codex review iter-1 / GHA review for
      //     why visible-text assertions on chrome-side strings
      //     stay out of this spec.
      expect(getCurrentSessionId(page), "session id must survive a reload").toBe(sessionIdBeforeReload);
      // The same prompt text shows up in both the sidebar history
      // preview and the main transcript bubble after rehydration —
      // either rendering is enough to prove the record came back, so
      // `.first()` keeps the locator out of strict-mode violation
      // territory while still catching the "URL kept but transcript
      // lost" failure mode Codex flagged.
      await expect(page.getByText(userPrompt).first(), "user prompt must rehydrate after reload — B-14 transcript canary").toBeVisible();
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });
});
