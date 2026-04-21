// Shared PDF download logic used by the markdown and textResponse
// plugin views. Encapsulates the POST /api/pdf/markdown call, the
// in-flight `pdfDownloading` flag, the `pdfError` state, and the
// blob-to-download dance (createObjectURL → click → revoke).
//
// Error handling contract: any failure path (network, non-OK HTTP,
// malformed blob) sets pdfDownloading back to false and populates
// pdfError with a user-facing message. Callers can render pdfError
// below the download button.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiFetchRaw } from "../utils/api";
import { errorMessage } from "../utils/errors";

export interface UsePdfDownloadHandle {
  pdfDownloading: Ref<boolean>;
  pdfError: Ref<string | null>;
  downloadPdf: (markdown: string, filename: string) => Promise<void>;
}

export function usePdfDownload(): UsePdfDownloadHandle {
  const pdfDownloading = ref(false);
  const pdfError = ref<string | null>(null);

  async function downloadPdf(markdown: string, filename: string): Promise<void> {
    pdfError.value = null;
    pdfDownloading.value = true;
    let url: string | null = null;
    try {
      // PDF endpoint returns a binary blob, not JSON — use the raw
      // Response escape hatch so we can call `.blob()` ourselves.
      const response = await apiFetchRaw(API_ROUTES.pdf.markdown, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, filename }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        pdfError.value = `PDF error ${response.status}: ${errText}`;
        return;
      }
      const blob = await response.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    } catch (err) {
      pdfError.value = errorMessage(err);
    } finally {
      // Always clean up the object URL and release the in-flight flag
      // so the button is never left disabled forever.
      if (url) URL.revokeObjectURL(url);
      pdfDownloading.value = false;
    }
  }

  return { pdfDownloading, pdfError, downloadPdf };
}
