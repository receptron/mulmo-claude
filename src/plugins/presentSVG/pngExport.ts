export const PNG_SCALE = 2;
export const PNG_FALLBACK_DIM = 1024;

const NUMBER_PATTERN = "[+-]?[\\d.]+(?:[eE][+-]?\\d+)?";
const VIEWBOX_PATTERN = new RegExp(
  `viewBox\\s*=\\s*["']\\s*${NUMBER_PATTERN}[\\s,]+${NUMBER_PATTERN}[\\s,]+(${NUMBER_PATTERN})[\\s,]+(${NUMBER_PATTERN})\\s*["']`,
);

export const parseViewBoxAspect = (svgText: string): number | null => {
  const match = VIEWBOX_PATTERN.exec(svgText);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
};

const scaled = (width: number, height: number): { width: number; height: number } => ({
  width: Math.max(1, Math.round(width)) * PNG_SCALE,
  height: Math.max(1, Math.round(height)) * PNG_SCALE,
});

// Firefox reports naturalWidth/Height of 0 for SVGs that declare only a
// viewBox (the plugin's own prompt contract), so falling back to a square
// would silently squash non-square drawings.
export const pngCanvasSize = (naturalWidth: number, naturalHeight: number, viewBoxAspect: number | null): { width: number; height: number } => {
  const aspect = viewBoxAspect !== null && Number.isFinite(viewBoxAspect) && viewBoxAspect > 0 ? viewBoxAspect : null;
  if (naturalWidth > 0 && naturalHeight > 0) return scaled(naturalWidth, naturalHeight);
  if (naturalWidth > 0) return scaled(naturalWidth, aspect === null ? PNG_FALLBACK_DIM : naturalWidth / aspect);
  if (naturalHeight > 0) return scaled(aspect === null ? PNG_FALLBACK_DIM : naturalHeight * aspect, naturalHeight);
  if (aspect === null) return scaled(PNG_FALLBACK_DIM, PNG_FALLBACK_DIM);
  return aspect >= 1 ? scaled(PNG_FALLBACK_DIM, PNG_FALLBACK_DIM / aspect) : scaled(PNG_FALLBACK_DIM * aspect, PNG_FALLBACK_DIM);
};
