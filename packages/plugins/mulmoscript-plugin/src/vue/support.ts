// Small host-independent utilities the View needs, ported from
// MulmoClaude's `src/composables/useClipboardCopy.ts` so the package has no
// host imports. (`errorMessage` moved to `@mulmoclaude/common`.)

import { ref, type Ref } from "vue";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a dropped image File as a base64 data URL, the form the upload
 *  dispatches expect. Shared by the beat and character drop handlers.
 *  `readAsDataURL` always yields a string on load; the non-string reject
 *  is an unreachable guard kept so the resolve type stays `string` without
 *  a cast. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader did not return a data URL string"));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface UseClipboardCopyHandle {
  copied: Ref<boolean>;
  copy: (text: string) => Promise<void>;
}

/** Clipboard failures (permissions, insecure context) are swallowed on
 *  purpose: the UI just leaves the "Copied!" hint off, which is what
 *  `copied=false` already signals. */
export function useClipboardCopy(resetMs = 2000): UseClipboardCopyHandle {
  const copied = ref(false);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, resetMs);
    } catch {
      // Clipboard API blocked (iframe without permissions, non-HTTPS origin) — leave `copied` false.
    }
  }

  return { copied, copy };
}
