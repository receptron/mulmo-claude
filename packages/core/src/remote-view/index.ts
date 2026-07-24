// The remote custom-view contract (phase 3 — plans/done/feat-remote-custom-view.md).
//
// Browser-safe single source of truth shared by the host server (which wraps
// the view HTML into a sandboxed srcdoc), the desktop phone-frame preview, and
// the mulmoserver mobile client (post-publish). A remote view runs on a phone
// that can reach the internet but NOT the host's localhost, so — unlike the
// desktop custom view (token + fetch to the view-data route) — its records
// arrive over an async postMessage bridge owned by the parent page, and its
// CSP locks `connect-src` to 'none' entirely.
//
// BACKWARD COMPATIBILITY — this bridge is a frozen public contract. Remote
// views are LLM-authored HTML files persisted in users' workspaces
// (`data/skills/*/views/*.html`), written against
// `packages/core/assets/helps/custom-view-remote.md`; they cannot be
// migrated centrally and must keep working across host upgrades and any
// storage-virtualization work underneath. Evolve only by backward-compatible
// supersets, the way protocol v2 added the mutate pair: bump
// `REMOTE_VIEW_PROTOCOL`, add new message types / optional fields — never
// repurpose an existing message type, change the `getItems` page shape
// (`{ items, total, offset, limit }`), or tighten limits a shipped view may
// already rely on.

import { projectRecordFields } from "../collection/core/project";

/** Bump when the bootstrap/message contract changes shape; the bootstrap
 *  exposes it as `__MC_VIEW.protocol` so a parent can refuse a stale view.
 *  v2 (phase 4) adds the mutate pair below — a backward-compatible superset,
 *  so a v1 (read-only) parent still serves get-items/start-chat unchanged. */
export const REMOTE_VIEW_PROTOCOL = 2;

/** postMessage types between the sandboxed view and its parent page.
 *  `startChat` reuses the desktop custom-view message type on purpose — the
 *  desktop parent already understands it. */
export const REMOTE_VIEW_MESSAGES = {
  /** view → parent: request one page of records ({ requestId, offset, limit, fields }). */
  getItems: "mc-remote-get-items",
  /** parent → view: the reply ({ requestId, ok, page | error }). */
  items: "mc-remote-items",
  /** view → parent: mutate one record ({ requestId, op: "update"|"delete", id, patch? }). */
  mutate: "mc-remote-mutate",
  /** parent → view: the mutate reply ({ requestId, ok, result | error }). */
  mutateResult: "mc-remote-mutate-result",
  /** view → parent: open a new chat with a prefilled, NOT auto-sent draft. */
  startChat: "mc-start-chat",
} as const;

/** Pagination defaults — mirrored by the phase-2 record handlers
 *  (`server/remoteHost/handlers/collectionPage.ts` imports these) so a view
 *  page can never outgrow what the command channel itself serves. */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** Hard cap on the wrapped srcdoc: it travels to the phone INSIDE a Firestore
 *  command document (1 MiB total), so leave envelope headroom. */
export const REMOTE_VIEW_MAX_BYTES = 900_000;

/** Hard cap on ONE `getItems` page (phase 5 — plans/done/feat-remote-view-images.md).
 *  Same 1 MiB command-document envelope as the srcdoc: when a view inlines image
 *  fields as `data:` URLs, the host stops inlining once the serialized page would
 *  exceed this, leaving the remaining image fields as their original path (which
 *  the view renders as a placeholder). Guards the doc-write from ever failing. */
export const REMOTE_VIEW_ITEMS_MAX_BYTES = 900_000;

/** Default longest-edge (px) a remote view's inlined image thumbnail is
 *  downscaled to; a view may override via `imageMaxEdge`. */
export const DEFAULT_IMAGE_MAX_EDGE = 512;

/** In-iframe `getItems` timeout — matches the remote client's `callHost`
 *  response timeout so the two layers give up together. */
const GET_ITEMS_TIMEOUT_MS = 30_000;

// CDN allowlist for sandboxed LLM-authored HTML (script/style/font loads).
// Shared with the desktop preview + custom-view CSPs
// (src/utils/html/previewCsp.ts re-exports it as its default) so the two
// policies can't drift. Keep the list audited — every entry is a potential
// supply-chain surface; the hosts here are reputable infrastructure that does
// not expose per-request logs to third parties.
export const SANDBOXED_VIEW_CDN_ALLOWLIST: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  // Plotly's first-party CDN — the LLM defaults to it for Plotly charts.
  "https://cdn.plot.ly",
];

const toInt = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.floor(num) : null;
};

/** Coerce a channel/postMessage offset (arrives as untyped JSON) to a non-negative int. */
export const clampOffset = (value: unknown): number => Math.max(0, toInt(value) ?? 0);

/** Read a channel/postMessage identifier (a slug, a view id) as a string.
 *  Params arrive as untyped JSON, so a caller can send anything; `String(...)`
 *  turned an object into the literal "[object Object]", which then travelled on
 *  as if the caller had asked for a collection by that name — surfacing as
 *  `collection '[object Object]' not found` rather than a bad-request. A value
 *  with no string form is simply absent. */
export const readIdParam = (value: unknown): string => (typeof value === "string" ? value : "");

/** Coerce a channel/postMessage limit to [1, MAX_PAGE_LIMIT] (default 50). */
export const clampLimit = (value: unknown): number => {
  const num = toInt(value);
  if (num === null || num <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(num, MAX_PAGE_LIMIT);
};

/** Clamp an `imageMaxEdge` (arrives as untyped schema/JSON) to [64, 1024];
 *  default 512. Keeps a runaway edge from defeating the thumbnail's purpose. */
export const clampImageMaxEdge = (value: unknown): number => {
  const num = toInt(value);
  if (num === null || num <= 0) return DEFAULT_IMAGE_MAX_EDGE;
  return Math.min(Math.max(num, 64), 1024);
};

/** Coerce a `fields` projection list from untyped message JSON. */
export const normalizeFields = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
};

export type RemoteViewItem = Record<string, unknown>;

/** One page of records, the resolved value of the view's `getItems()`. Same
 *  shape as the phase-2 `getCollection` page so a parent can pass a channel
 *  page straight through. */
export interface RemoteViewPage {
  items: RemoteViewItem[];
  total: number;
  offset: number;
  limit: number;
}

/** A normalized (clamped, fields-cleaned) page request handed to a parent's
 *  `getPage` — `handleRemoteViewMessage` does the coercion so every parent
 *  answers identical values. */
export interface RemoteViewPageRequest {
  offset: number;
  limit: number;
  fields?: string[];
}

/** Keep only `fields` (+ always the primary key) on each record. Parents apply
 *  this uniformly — the desktop preview via `pageFromItems`, the phone parent
 *  over the page it fetched through the channel — so a view sees the same
 *  projection everywhere. No-op without `fields`; an EMPTY `fields` array is
 *  also a no-op here (frozen bridge behavior — the shared helper would
 *  project down to the primary key alone). */
export function projectItems(items: RemoteViewItem[], fields: string[] | undefined, primaryKey: string): RemoteViewItem[] {
  if (!fields || fields.length === 0) return items;
  return projectRecordFields(items, fields, primaryKey);
}

/** Answer a page request from an already-loaded record array (the desktop
 *  preview's data source): slice + project. Observable behavior matches the
 *  phone paging over the command channel. */
export function pageFromItems(items: RemoteViewItem[], request: RemoteViewPageRequest, primaryKey: string): RemoteViewPage {
  const pageItems = items.slice(request.offset, request.offset + request.limit);
  return { items: projectItems(pageItems, request.fields, primaryKey), total: items.length, offset: request.offset, limit: request.limit };
}

/**
 * CSP for a remote (mobile) custom view. Stricter than the desktop custom-view
 * policy: the view's data arrives over postMessage, so `connect-src` is
 * `'none'` — no fetch / XHR / WebSocket / sendBeacon to ANY origin, which
 * closes the bidirectional-exfiltration channel completely (there is no token
 * to steal either). Script/style/font keep the curated CDN allowlist (the
 * phone can reach the internet; only the host is unreachable), and
 * `img-src`/`media-src` allow any `https:` host so record image/media URLs
 * render — the same knowingly-accepted one-way GET-exfil tradeoff as the
 * desktop policy (see buildCustomViewCsp in src/utils/html/previewCsp.ts).
 */
export function buildRemoteViewCsp(cdns: readonly string[] = SANDBOXED_VIEW_CDN_ALLOWLIST): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    `img-src ${cdnList} data: blob: https:`,
    "media-src https: data: blob:",
    "connect-src 'none'",
  ].join("; ");
}

/** The in-iframe bootstrap installed before any of the view's own scripts.
 *  Owns the fiddly part of the contract — request/response correlation — so an
 *  LLM-authored view only ever awaits `__MC_VIEW.getItems(...)` /
 *  `.updateItem(...)` / `.deleteItem(...)`:
 *
 *  - `getItems({ offset, limit, fields })`: posts an `mc-remote-get-items`
 *    with a fresh `requestId`, resolves on the matching `mc-remote-items`
 *    reply (validated to come from `window.parent`), rejects on `ok: false`
 *    or after 30 s. targetOrigin `'*'` is safe: the request carries no secret
 *    and the parent is by construction the party supplying the data.
 *  - `updateItem(id, patch)` / `deleteItem(id)` (phase 4): post an
 *    `mc-remote-mutate` and resolve on the matching `mc-remote-mutate-result`,
 *    sharing the same `call()` correlation as `getItems`. Installed ONLY when
 *    the host set `writable` (the view declared `editableFields`/`allowDelete`);
 *    otherwise both reject `"this view is read-only"` so a mis-declared view
 *    fails loudly instead of silently no-op'ing. The HOST still re-derives and
 *    enforces the write policy — `writable` only gates the client surface.
 *  - `startChat(prompt, role)`: same message type + semantics as the desktop
 *    bridge — the parent opens a new chat with `prompt` prefilled as an
 *    editable draft, never auto-sent.
 *  - `t(key, named)`: the same vue-i18n-compatible dict helper as the desktop
 *    bootstrap (named interpolation only), over the host-picked `dict`.
 *
 *  Self-contained one-line string (no `<`, no `</script>`, `${}` only for the
 *  interpolated constants). */
function remoteViewBootstrap(): string {
  return `(function(){var v=window.__MC_VIEW,seq=0,pend={};window.addEventListener('message',function(e){if(e.source!==window.parent)return;var d=e.data;if(!d)return;if(d.type!=='${REMOTE_VIEW_MESSAGES.items}'&&d.type!=='${REMOTE_VIEW_MESSAGES.mutateResult}')return;var p=pend[d.requestId];if(!p)return;delete pend[d.requestId];clearTimeout(p.timer);if(d.ok)p.resolve(d.type==='${REMOTE_VIEW_MESSAGES.items}'?d.page:d.result);else p.reject(new Error(typeof d.error==='string'?d.error:'request failed'));});function call(type,payload){return new Promise(function(resolve,reject){var id='q'+(++seq);var timer=setTimeout(function(){delete pend[id];reject(new Error(type+' timed out'));},${GET_ITEMS_TIMEOUT_MS});pend[id]={resolve:resolve,reject:reject,timer:timer};var m={type:type,slug:v.slug,requestId:id};for(var k in payload){m[k]=payload[k];}window.parent.postMessage(m,'*');});}v.getItems=function(opts){opts=opts&&typeof opts==='object'?opts:{};return call('${REMOTE_VIEW_MESSAGES.getItems}',{offset:opts.offset,limit:opts.limit,fields:opts.fields});};if(v.writable){v.updateItem=function(id,patch){return call('${REMOTE_VIEW_MESSAGES.mutate}',{op:'update',id:String(id),patch:patch&&typeof patch==='object'?patch:{}});};v.deleteItem=function(id){return call('${REMOTE_VIEW_MESSAGES.mutate}',{op:'delete',id:String(id)});};}else{v.updateItem=v.deleteItem=function(){return Promise.reject(new Error('this view is read-only'));};}v.startChat=function(prompt,role){window.parent.postMessage({type:'${REMOTE_VIEW_MESSAGES.startChat}',slug:v.slug,prompt:String(prompt),role:typeof role==='string'?role:undefined},'*');};v.dict=v.dict||{};v.t=function(key,named){var s=v.dict[key];if(typeof s!=='string')return typeof key==='string'?key:String(key);if(!named||typeof named!=='object')return s;return s.replace(/\\{(\\w+)\\}/g,function(m,n){var x=named[n];return x==null?m:String(x);});};})();`;
}

/** What the host injects into `window.__MC_VIEW` — note what is ABSENT
 *  compared to the desktop boot: no token, no dataUrl, no origin. */
export interface RemoteViewBoot {
  slug: string;
  /** Locale the dict was picked for; empty string when no translations. */
  locale?: string;
  /** Host-picked, locale-filtered flat string map (same contract as the
   *  desktop custom-view dict). */
  dict?: Record<string, string>;
  /** True when the view declared a mutable surface (`editableFields` and/or
   *  `allowDelete`). Gates the client-side `updateItem`/`deleteItem` install
   *  only — the host re-enforces the actual policy on every mutate. */
  writable?: boolean;
}

/** Wrap a view's HTML into the sandboxed srcdoc: CSP meta + `__MC_VIEW` boot +
 *  bridge bootstrap injected at the start of `<head>` (before any view
 *  script). Runs HOST-side (`getRemoteView`) so the phone and the desktop
 *  preview receive the identical finished artifact. */
export function buildRemoteViewSrcdoc(html: string, boot: RemoteViewBoot): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${buildRemoteViewCsp()}">`;
  // `<`-escape the JSON so a hostile slug/dict string can't break out of the
  // <script> element (same escape as the desktop srcdoc builder).
  const json = JSON.stringify({
    slug: boot.slug,
    locale: boot.locale ?? "",
    dict: boot.dict ?? {},
    target: "mobile",
    protocol: REMOTE_VIEW_PROTOCOL,
    writable: boot.writable ?? false,
  }).replace(/</g, "\\u003c");
  const injection = `${cspMeta}<script>window.__MC_VIEW=${json};${remoteViewBootstrap()}</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${injection}`);
  }
  return `<!DOCTYPE html><html><head>${injection}</head><body>${html}</body></html>`;
}

/** A normalized mutate request handed to a parent's `onMutate`
 *  (`handleRemoteViewMessage` validates op/id/patch first). `update` carries a
 *  partial record; the HOST decides which keys are actually writable. */
export type RemoteViewMutateRequest = { op: "update"; id: string; patch: Record<string, unknown> } | { op: "delete"; id: string };

/** The resolved value of a mutate: the merged record for an update, the removed
 *  id for a delete. Sent back to the view as the `mc-remote-mutate-result`
 *  `result`. */
export interface RemoteViewMutateResult {
  item?: RemoteViewItem;
  id?: string;
}

/** What a parent page provides to answer the sandboxed view. Deliberately
 *  minimal — exactly the phone runtime's capabilities, nothing more, so the
 *  desktop preview can never exceed what works on the phone. */
export interface RemoteViewBridgeHandlers {
  slug: string;
  /** Answer one normalized page request (already clamped + fields-cleaned). */
  getPage: (request: RemoteViewPageRequest) => Promise<RemoteViewPage> | RemoteViewPage;
  /** Apply one normalized mutate (update/delete). Omit on a read-only parent —
   *  the handler then replies `ok: false, "this view is read-only"`. The parent
   *  forwards to the host (which enforces the write policy authoritatively). */
  onMutate?: (request: RemoteViewMutateRequest) => Promise<RemoteViewMutateResult> | RemoteViewMutateResult;
  /** Relay a `startChat` draft; omit on a parent without a chat surface. */
  onStartChat?: (prompt: string, role?: string) => void;
}

/** Coerce an untyped `mc-remote-mutate` payload to a normalized request, or
 *  null when it is malformed (unknown op, missing id, non-object update patch —
 *  the parent then replies with an `"invalid mutate request"` error). */
export function normalizeMutate(data: { op?: unknown; id?: unknown; patch?: unknown }): RemoteViewMutateRequest | null {
  const itemId = typeof data.id === "string" ? data.id : typeof data.id === "number" && Number.isFinite(data.id) ? String(data.id) : "";
  if (!itemId) return null;
  if (data.op === "delete") return { op: "delete", id: itemId };
  if (data.op === "update") {
    if (typeof data.patch !== "object" || data.patch === null || Array.isArray(data.patch)) return null;
    return { op: "update", id: itemId, patch: data.patch as Record<string, unknown> };
  }
  return null;
}

async function answerGetItems(requestId: string, request: RemoteViewPageRequest, handlers: RemoteViewBridgeHandlers, reply: RemoteViewReply): Promise<void> {
  try {
    const page = await handlers.getPage(request);
    reply({ type: REMOTE_VIEW_MESSAGES.items, requestId, ok: true, page });
  } catch (err) {
    reply({ type: REMOTE_VIEW_MESSAGES.items, requestId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Validate + dispatch a `mc-remote-mutate` payload, replying on every path
 *  (malformed request, read-only parent, handler success/throw). Split out of
 *  `handleRemoteViewMessage` so that function stays under the 20-line limit. */
async function answerMutate(
  requestId: string,
  msg: { op?: unknown; id?: unknown; patch?: unknown },
  handlers: RemoteViewBridgeHandlers,
  reply: RemoteViewReply,
): Promise<void> {
  const request = normalizeMutate(msg);
  if (!request) {
    reply({ type: REMOTE_VIEW_MESSAGES.mutateResult, requestId, ok: false, error: "invalid mutate request" });
    return;
  }
  if (!handlers.onMutate) {
    reply({ type: REMOTE_VIEW_MESSAGES.mutateResult, requestId, ok: false, error: "this view is read-only" });
    return;
  }
  try {
    const result = await handlers.onMutate(request);
    reply({ type: REMOTE_VIEW_MESSAGES.mutateResult, requestId, ok: true, result });
  } catch (err) {
    reply({ type: REMOTE_VIEW_MESSAGES.mutateResult, requestId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

type RemoteViewReply = (message: Record<string, unknown>) => void;

/**
 * Handle one message-event payload from a sandboxed remote view. DOM- and
 * framework-free: the caller owns the `message` listener (and MUST verify
 * `event.source === iframe.contentWindow` before calling), `reply` posts the
 * response back into the iframe (targetOrigin `"*"` — the sandboxed document's
 * origin is opaque, so nothing else can match). Returns true when the payload
 * was a remote-view request for this slug (callers ignore everything else).
 */
export async function handleRemoteViewMessage(data: unknown, handlers: RemoteViewBridgeHandlers, reply: RemoteViewReply): Promise<boolean> {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as {
    type?: unknown;
    slug?: unknown;
    requestId?: unknown;
    offset?: unknown;
    limit?: unknown;
    fields?: unknown;
    op?: unknown;
    id?: unknown;
    patch?: unknown;
    prompt?: unknown;
    role?: unknown;
  };
  if (msg.slug !== handlers.slug) return false;
  if (msg.type === REMOTE_VIEW_MESSAGES.startChat) {
    const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
    if (prompt) handlers.onStartChat?.(prompt, typeof msg.role === "string" ? msg.role : undefined);
    return true;
  }
  if (msg.type === REMOTE_VIEW_MESSAGES.mutate && typeof msg.requestId === "string") {
    await answerMutate(msg.requestId, msg, handlers, reply);
    return true;
  }
  if (msg.type !== REMOTE_VIEW_MESSAGES.getItems || typeof msg.requestId !== "string") return false;
  const request: RemoteViewPageRequest = { offset: clampOffset(msg.offset), limit: clampLimit(msg.limit), fields: normalizeFields(msg.fields) };
  await answerGetItems(msg.requestId, request, handlers, reply);
  return true;
}
