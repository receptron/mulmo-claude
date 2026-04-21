// Dynamic favicon that changes color based on agent state (#470).
//
// Uses Canvas API to draw a rounded-square icon with the letter "M"
// in the center. Color reflects the current state:
//   idle (gray) → running (blue, pulse) → done (green) → error (red)
//   notification badge (orange dot) overlaid when unread count > 0.

import { watch, type Ref, type ComputedRef } from "vue";

export const FAVICON_STATES = {
  idle: "idle",
  running: "running",
  done: "done",
  error: "error",
} as const;

export type FaviconState = (typeof FAVICON_STATES)[keyof typeof FAVICON_STATES];

const STATE_COLORS: Record<FaviconState, string> = {
  idle: "#6B7280", // gray-500
  running: "#3B82F6", // blue-500
  done: "#22C55E", // green-500
  error: "#EF4444", // red-500
};

const NOTIFICATION_DOT_COLOR = "#F97316"; // orange-500
const SIZE = 32;
const RADIUS = 6;

function drawRoundedRect(ctx: CanvasRenderingContext2D, posX: number, posY: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(posX + radius, posY);
  ctx.lineTo(posX + width - radius, posY);
  ctx.quadraticCurveTo(posX + width, posY, posX + width, posY + radius);
  ctx.lineTo(posX + width, posY + height - radius);
  ctx.quadraticCurveTo(posX + width, posY + height, posX + width - radius, posY + height);
  ctx.lineTo(posX + radius, posY + height);
  ctx.quadraticCurveTo(posX, posY + height, posX, posY + height - radius);
  ctx.lineTo(posX, posY + radius);
  ctx.quadraticCurveTo(posX, posY, posX + radius, posY);
  ctx.closePath();
}

function renderFavicon(state: FaviconState, hasNotification: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Background: rounded square
  const color = STATE_COLORS[state];
  drawRoundedRect(ctx, 1, 1, SIZE - 2, SIZE - 2, RADIUS);
  ctx.fillStyle = color;
  ctx.fill();

  // Subtle shadow/depth
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, 1, 1, SIZE - 2, SIZE - 2, RADIUS);
  ctx.stroke();

  // "M" letter
  ctx.fillStyle = "white";
  ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M", SIZE / 2, SIZE / 2 + 1);

  // Running state: subtle glow ring
  if (state === FAVICON_STATES.running) {
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 3, 3, SIZE - 6, SIZE - 6, RADIUS - 1);
    ctx.stroke();
  }

  // Notification badge (orange dot, top-right)
  if (hasNotification) {
    const dotR = 5;
    const dotX = SIZE - dotR - 1;
    const dotY = dotR + 1;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = NOTIFICATION_DOT_COLOR;
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  return canvas.toDataURL("image/png");
}

function applyFavicon(dataUrl: string): void {
  if (!dataUrl) return;
  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
  }
  link.type = "image/png";
  link.href = dataUrl;
}

export function useDynamicFavicon(opts: { state: Ref<FaviconState> | ComputedRef<FaviconState>; hasNotification: Ref<boolean> | ComputedRef<boolean> }): void {
  function update(): void {
    const dataUrl = renderFavicon(opts.state.value, opts.hasNotification.value);
    applyFavicon(dataUrl);
  }

  watch([opts.state, opts.hasNotification], update, { immediate: true });
}
