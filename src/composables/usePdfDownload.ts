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

export interface DownloadPdfOptions {
  /** Workspace-relative source directory of the markdown (e.g.
   *  `"data/wiki/pages"` for Wiki pages). The server uses it to
   *  resolve relative `<img>` references to the right base path
   *  before inlining. Omit for the legacy `markdowns/` default. */
  baseDir?: string;
  /** When true, the server strips a leading YAML frontmatter envelope
   *  (`---\n…\n---\n`) before rendering, so the YAML header doesn't
   *  appear as plain text on page 1 of the PDF. Wiki pages set this.
   *  Other callers leave it false so a chat-generated document that
   *  literally starts with `---` is preserved. */
  stripFrontmatter?: boolean;
}

export interface UsePdfDownloadHandle {
  pdfDownloading: Ref<boolean>;
  pdfError: Ref<string | null>;
  downloadPdf: (markdown: string, filename: string, options?: DownloadPdfOptions) => Promise<void>;
}

export function usePdfDownload(): UsePdfDownloadHandle {
  const pdfDownloading = ref(false);
  const pdfError = ref<string | null>(null);

  async function downloadPdf(markdown: string, filename: string, options: DownloadPdfOptions = {}): Promise<void> {
    pdfError.value = null;
    pdfDownloading.value = true;
    let url: string | null = null;
    try {
      // PDF endpoint returns a binary blob, not JSON — use the raw
      // Response escape hatch so we can call `.blob()` ourselves.
      const response = await apiFetchRaw(API_ROUTES.pdf.markdown, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, filename, baseDir: options.baseDir, stripFrontmatter: options.stripFrontmatter }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        pdfError.value = `PDF error ${response.status}: ${errText}`;
        return;
      }
      const blob = await response.blob();
      url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
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
