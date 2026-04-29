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
import { createBridgeClient, chunkText, formatAckReply } from "@mulmobridge/client";
import { isObj, parseNotificationRaw, parseFrame, type JsonRecord, type ParsedStatus } from "./parse.js";

const TRANSPORT_ID = "mastodon";
const MAX_STATUS_LEN = 500; // Mastodon's default soft limit; many instances raise to 1000+
const FETCH_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

const instanceUrl = process.env.MASTODON_INSTANCE_URL;
const accessToken = process.env.MASTODON_ACCESS_TOKEN;
if (!instanceUrl || !accessToken) {
  console.error("MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN are required.\nSee README for setup instructions.");
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
let reconnectBackoffMs = RECONNECT_BASE_MS;

mulmo.onPush((pushEvent) => {
  postStatus(pushEvent.chatId, pushEvent.message, null, "direct").catch((err) => console.error(`[mastodon] push send failed: ${err}`));
});

// ── Mastodon API ─────────────────────────────────────────────────

interface PostStatusOptions {
  inReplyTo: string | null;
  visibility: string;
}

async function postOneStatus(chunk: string, opts: PostStatusOptions): Promise<string> {
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
  // Mastodon's create-status endpoint always returns a Status object
  // with an `id`. A missing id means the response is malformed; fail
  // loudly instead of returning null, otherwise postStatus's loop
  // would leave `prevId` stale and all later chunks would chain onto
  // the parent of the failed one. See CodeRabbit outside-diff comment
  // on #611.
  const payload: unknown = await res.json().catch((err) => {
    throw new Error(`Mastodon status POST returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!isObj(payload) || typeof payload.id !== "string") {
    throw new Error("Mastodon status POST response is missing id");
  }
  return payload.id;
}

async function postStatus(chatId: string, text: string, inReplyTo: string | null, visibility: string): Promise<void> {
  // Direct-visibility statuses only deliver to users @-mentioned in
  // the body — a reply carries the mention from the parent via
  // `in_reply_to_id`, but a fresh push (inReplyTo=null) has no parent
  // to inherit from. Prepend the recipient handle so direct pushes
  // actually reach the user. Non-direct visibilities don't need the
  // mention; leave them untouched to avoid noise in public timelines.
  const needsLeadingMention = !inReplyTo && visibility === "direct" && chatId.length > 0;
  const bodyText = needsLeadingMention ? `@${chatId} ${text}` : text;

  // Thread chunk 2+ onto the previous chunk so clients render them as a
  // readable reply chain rather than N parallel replies to the original.
  const chunks = chunkText(bodyText, MAX_STATUS_LEN);
  let prevId: string | null = inReplyTo;
  for (const chunk of chunks) {
    prevId = await postOneStatus(chunk, { inReplyTo: prevId, visibility });
  }
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

function shouldSkipNotification(parsed: ParsedStatus): string | null {
  if (dmOnly && parsed.visibility !== "direct") {
    return `skip non-DM from=${parsed.senderAcct} visibility=${parsed.visibility}`;
  }
  if (!allowAll && !allowedAccts.has(parsed.senderAcct)) {
    return `denied from=${parsed.senderAcct}`;
  }
  return null;
}

async function handleNotification(raw: string): Promise<void> {
  const parsed = parseNotificationRaw(raw);
  if (!parsed) return;

  const skipReason = shouldSkipNotification(parsed);
  if (skipReason) {
    console.log(`[mastodon] ${skipReason}`);
    return;
  }

  // Collect attachments first so image-only DMs (no caption) still flow through.
  const attachments = await collectImageAttachments(parsed.media);
  if (!parsed.text && attachments.length === 0) return;

  console.log(`[mastodon] message from=${parsed.senderAcct} len=${parsed.text.length} attachments=${attachments.length}`);

  try {
    const ack = await mulmo.send(parsed.senderAcct, parsed.text, attachments.length > 0 ? attachments : undefined);
    await postStatus(parsed.senderAcct, formatAckReply(ack), parsed.statusId, parsed.visibility);
  } catch (err) {
    console.error(`[mastodon] message handling failed: ${err}`);
  }
}

// ── WebSocket stream ────────────────────────────────────────────

function connect(): void {
  const socket = new WebSocket(streamUrl);

  socket.on("open", () => {
    console.log(`[mastodon] stream connected: ${instanceUrl}`);
    reconnectBackoffMs = RECONNECT_BASE_MS;
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
    const retryDelayMs = reconnectBackoffMs;
    console.warn(`[mastodon] stream closed code=${code} reason=${reason.toString().slice(0, 100)}; reconnecting in ${retryDelayMs}ms`);
    setTimeout(() => {
      reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, RECONNECT_MAX_MS);
      connect();
    }, retryDelayMs);
  });
}

// ── Main ─────────────────────────────────────────────────────────

console.log("MulmoClaude Mastodon bridge");
console.log(`Instance: ${instanceUrl}`);
console.log(`DM-only: ${dmOnly}`);
console.log(`Allowlist: ${allowAll ? "(all)" : [...allowedAccts].join(", ")}`);

connect();
