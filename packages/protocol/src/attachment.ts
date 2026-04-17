// File attachment schema for chat messages (images, documents, etc.).

export interface Attachment {
  mimeType: string;
  data: string; // base64-encoded content
  filename?: string;
}
