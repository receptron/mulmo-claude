// The printable wrapper references the saved SVG via `<img src=ABS_URL>`
// rather than inlining its source. Browsers refuse to execute `<script>`
// inside an SVG loaded via `<img>`, so even an LLM that emits scripted SVG
// can't run code through this path. The wrapping HTML is fully under our
// control — its only script is the auto-print trigger.
export const buildPrintableHtml = (absoluteImgUrl: string): string => {
  const styleBlock = `<style>
    html, body { margin: 0; padding: 0; height: 100%; }
    body { display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
    img { max-width: 100%; max-height: 100%; height: auto; width: auto; display: block; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { margin: 10mm; }
    }
  </style>`;
  // `onload` on the `<img>` fires the print dialog only after the SVG has
  // rendered — beats a fixed timeout that could race a slow paint.
  const escapedUrl = absoluteImgUrl.replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${styleBlock}</head><body><img src="${escapedUrl}" alt="" onload="window.print()"></body></html>`;
};
