// "Copy to clipboard with a transient confirmation flag" — the
// same 9-line pattern was copied into 3 plugin views
// (markdown / presentMulmoScript / textResponse) before this
// composable existed.
//
// Usage:
//
//   const { copied, copy } = useClipboardCopy();
//
//   async function copyText() {
//     await copy(textToCopy.value);
//   }
//
// `copied` flips to true on success and back to false after
// `resetMs` (default 2000ms) so the UI can show a ✓ / "Copied!"
// hint. Clipboard failures (permissions, insecure context) are
// swallowed on purpose — there's no useful UI action beyond letting
// the hint stay off, which is exactly what the ref signals.

import { ref, type Ref } from "vue";

export interface UseClipboardCopyHandle {
  copied: Ref<boolean>;
  copy: (text: string) => Promise<void>;
}

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
      // Clipboard API may be blocked in some contexts (e.g. iframe
      // without permissions, non-HTTPS origin). Leave `copied` false.
    }
  }

  return { copied, copy };
}
