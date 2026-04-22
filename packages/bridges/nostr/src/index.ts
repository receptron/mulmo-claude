#!/usr/bin/env node
// @mulmobridge/nostr — Nostr encrypted DM bridge for MulmoClaude.
//
// Connects to a list of Nostr relays over WebSocket, subscribes to
// kind=4 (encrypted DM) events tagged to our pubkey, decrypts with
// NIP-04 (ECDH + AES-CBC), forwards to MulmoClaude, and replies as a
// signed kind=4 event broadcast to the same relays.
//
// Outbound-only — no public URL needed. The bot's identity is its
// private key; multiple clients / relays can observe the same identity
// concurrently without extra setup.
//
// Required env vars:
//   NOSTR_PRIVATE_KEY — 64-char hex secret key (nsec1… also accepted)
//   NOSTR_RELAYS      — CSV of wss:// relay URLs, e.g.
//                       wss://relay.damus.io,wss://nos.lol,wss://relay.snort.social
//
// Optional:
//   NOSTR_ALLOWED_PUBKEYS — CSV of hex pubkeys allowed (empty = all)

import "dotenv/config";
import { SimplePool, finalizeEvent, getPublicKey, nip04, nip19, type Event } from "nostr-tools";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "nostr";
const MAX_DM_LEN = 50_000;
const KIND_ENCRYPTED_DM = 4;
const SUBSCRIBE_SINCE_LOOKBACK_SEC = 60; // ignore events older than N seconds on startup

const rawKey = process.env.NOSTR_PRIVATE_KEY;
const relayCsv = process.env.NOSTR_RELAYS;
if (!rawKey || !relayCsv) {
  console.error("NOSTR_PRIVATE_KEY and NOSTR_RELAYS are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const relays = relayCsv
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const privateKeyBytes = decodeKey(rawKey);
const publicKey = getPublicKey(privateKeyBytes);

const allowedPubkeys = new Set(
  (process.env.NOSTR_ALLOWED_PUBKEYS ?? "")
    .split(",")
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean),
);
const allowAll = allowedPubkeys.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });
const pool = new SimplePool();

mulmo.onPush((pushEvent) => {
  sendDm(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[nostr] push send failed: ${err}`));
});

// ── Key handling ────────────────────────────────────────────────

function decodeKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.startsWith("nsec1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") {
      console.error(`Expected nsec bech32 key, got type ${decoded.type}`);
      process.exit(1);
    }
    return decoded.data;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    console.error("NOSTR_PRIVATE_KEY must be 64-char hex or nsec1...");
    process.exit(1);
  }
  const out = new Uint8Array(32);
  for (let idx = 0; idx < 32; idx++) {
    out[idx] = parseInt(trimmed.slice(idx * 2, idx * 2 + 2), 16);
  }
  return out;
}

// ── Send ────────────────────────────────────────────────────────

async function sendDm(recipientPubkey: string, text: string): Promise<void> {
  const chunks = chunkText(text, MAX_DM_LEN);
  for (const chunk of chunks) {
    try {
      const ciphertext = await nip04.encrypt(privateKeyBytes, recipientPubkey, chunk);
      const signed = finalizeEvent(
        {
          kind: KIND_ENCRYPTED_DM,
          created_at: Math.floor(Date.now() / 1_000),
          tags: [["p", recipientPubkey]],
          content: ciphertext,
        },
        privateKeyBytes,
      );
      await Promise.any(pool.publish(relays, signed));
    } catch (err) {
      console.error(`[nostr] send error: ${err}`);
    }
  }
}

// ── Receive ─────────────────────────────────────────────────────

async function handleEvent(evt: Event): Promise<void> {
  if (evt.kind !== KIND_ENCRYPTED_DM) return;
  if (evt.pubkey === publicKey) return; // ignore our own echoes

  const senderPubkey = evt.pubkey.toLowerCase();
  if (!allowAll && !allowedPubkeys.has(senderPubkey)) {
    console.log(`[nostr] denied from=${senderPubkey.slice(0, 12)}…`);
    return;
  }

  let plaintext: string;
  try {
    plaintext = await nip04.decrypt(privateKeyBytes, evt.pubkey, evt.content);
  } catch (err) {
    console.warn(`[nostr] decrypt failed from=${senderPubkey.slice(0, 12)}…: ${err}`);
    return;
  }

  const text = plaintext.trim();
  if (!text) return;

  console.log(`[nostr] message from=${senderPubkey.slice(0, 12)}… len=${text.length}`);

  try {
    const ack = await mulmo.send(senderPubkey, text);
    if (ack.ok) {
      await sendDm(senderPubkey, ack.reply ?? "");
    } else {
      const statusSuffix = ack.status ? ` (${ack.status})` : "";
      const errMessage = ack.error ?? "unknown";
      await sendDm(senderPubkey, `Error${statusSuffix}: ${errMessage}`);
    }
  } catch (err) {
    console.error(`[nostr] handleEvent error: ${err}`);
  }
}

// ── Subscription ────────────────────────────────────────────────

function subscribe(): void {
  const since = Math.floor(Date.now() / 1_000) - SUBSCRIBE_SINCE_LOOKBACK_SEC;
  pool.subscribeMany(
    relays,
    {
      kinds: [KIND_ENCRYPTED_DM],
      "#p": [publicKey],
      since,
    },
    {
      onevent: (evt) => {
        handleEvent(evt).catch((err) => console.error(`[nostr] event handler error: ${err}`));
      },
      oneose: () => {
        console.log("[nostr] end-of-stored-events from all relays");
      },
    },
  );
}

// ── Main ────────────────────────────────────────────────────────

console.log("MulmoClaude Nostr bridge");
console.log(`Pubkey: ${publicKey}`);
console.log(`npub: ${nip19.npubEncode(publicKey)}`);
console.log(`Relays: ${relays.join(", ")}`);
const allowlistSummary = allowAll ? "(all)" : `${allowedPubkeys.size} pubkey(s)`;
console.log(`Allowlist: ${allowlistSummary}`);

subscribe();
