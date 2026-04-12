/** Convert an imageData value to a displayable URL.
 *  Handles both legacy data URIs and workspace-relative file paths. */
export function resolveImageSrc(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData;
  return `/api/files/raw?path=${encodeURIComponent(imageData)}`;
}
