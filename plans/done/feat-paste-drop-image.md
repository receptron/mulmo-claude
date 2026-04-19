# feat(ui): paste / drag-and-drop image in chat input

Tracks issue #369.

## Goal

Let users paste (Ctrl+V / Cmd+V) or drag-and-drop an image onto the
chat textarea. A thumbnail preview appears; on send the image goes
as `selectedImageData` alongside the message text.

## Key finding

The issue states "server already handles selectedImageData — no
server changes needed." This is partially true: `selectedImageData`
flows from the request into the session store. However, `buildUser-
MessageLine()` in `server/agent/config.ts` currently sends plain
text only — the image never reaches the Claude CLI's stdin. The
vision integration requires changing the message content from a
plain string to a content-block array:

```ts
content: [
  { type: "image", source: { type: "base64", media_type, data } },
  { type: "text", text: message },
]
```

This PR implements BOTH the frontend UI and the server-side content-
block construction so the feature works end-to-end.

## Scope

### Frontend

1. `src/components/ChatImagePreview.vue` (new) — thumbnail + ✕
   remove button. Emits `remove` on click.
2. `src/App.vue`:
   - `pastedImage` ref (string | null, base64 data URL)
   - `@paste` on textarea → read `clipboardData.items` for
     `image/*` → FileReader → set ref
   - `@dragover.prevent` + `@drop` on the input wrapper div →
     same reader flow
   - Preview component renders when `pastedImage` is set
   - `sendMessage` passes `pastedImage ?? extractImageData(…)`
     as `selectedImageData`
   - Clears `pastedImage` after send
   - Size guard: reject images > 10 MB base64 (toast or inline
     warning)

### Server

3. `server/agent/config.ts` — `buildUserMessageLine(message,
   imageDataUrl?)`: when `imageDataUrl` is provided, emit content
   blocks instead of plain string.
4. `server/api/routes/agent.ts` — pass `selectedImageData` from
   the session store into `runAgentInBackground`, which passes it
   to `buildUserMessageLine`.

### Tests

5. Unit test for `buildUserMessageLine` with and without image.
6. E2E: paste an image (synthetic clipboard event), verify preview
   appears, send, verify the request body contains
   `selectedImageData`.

## Out of scope

- Multiple images per message
- Image editing / annotation
- Camera capture
- Non-image file drop (PDF, etc.)
