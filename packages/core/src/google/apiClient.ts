// Shared REST plumbing for the Google APIs this engine wraps (Calendar,
// Tasks, Drive). Plain fetch instead of the `googleapis` SDK — a handful of
// endpoints don't justify the dependency (see
// plans/done/feat-google-oauth-calendar.md).
import { errorMessage, isRecord, ONE_SECOND_MS, truncate } from "./util.js";
import { fetchWithTimeout } from "../utils/fetch.js";

export const GOOGLE_API_TIMEOUT_MS = 30 * ONE_SECOND_MS;
const ERROR_BODY_MAX_CHARS = 300;
const HTTP_FORBIDDEN = 403;
export const DEFAULT_LIST_MAX_RESULTS = 10;
export const MAX_LIST_RESULTS = 50;

/** Carries the HTTP status so callers can branch on it (e.g. an expired
 *  calendar syncToken answers 410) without parsing the message. */
export class GoogleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export const isGoogleApiError = (value: unknown): value is GoogleApiError => value instanceof GoogleApiError;

/** 403 usually means the API is not enabled for the user's Cloud project —
 *  name the API so the agent's recovery guidance can be specific. */
export const googleApiError = (apiLabel: string, status: number, body: string): GoogleApiError => {
  const hint = status === HTTP_FORBIDDEN ? ` (is the ${apiLabel} enabled for the Cloud project?)` : "";
  const detail = body ? ` — ${truncate(body, ERROR_BODY_MAX_CHARS)}` : "";
  return new GoogleApiError(status, `${apiLabel}: HTTP ${status}${hint}${detail}`);
};

export interface GoogleRequestInit {
  method?: string;
  body?: string;
  /** Overrides the default JSON content type (multipart upload, …). */
  contentType?: string;
  /** Response is not JSON (Drive media download) — return the raw text. */
  expectText?: boolean;
}

export async function googleRequest(apiLabel: string, accessToken: string, url: string, init: GoogleRequestInit = {}): Promise<unknown> {
  const { contentType = "application/json", expectText = false, ...rest } = init;
  const response = await fetchWithTimeout(url, {
    ...rest,
    timeoutMs: GOOGLE_API_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
  });
  if (!response.ok) {
    const body = await response.text().catch((err: unknown) => errorMessage(err));
    throw googleApiError(apiLabel, response.status, body);
  }
  if (expectText) return await response.text();
  // 204 (Drive delete, …) has no body to parse.
  if (response.status === 204) return {};
  return await response.json();
}

export const stringField = (record: Record<string, unknown>, key: string): string => (typeof record[key] === "string" ? record[key] : "");

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export const itemsOf = (value: unknown): unknown[] => {
  const record = asRecord(value);
  return Array.isArray(record.items) ? record.items : [];
};
