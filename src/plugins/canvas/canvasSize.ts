export const CANVAS_PADDING_PX = 32;
const ASPECT_W = 16;
const ASPECT_H = 9;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasSizeDecision {
  /** null when the container is too small to host a usable canvas. */
  size: CanvasSize | null;
  /** True when `size` differs from `current` (caller should apply it). */
  changed: boolean;
  /** True when this is the first real paint (current width was 0). */
  isFirstPaint: boolean;
}

// Derive the 16:9 canvas size from the container width. A width small enough
// that the derived height floors to 0 is rejected — a 1×0 canvas is unusable
// and was previously accepted for container widths of ~33–47px.
export const computeCanvasSize = (containerWidth: number, current: CanvasSize): CanvasSizeDecision => {
  const width = Math.floor(containerWidth - CANVAS_PADDING_PX);
  const height = Math.floor((width * ASPECT_H) / ASPECT_W);
  if (width <= 0 || height <= 0) {
    return { size: null, changed: false, isFirstPaint: false };
  }
  const changed = width !== current.width || height !== current.height;
  return { size: { width, height }, changed, isFirstPaint: current.width === 0 };
};
