// Pasted/dropped chat attachment carried from ChatInput up to the
// send pipeline. Lives outside ChatInput.vue so non-Vue modules
// (e.g. utils/agent/pastedAttachment.ts) can import it under the
// test tsconfig, which sees `*.vue` only as the ambient shim.

export interface PastedFile {
  dataUrl: string;
  name: string;
  mime: string;
}
