#!/usr/bin/env node
// @mulmobridge/mastodon — Mastodon bridge for MulmoClaude.
//
// Subscribes to the user notification stream over WebSocket, picks up
// mentions (which include DMs, since Mastodon DMs are mentions with
// visibility=direct), forwards them to MulmoClaude, and replies as a
// status with in_reply_to_id set and visibility inherited from the
// incoming status.
//
// Required env vars:
//   MASTODON_INSTANCE_URL — e.g. https://mastodon.social
//   MASTODON_ACCESS_TOKEN — bot access token (Preferences → Development
//                           → New application; scopes: read + write + push)
//
// Optional:
//   MASTODON_ALLOWED_ACCTS — CSV of acct strings allowed to converse
//                            (e.g. "alice@mastodon.social,bob@mstdn.jp").
//                            Empty / unset = allow everyone.
//   MASTODON_DM_ONLY       — "true" (default) to only handle direct-
//                            visibility statuses. Set to "false" to also
//                            pick up public / unlisted mentions.

import "dotenv/config";
import WebSocket from "ws";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "mastodon";
const MAX_STATUS_LEN = 500; // Mastodon's default soft limit; many instances raise to 1000+
const FETCH_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

const instanceUrl = process.env.MASTODON_INSTANCE_URL;
const accessToken = process.env.MASTODON_ACCESS_TOKEN;
if (!instanceUrl || !accessToken) {
  console.error("MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const allowedAccts = new Set(
  (process.env.MASTODON_ALLOWED_ACCTS ?? "")
    .split(",")
    .map((acct) => acct.trim())
    .filter(Boolean),
);
const allowAll = allowedAccts.size === 0;
const dmOnly = (process.env.MASTODON_DM_ONLY ?? "true").toLowerCase() !== "false";

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });
const apiBase = `${instanceUrl.replace(/\/$/, "")}/api/v1`;
const streamUrl = `${instanceUrl.replace(/^http/, "ws").replace(/\/$/, "")}/api/v1/streaming?stream=user:notification&access_token=${encodeURIComponent(accessToken)}`;

mulmo.onPush((pushEvent) => {
  postStatus(pushEvent.chatId, pushEvent.message, null, "direct").catch((err) => console.error(`[mastodon] push send failed: ${err}`));
});

// ── Mastodon API ─────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function isObj(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

interface PostStatusOptions {
  inReplyTo: string | null;
  visibility: string;
}

async function postOneStatus(chunk: string, opts: PostStatusOptions): Promise<string | null> {
  const body: JsonRecord = { status: chunk, visibility: opts.visibility };
  if (opts.inReplyTo) body.in_reply_to_id = opts.inReplyTo;
  let res: Response;
  try {
    res = await fetch(`${apiBase}/statuses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Mastodon status POST network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mastodon status POST failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const payload: unknown = await res.json().catch(() => null);
  if (isObj(payload) && typeof payload.id === "string") return payload.id;
  return null;
}

async function postStatus(__chatId: string, text: string, inReplyTo: string | null, visibility: string): Promise<void> {
  // Thread chunk 2+ onto the previous chunk so clients render them as a
  // readable reply chain rather than N parallel replies to the original.
  const chunks = chunkText(text, MAX_STATUS_LEN);
  let prevId: string | null = inReplyTo;
  for (const chunk of chunks) {
    const postedId = await postOneStatus(chunk, { inReplyTo: prevId, visibility });
    if (postedId) prevId = postedId;
  }
}

// ── HTML → plain text ───────────────────────────────────────────

function stripTags(input: string): string {
  // Walk char-by-char so we avoid regex backtracking on malformed HTML.
  const out: string[] = [];
  let inTag = false;
  for (const char of input) {
    if (char === "<") inTag = true;
    else if (char === ">") inTag = false;
    else if (!inTag) out.push(char);
  }
  return out.join("");
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  const withNewlines = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n");
  return decodeEntities(stripTags(withNewlines)).trim();
}

function stripLeadingMentions(text: string): string {
  // Remove one or more leading "@acct" / "@acct@instance" tokens
  return text.replace(/^(?:@[A-Za-z0-9_.]+(?:@[A-Za-z0-9_.-]+)?\s+)+/, "").trim();
}

// ── Attachment fetching ─────────────────────────────────────────

interface MulmoAttachment {
  mimeType: string;
  data: string;
  filename?: string;
}

async function fetchImageAttachment(url: string): Promise<MulmoAttachment | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType, data: buf.toString("base64") };
  } catch (err) {
    console.warn(`[mastodon] image fetch failed: ${err}`);
    return null;
  }
}

async function collectImageAttachments(media: unknown): Promise<MulmoAttachment[]> {
  if (!Array.isArray(media)) return [];
  const out: MulmoAttachment[] = [];
  for (const item of media) {
    if (!isObj(item) || item.type !== "image" || typeof item.url !== "string") continue;
    const att = await fetchImageAttachment(item.url);
    if (att) out.push(att);
  }
  return out;
}

// ── Notification handling ───────────────────────────────────────

interface ParsedStatus {
  statusId: string;
  senderAcct: string;
  visibility: string;
  text: string;
  media: unknown;
}

function parseMentionStatus(notification: JsonRecord): ParsedStatus | null {
  if (notification.type !== "mention") return null;
  const status = notification.status;
  if (!isObj(status)) return null;
  const statusId = typeof status.id === "string" ? status.id : "";
  const visibility = typeof status.visibility === "string" ? status.visibility : "public";
  const account = isObj(status.account) ? status.account : null;
  const senderAcct = account && typeof account.acct === "string" ? account.acct : "";
  const content = typeof status.content === "string" ? status.content : "";
  const text = stripLeadingMentions(htmlToText(content));
  if (!statusId || !senderAcct) return null;
  return { statusId, senderAcct, visibility, text, media: status.media_attachments };
}

async function handleNotification(raw: string): Promise<void> {
  let notif: unknown;
  try {
    notif = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isObj(notif)) return;
  const parsed = parseMentionStatus(notif);
  if (!parsed) return;

  if (dmOnly && parsed.visibility !== "direct") {
    console.log(`[mastodon] skip non-DM from=${parsed.senderAcct} visibility=${parsed.visibility}`);
    return;
  }
  if (!allowAll && !allowedAccts.has(parsed.senderAcct)) {
    console.log(`[mastodon] denied from=${parsed.senderAcct}`);
    return;
  }

  // Collect attachments first so image-only DMs (no caption) still flow through.
  const attachments = await collectImageAttachments(parsed.media);
  if (!parsed.text && attachments.length === 0) return;

  console.log(`[mastodon] message from=${parsed.senderAcct} len=${parsed.text.length} attachments=${attachments.length}`);

  try {
    const ack = await mulmo.send(parsed.senderAcct, parsed.text, attachments.length > 0 ? attachments : undefined);
    if (ack.ok) {
      await postStatus(parsed.senderAcct, ack.reply ?? "", parsed.statusId, parsed.visibility);
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await postStatus(parsed.senderAcct, `Error${status}: ${ack.error ?? "unknown"}`, parsed.statusId, parsed.visibility);
    }
  } catch (err) {
    console.error(`[mastodon] message handling failed: ${err}`);
  }
}

// ── WebSocket stream ────────────────────────────────────────────

interface StreamFrame {
  event: string;
  payload: string;
}

function parseFrame(raw: unknown): StreamFrame | null {
  if (typeof raw !== "string") return null;
  try {
    const msg: unknown = JSON.parse(raw);
    if (!isObj(msg)) return null;
    const event = typeof msg.event === "string" ? msg.event : "";
    const payload = typeof msg.payload === "string" ? msg.payload : "";
    if (!event || !payload) return null;
    return { event, payload };
  } catch {
    return null;
  }
}

function connect(): void {
  const socket = new WebSocket(streamUrl);
  let backoffMs = RECONNECT_BASE_MS;

  socket.on("open", () => {
    console.log(`[mastodon] stream connected: ${instanceUrl}`);
    backoffMs = RECONNECT_BASE_MS;
  });

  socket.on("message", (buffer) => {
    const frame = parseFrame(buffer.toString());
    if (!frame || frame.event !== "notification") return;
    handleNotification(frame.payload).catch((err) => console.error(`[mastodon] notification handler error: ${err}`));
  });

  socket.on("error", (err) => {
    console.error(`[mastodon] stream error: ${err.message}`);
  });

  socket.on("close", (code, reason) => {
    console.warn(`[mastodon] stream closed code=${code} reason=${reason.toString().slice(0, 100)}; reconnecting in ${backoffMs}ms`);
    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
      connect();
    }, backoffMs);
  });
}

// ── Main ─────────────────────────────────────────────────────────

console.log("MulmoClaude Mastodon bridge");
console.log(`Instance: ${instanceUrl}`);
console.log(`DM-only: ${dmOnly}`);
console.log(`Allowlist: ${allowAll ? "(all)" : [...allowedAccts].join(", ")}`);

connect();
