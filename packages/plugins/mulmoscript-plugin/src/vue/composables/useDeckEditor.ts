// #1575 — when every beat is a `slide`, the View swaps the per-beat list for
// the interactive deck editor (@mulmocast/deck-web). Each editor emit fires
// `update:script`; this debounces them into one updateScript round-trip per
// quiet stretch (300ms — short enough to feel live, long enough that typing in
// the Inspector doesn't carpet-bomb the server).

import { computed, type ComputedRef } from "vue";
import { isAllSlideDeck } from "../helpers";
import type { MulmoScriptTransport } from "../transport";
import type { DeckScriptShape, MulmoScript } from "../viewTypes";

const DECK_SAVE_DEBOUNCE_MS = 300;

export interface UseDeckEditorOptions {
  api: MulmoScriptTransport;
  filePath: ComputedRef<string>;
  effectiveScript: ComputedRef<MulmoScript>;
  /** Persist the saved script back into the parent's toolResult so the
   *  in-memory script and reactive beats[] stay in sync without a remount. */
  commitScript: (next: MulmoScript) => void;
}

export function useDeckEditor({ api, filePath, effectiveScript, commitScript }: UseDeckEditorOptions) {
  const isDeck = computed(() => isAllSlideDeck(effectiveScript.value));
  const deckScriptInput = computed<DeckScriptShape>(() => effectiveScript.value as unknown as DeckScriptShape);

  let deckSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDeckScript: MulmoScript | null = null;

  function scheduleDeckSave(next: MulmoScript): void {
    pendingDeckScript = next;
    if (deckSaveTimer) clearTimeout(deckSaveTimer);
    deckSaveTimer = setTimeout(() => {
      void flushDeckSave();
    }, DECK_SAVE_DEBOUNCE_MS);
  }

  async function flushDeckSave(): Promise<void> {
    deckSaveTimer = null;
    const next = pendingDeckScript;
    pendingDeckScript = null;
    if (!next || !filePath.value) return;
    const response = await api.call("updateScript", { filePath: filePath.value, script: next });
    if (!response.ok) {
      // Surface via console; the deck editor still holds the latest edit in
      // its props until the next refresh, so the view doesn't snap back on a
      // transient failure. A full toast UI is P2.
      console.error("[presentMulmoScript] deck save failed:", response.error);
      return;
    }
    commitScript(next);
  }

  function onDeckUpdate(next: DeckScriptShape): void {
    scheduleDeckSave(next as unknown as MulmoScript);
  }

  // Flush synchronously-scheduled work on unmount so a quick switch away
  // doesn't lose the last keystroke. Fire-and-forget — the component is gone,
  // we just want the bytes to land.
  function flushPendingDeckSave(): void {
    if (deckSaveTimer) {
      clearTimeout(deckSaveTimer);
      void flushDeckSave();
    }
  }

  return { isDeck, deckScriptInput, onDeckUpdate, flushPendingDeckSave };
}
