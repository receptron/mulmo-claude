// Dynamic favicon that changes color based on agent state (#470).
//
// Renders the MulmoClaude mascot on a colored rounded square. The
// background color reflects state, and the mascot floats on top:
//   idle (gray) → running (blue, pulse) → done (green) → error (red)
//   notification badge (orange dot) overlaid when unread count > 0.
//
// The logo PNG has an opaque white background, which would otherwise
// hide the state color. On first load we pre-process the pixels,
// punching out near-white pixels to transparency so the colored
// backing shows through. The processed image is cached as an
// offscreen canvas for the lifetime of the page.
//
// If the logo fails to load we fall back to the earlier "M"-letter
// variant so the tab icon never disappears entirely.

import { watch, type Ref, type ComputedRef } from "vue";
import logoUrl from "../assets/mulmo_bw.png";

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

const NOTIFICATION_DOT_COLOR = "#DC2626"; // red-600 — stands out against the gray/blue/green state backgrounds
const SIZE = 32;
const RADIUS = 6;
// How much of the inner rounded square the mascot fills. 2 px of
// padding on each side keeps it off the rounded corners and leaves
// room for the colored backing to peek around the outline.
const MASCOT_INSET = 2;

// Pixels whose RGB channels are all above this are treated as the
// PNG's white backing and punched to transparent. The PNG uses a soft
// pastel palette so the mascot itself never hits all three channels
// this high.
const WHITE_TO_ALPHA_THRESHOLD = 235;
// Pixels in the [FEATHER_LOW, WHITE_TO_ALPHA_THRESHOLD] band get a
// partial-alpha ramp so the mascot's anti-aliased outline blends with
// the colored background instead of showing a hard seam.
const FEATHER_LOW = 205;

// ── Asset loading ──────────────────────────────────────────────

let logoCanvas: HTMLCanvasElement | null = null;
let logoLoadFailed = false;
let logoLoadPromise: Promise<HTMLCanvasElement> | null = null;

function loadLogo(): Promise<HTMLCanvasElement> {
  if (logoCanvas) return Promise.resolve(logoCanvas);
  if (logoLoadPromise) return logoLoadPromise;
  logoLoadPromise = decodeAndPunchOutWhite();
  return logoLoadPromise;
}

function decodeAndPunchOutWhite(): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        logoCanvas = buildTransparentLogoCanvas(img);
        resolve(logoCanvas);
      } catch (err) {
        logoLoadFailed = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = (err) => {
      logoLoadFailed = true;
      reject(err instanceof Error ? err : new Error("favicon logo failed to load"));
    };
    img.src = logoUrl;
  });
}

// Copy the decoded <img> into an offscreen canvas and scan every
// pixel, replacing near-white with transparency. The PNG is opaque so
// the background would otherwise cover the state color backing.
function buildTransparentLogoCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const minChannel = Math.min(red, green, blue);
    if (minChannel >= WHITE_TO_ALPHA_THRESHOLD) {
      pixels[i + 3] = 0; // fully transparent
    } else if (minChannel >= FEATHER_LOW) {
      // Linear ramp across the feather band. At minChannel = FEATHER_LOW
      // alpha stays 255; at threshold it drops to 0.
      const ratio = (minChannel - FEATHER_LOW) / (WHITE_TO_ALPHA_THRESHOLD - FEATHER_LOW);
      pixels[i + 3] = Math.round(255 * (1 - ratio));
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ── Drawing primitives ─────────────────────────────────────────

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

// Aspect-preserving letterbox: scale the logo to fit the inner area
// without distorting the mascot, then center the leftover space.
function drawLogoCentered(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, inset: number): void {
  const available = SIZE - inset * 2;
  const aspect = source.width / source.height;
  const drawW = aspect >= 1 ? available : available * aspect;
  const drawH = aspect >= 1 ? available / aspect : available;
  const drawX = inset + (available - drawW) / 2;
  const drawY = inset + (available - drawH) / 2;
  ctx.drawImage(source, drawX, drawY, drawW, drawH);
}

function drawNotificationDot(ctx: CanvasRenderingContext2D): void {
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

// ── Composition ────────────────────────────────────────────────

// Fallback for when the logo PNG fails to decode (or before the first
// decode completes). Mirrors the earlier "M"-on-colored-square design
// so the favicon always has a valid first paint.
function renderFallbackFavicon(ctx: CanvasRenderingContext2D, state: FaviconState, hasNotification: boolean): void {
  drawRoundedRect(ctx, 1, 1, SIZE - 2, SIZE - 2, RADIUS);
  ctx.fillStyle = STATE_COLORS[state];
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M", SIZE / 2, SIZE / 2 + 1);

  if (hasNotification) drawNotificationDot(ctx);
}

function renderLogoFavicon(ctx: CanvasRenderingContext2D, logo: HTMLCanvasElement, state: FaviconState, hasNotification: boolean): void {
  // Colored rounded-square backing — the dynamic cue.
  drawRoundedRect(ctx, 0, 0, SIZE, SIZE, RADIUS);
  ctx.fillStyle = STATE_COLORS[state];
  ctx.fill();

  // Clip subsequent draws to the rounded square so the mascot's
  // anti-aliased edges don't spill past the corners.
  ctx.save();
  drawRoundedRect(ctx, 0, 0, SIZE, SIZE, RADIUS);
  ctx.clip();
  drawLogoCentered(ctx, logo, MASCOT_INSET);
  ctx.restore();

  // Running state: subtle inner glow ring reinforces the pulse cue
  // without overpowering the colored backing.
  if (state === FAVICON_STATES.running) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 2.25, 2.25, SIZE - 4.5, SIZE - 4.5, Math.max(RADIUS - 1, 2));
    ctx.stroke();
  }

  if (hasNotification) drawNotificationDot(ctx);
}

async function renderFavicon(state: FaviconState, hasNotification: boolean): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  if (!logoLoadFailed) {
    try {
      const logo = await loadLogo();
      renderLogoFavicon(ctx, logo, state, hasNotification);
      return canvas.toDataURL("image/png");
    } catch {
      // fall through — renderFallbackFavicon below handles it.
    }
  }

  renderFallbackFavicon(ctx, state, hasNotification);
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
  async function update(): Promise<void> {
    const dataUrl = await renderFavicon(opts.state.value, opts.hasNotification.value);
    applyFavicon(dataUrl);
  }

  watch(
    [opts.state, opts.hasNotification],
    () => {
      update().catch((err) => console.warn("[favicon] render failed", err));
    },
    { immediate: true },
  );
}
