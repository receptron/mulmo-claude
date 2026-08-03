// PDF export for the markdown plugin, over the host-agnostic dispatch
// channel (task #6). Replaces the host-specific `usePdfDownload`
// (which POSTed to MulmoClaude's `/api/pdf/markdown` and streamed a
// binary). The host renders the PDF behind `dispatch({ kind:
// "exportPdf" })` and returns it base64-encoded (JSON-safe); this
// composable decodes it back to a Blob and triggers the browser
// download. Lives with the plugin so it lifts into
// `@mulmoclaude/markdown-plugin` verbatim.

import { ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ExportPdfOptions } from "./contract";
import { readExportedPdf } from "./contract";

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function triggerDownload(blob: Blob, filename: string): void {
  const safeName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next tick so the click's navigation has consumed
    // the URL before it's freed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function usePdfExport() {
  const { dispatch } = useRuntime();
  const pdfDownloading = ref(false);
  const pdfError = ref<string | null>(null);

  async function downloadPdf(options: ExportPdfOptions): Promise<void> {
    if (!options.markdown) return;
    pdfDownloading.value = true;
    pdfError.value = null;
    try {
      const { pdfBase64 } = await dispatch({ kind: "exportPdf", ...options }, readExportedPdf);
      triggerDownload(base64ToBlob(pdfBase64, "application/pdf"), options.filename);
    } catch (err) {
      pdfError.value = err instanceof Error ? err.message : String(err);
    } finally {
      pdfDownloading.value = false;
    }
  }

  return { pdfDownloading, pdfError, downloadPdf };
}
