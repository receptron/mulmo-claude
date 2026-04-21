// Text utilities shared across bridge packages.

/**
 * Split text into chunks of at most `max` characters.
 * Returns `["(empty reply)"]` when text is empty.
 */
export function chunkText(text: string, max: number): string[] {
  if (text.length === 0) return ["(empty reply)"];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks;
}
