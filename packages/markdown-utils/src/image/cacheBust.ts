import { reactive } from "vue";

// Keyed by workspace-relative image path (e.g. "artifacts/images/abc.png").
// `resolveImageSrc` reads this to append `?v=<bump>` to the URL so consumers
// (View, Preview) re-fetch when the file on disk has been overwritten in
// place. The canvas plugin is the current producer — it bumps after each
// autosave PUT.
const imageBumps = reactive<Record<string, number>>({});

export function getImageBump(imagePath: string): number {
  return imageBumps[imagePath] ?? 0;
}

export function bumpImage(imagePath: string): void {
  imageBumps[imagePath] = Date.now();
}
