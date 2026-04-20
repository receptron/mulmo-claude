#!/usr/bin/env node
// @mulmobridge/matrix — Matrix bridge for MulmoClaude.
//
// Uses the Matrix Client-Server API (works with any Matrix server
// including matrix.org, Element, Synapse, Dendrite, Conduit).
//
// Required env vars:
//   MATRIX_HOMESERVER_URL  — e.g. https://matrix.org
//   MATRIX_ACCESS_TOKEN    — access token for the bot user
//   MATRIX_USER_ID         — e.g. @mulmo-bot:matrix.org
//
// Optional:
//   MATRIX_ALLOWED_ROOMS   — CSV of room IDs (empty = all joined rooms)

import "dotenv/config";
import {
  createClient,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { createBridgeClient } from "@mulmobridge/client";

const TRANSPORT_ID = "matrix";

const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
const accessToken = process.env.MATRIX_ACCESS_TOKEN;
const userId = process.env.MATRIX_USER_ID;
if (!homeserverUrl || !accessToken || !userId) {
  console.error(
    "MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, and MATRIX_USER_ID are required.\n" +
      "See README for setup instructions.",
  );
  process.exit(1);
}

const allowedRooms = new Set(
  (process.env.MATRIX_ALLOWED_ROOMS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const allowAll = allowedRooms.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((ev) => {
  matrixClient
    .sendTextMessage(ev.chatId, ev.message)
    .catch((err: unknown) =>
      console.error(`[matrix] push send failed: ${err}`),
    );
});

const matrixClient: MatrixClient = createClient({
  baseUrl: homeserverUrl,
  accessToken,
  userId,
});

// The matrix-js-sdk event emitter types are narrowly typed; the
// Room.timeline event name requires a cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(matrixClient as any).on(
  "Room.timeline",
  async (event: MatrixEvent, room: Room | null) => {
    if (!room) return;
    if (event.getType() !== "m.room.message") return;
    if (event.getSender() === userId) return;

    const content = event.getContent();
    if (content.msgtype !== "m.text") return;
    if (typeof content.body !== "string") return;

    const roomId = room.roomId;
    const text = content.body;
    if (!text.trim()) return;

    if (!allowAll && !allowedRooms.has(roomId)) return;

    console.log(
      `[matrix] message room=${roomId} sender=${event.getSender()} len=${text.length}`,
    );

    try {
      const ack = await mulmo.send(roomId, text);
      if (ack.ok) {
        await sendChunked(roomId, ack.reply ?? "");
      } else {
        const status = ack.status ? ` (${ack.status})` : "";
        await matrixClient.sendTextMessage(
          roomId,
          `Error${status}: ${ack.error ?? "unknown"}`,
        );
      }
    } catch (err) {
      console.error(`[matrix] message handling failed: ${err}`);
    }
  },
);

async function sendChunked(roomId: string, text: string): Promise<void> {
  // Matrix has no strict char limit but we chunk at 4000 for readability
  const MAX = 4000;
  if (text.length === 0) {
    await matrixClient.sendTextMessage(roomId, "(empty reply)");
    return;
  }
  for (let i = 0; i < text.length; i += MAX) {
    await matrixClient.sendTextMessage(roomId, text.slice(i, i + MAX));
  }
}

async function main(): Promise<void> {
  console.log("MulmoClaude Matrix bridge");
  console.log(`Homeserver: ${homeserverUrl}`);
  console.log(`User: ${userId}`);
  console.log(
    `Rooms: ${allowAll ? "(all joined)" : [...allowedRooms].join(", ")}`,
  );

  await matrixClient.startClient({ initialSyncLimit: 0 });
  console.log("Connected to Matrix.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
