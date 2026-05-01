/**
 * Text Response Plugin - Type Definitions
 */

export interface TextResponseData {
  text: string;
  role?: "assistant" | "system" | "user";
  transportKind?: string;
  // Workspace-relative paths of files the user attached when sending
  // this turn (paste/drop/file-picker). Persisted on the user message
  // so the chat history can render an icon / thumbnail chip alongside
  // the bubble. Empty / undefined for assistant and system turns.
  attachments?: string[];
  /** Original (un-rewritten) markdown source for PDF generation.
   *  When present, `downloadPdf` sends this to the server instead of
   *  the displayed `text` (which may have already been rewritten with
   *  `/api/files/raw?path=...` URLs that the PDF inliner can't
   *  resolve). Files Explorer's .md preview sets this; chat callers
   *  leave it undefined and fall back to `text`. */
  pdfSourceText?: string;
  /** Workspace-relative directory of the source file. Forwarded to
   *  `usePdfDownload({ baseDir })` so server-side image inlining
   *  resolves relative refs against the right base. */
  pdfBaseDir?: string;
  /** Strip a leading YAML frontmatter envelope before rendering the
   *  PDF. Set true for Wiki pages (frontmatter shouldn't appear on
   *  page 1 of the PDF); leave false for chat / generic markdown so
   *  documents that literally start with `---\n…\n---\n` survive. */
  pdfStripFrontmatter?: boolean;
}

export type TextResponseArgs = TextResponseData;
