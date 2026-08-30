// #1575 — the View offers the interactive beat editor (@mulmocast/beat-editor) beside the
// per-beat list. Each editor emit fires
// `update:script`; this debounces them into one updateScript round-trip per
// quiet stretch (300ms — short enough to feel live, long enough that typing in
// the Inspector doesn't carpet-bomb the server).

import { computed, type ComputedRef } from "vue";
import { hasEditableBeats } from "../helpers";
import type { MulmoScriptTransport } from "../transport";
import type { DeckScriptShape, MulmoScript } from "../viewTypes";

const DECK_SAVE_DEBOUNCE_MS = 300;

/**
 * Who this editor is, on the wire.
 *
 * Every write carries it so the server's "this script changed" broadcast can be told apart
 * from someone else's. Without it a save would echo back and reload the editor mid-keystroke,
 * rebuilding the element the caret sits in.
 *
 * Per module instance rather than per component: one View is mounted at a time, and a value
 * that survives a remount keeps a save in flight from being mistaken for a foreign write.
 */
const EDITOR_ORIGIN = `deck-editor-${Math.random().toString(36).slice(2)}`;

export interface UseDeckEditorOptions {
  api: MulmoScriptTransport;
  filePath: ComputedRef<string>;
  effectiveScript: ComputedRef<MulmoScript>;
  /** Persist the saved script back into the parent's toolResult so the
   *  in-memory script and reactive beats[] stay in sync without a remount. */
  commitScript: (next: MulmoScript) => void;
}

export function useDeckEditor({ api, filePath, effectiveScript, commitScript }: UseDeckEditorOptions) {
  const canEditBeats = computed(() => hasEditableBeats(effectiveScript.value));
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
    const response = await api.call("updateScript", { filePath: filePath.value, script: next, origin: EDITOR_ORIGIN });
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

  /**
   * Reload when someone else writes this script — the agent, or another window.
   *
   * A pending local edit is flushed first rather than dropped: the user's keystrokes are the
   * thing they would notice losing, and the write that triggered this has already landed, so
   * flushing cannot clobber it out of order.
   */
  function watchForeignWrites(reload: () => void): () => void {
    return api.onScriptChanged(
      () => filePath.value,
      // Default root until step 2 — see the note in View.vue.
      () => undefined,
      EDITOR_ORIGIN,
      () => {
        flushPendingDeckSave();
        reload();
      },
    );
  }

  return { canEditBeats, deckScriptInput, onDeckUpdate, flushPendingDeckSave, watchForeignWrites };
}
