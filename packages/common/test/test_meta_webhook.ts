import { test } from "node:test";
import assert from "node:assert/strict";

import { extractMessengerMessages, extractWhatsAppMessages } from "../src/meta-webhook.ts";

// ── Messenger ──────────────────────────────────────────────────────

test("extractMessengerMessages: happy path across entries and events", () => {
  const body = {
    entry: [
      {
        messaging: [
          { sender: { id: "u1" }, message: { text: "hi" } },
          { sender: { id: "u2" }, message: { text: "  spaced  " } },
        ],
      },
      { messaging: [{ sender: { id: "u3" }, message: { text: "third" } }] },
    ],
  };
  assert.deepEqual(extractMessengerMessages(body), [
    { senderId: "u1", text: "hi" },
    { senderId: "u2", text: "spaced" },
    { senderId: "u3", text: "third" },
  ]);
});

test("extractMessengerMessages: skips whitespace-only, missing text, and non-string sender id", () => {
  const body = {
    entry: [
      {
        messaging: [
          { sender: { id: "u1" }, message: { text: "   " } },
          { sender: { id: "u2" }, message: {} },
          { sender: { id: 42 }, message: { text: "num sender" } },
          { sender: {}, message: { text: "no id" } },
          { message: { text: "no sender" } },
        ],
      },
    ],
  };
  assert.deepEqual(extractMessengerMessages(body), []);
});

test("extractMessengerMessages: empty / malformed / null bodies yield []", () => {
  assert.deepEqual(extractMessengerMessages({}), []);
  assert.deepEqual(extractMessengerMessages({ entry: "nope" }), []);
  assert.deepEqual(extractMessengerMessages({ entry: [{ messaging: "nope" }] }), []);
  assert.deepEqual(extractMessengerMessages(null), []);
  assert.deepEqual(extractMessengerMessages(undefined), []);
  assert.deepEqual(extractMessengerMessages([]), []);
  assert.deepEqual(extractMessengerMessages("string"), []);
});

// ── WhatsApp ───────────────────────────────────────────────────────

test("extractWhatsAppMessages: happy path across entries, changes, messages", () => {
  const body = {
    entry: [
      {
        changes: [
          { value: { messages: [{ type: "text", from: "p1", text: { body: "hello" } }] } },
          { value: { messages: [{ type: "text", from: "p2", text: { body: " trim " } }] } },
        ],
      },
    ],
  };
  assert.deepEqual(extractWhatsAppMessages(body), [
    { from: "p1", text: { body: "hello" } },
    { from: "p2", text: { body: " trim " } },
  ]);
});

test("extractWhatsAppMessages: skips non-text types, empty body, and non-string from", () => {
  const body = {
    entry: [
      {
        changes: [
          { value: { messages: [{ type: "image", from: "p1", text: { body: "x" } }] } },
          { value: { messages: [{ type: "text", from: "p2", text: { body: "   " } }] } },
          { value: { messages: [{ type: "text", from: 99, text: { body: "num" } }] } },
          { value: { messages: [{ type: "text", from: "p3" }] } },
          { value: {} },
        ],
      },
    ],
  };
  assert.deepEqual(extractWhatsAppMessages(body), []);
});

test("extractWhatsAppMessages: preserves body verbatim (no trim on the value)", () => {
  const body = { entry: [{ changes: [{ value: { messages: [{ type: "text", from: "p", text: { body: "  keep  " } }] } }] }] };
  assert.deepEqual(extractWhatsAppMessages(body), [{ from: "p", text: { body: "  keep  " } }]);
});

test("extractWhatsAppMessages: empty / malformed / null bodies yield []", () => {
  assert.deepEqual(extractWhatsAppMessages({}), []);
  assert.deepEqual(extractWhatsAppMessages({ entry: "nope" }), []);
  assert.deepEqual(extractWhatsAppMessages({ entry: [{ changes: "nope" }] }), []);
  assert.deepEqual(extractWhatsAppMessages(null), []);
  assert.deepEqual(extractWhatsAppMessages(undefined), []);
  assert.deepEqual(extractWhatsAppMessages([]), []);
});
