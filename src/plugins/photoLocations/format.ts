import { formatDate } from "../../utils/format/date";

// Display/validation guards for sidecar fields. The server validates on
// write (`isValidCoord` in server/utils/exif.ts), but a hand-edited sidecar
// can ship anything past the types — one bad row must degrade to "—", not
// crash the View or render a plausible-looking wrong value.

export const fmtCoord = (value: unknown): string => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : "—");

export const fmtAltitude = (value: unknown): string | null => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(0) : null);

export const fmtTakenAt = (iso: string | undefined): string => {
  if (!iso) return "—";
  return Number.isNaN(new Date(iso).getTime()) ? "—" : formatDate(iso);
};

const isValidLat = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 90;
const isValidLng = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 180;

// Mirrors the server's write-side rule, including the 0,0 rejection — a
// null-island pair only ever comes from a corrupted/hand-edited sidecar.
export const hasValidCoords = (exif: { lat?: unknown; lng?: unknown }): boolean => {
  if (!isValidLat(exif.lat) || !isValidLng(exif.lng)) return false;
  return !(exif.lat === 0 && exif.lng === 0);
};
