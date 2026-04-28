import { apiGet, apiPost, type ApiResult } from "../../../utils/api.js";
import { API_ROUTES } from "../../../config/apiRoutes.js";

export interface SnapshotSummary {
  stamp: string;
  bytes: number;
  ts: string;
  editor: "user" | "llm" | "system";
  sessionId?: string;
  reason?: string;
}

export interface SnapshotContent extends SnapshotSummary {
  meta: Record<string, unknown>;
  body: string;
}

interface ListResponse {
  slug: string;
  snapshots: SnapshotSummary[];
}

interface ReadResponse {
  slug: string;
  snapshot: SnapshotContent;
}

interface RestoreResponse {
  slug: string;
  restored: { fromStamp: string };
}

function fillRoute(template: string, params: Record<string, string>): string {
  return template.replace(/:([a-zA-Z]+)/g, (_, key: string) => encodeURIComponent(params[key]));
}

export function fetchHistoryList(slug: string): Promise<ApiResult<ListResponse>> {
  return apiGet<ListResponse>(fillRoute(API_ROUTES.wiki.pageHistory, { slug }));
}

export function fetchHistorySnapshot(slug: string, stamp: string): Promise<ApiResult<ReadResponse>> {
  return apiGet<ReadResponse>(fillRoute(API_ROUTES.wiki.pageHistorySnapshot, { slug, stamp }));
}

export function restoreHistorySnapshot(slug: string, stamp: string): Promise<ApiResult<RestoreResponse>> {
  return apiPost<RestoreResponse>(fillRoute(API_ROUTES.wiki.pageHistoryRestore, { slug, stamp }));
}
