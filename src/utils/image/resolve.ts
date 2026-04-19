import { API_ROUTES } from "../../config/apiRoutes";

/** Convert an imageData value to a displayable URL.
 *  Handles both legacy data URIs and workspace-relative file paths. */
export function resolveImageSrc(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData;
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(imageData)}`;
}
