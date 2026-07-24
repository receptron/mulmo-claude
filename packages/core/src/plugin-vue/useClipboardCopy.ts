// Copy-to-clipboard with a self-clearing "Copied!" flag, shared by the host (text
// response, permalink) and the markdown plugin's View. Clipboard failures (permissions,
// insecure context) are swallowed on purpose: the UI just leaves the hint off, which is
// what `copied=false` already signals.

import { ref, type Ref } from "vue";

export interface UseClipboardCopyHandle {
  copied: Ref<boolean>;
  copy: (text: string) => Promise<void>;
}

const DEFAULT_RESET_MS = 2000;

export function useClipboardCopy(resetMs = DEFAULT_RESET_MS): UseClipboardCopyHandle {
  const copied = ref(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      // Cancel any in-flight reset so a quick second copy doesn't get its "Copied!" hint
      // cleared early by the previous timer.
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copied.value = false;
      }, resetMs);
    } catch {
      // Clipboard API blocked (iframe without permissions, non-HTTPS origin) — leave
      // `copied` false.
    }
  }

  return { copied, copy };
}
