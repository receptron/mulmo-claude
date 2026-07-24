// Download markdown / a wiki page as a self-contained HTML zip. Parallel
// to usePdfDownload, but hits POST /api/share/pack-markdown and receives
// a zip (index.html with CSS + images inlined). Failure sets `zipFailed`
// so callers render a localized message — the raw server body is never
// surfaced.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { postMarkdownForBlob, type MarkdownRenderOptions } from "../utils/markdownBlobRequest";
import { saveBlob, filenameFromDisposition } from "../utils/blobDownload";

export interface UseMarkdownZipHandle {
  zipDownloading: Ref<boolean>;
  zipFailed: Ref<boolean>;
  downloadZip: (markdown: string, filename: string, options?: MarkdownRenderOptions) => Promise<void>;
}

export function useMarkdownZip(): UseMarkdownZipHandle {
  const zipDownloading = ref(false);
  const zipFailed = ref(false);

  async function downloadZip(markdown: string, filename: string, options: MarkdownRenderOptions = {}): Promise<void> {
    zipFailed.value = false;
    zipDownloading.value = true;
    try {
      const response = await postMarkdownForBlob(API_ROUTES.share.packMarkdown, markdown, filename, options);
      if (!response.ok) {
        zipFailed.value = true;
        return;
      }
      saveBlob(await response.blob(), filenameFromDisposition(response.headers.get("content-disposition"), `${filename}.zip`));
    } catch {
      zipFailed.value = true;
    } finally {
      zipDownloading.value = false;
    }
  }

  return { zipDownloading, zipFailed, downloadZip };
}
