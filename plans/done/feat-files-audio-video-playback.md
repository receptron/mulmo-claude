# Audio / Video Playback in File Explorer

## User Request

> fileエクスプローラーで音声や動画ファイルはそこで再生したい
> (I want audio and video files to play directly inside the file explorer.)

## Goal

When the user clicks an audio or video file in `FilesView.vue`, render a
native `<audio>` / `<video>` player in the content pane instead of the
current "Binary file — preview not supported" message.

## Supported formats

- **Audio:** `.mp3`, `.wav`, `.m4a`, `.ogg`, `.oga`, `.flac`, `.aac`
- **Video:** `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`

These cover the common container/codec combinations that browsers play
natively without extra plugins.

## Implementation

### 1. `server/api/routes/files.ts`

- Add `AUDIO_EXTENSIONS` and `VIDEO_EXTENSIONS` sets alongside the
  existing `IMAGE_EXTENSIONS`.
- Extend `MIME_BY_EXT` with audio/video MIME types (`audio/mpeg`,
  `video/mp4`, etc.) so the raw endpoint serves them with a
  browser-recognized `Content-Type`.
- Extend the `ContentKind` type and `FileContentMeta` discriminated
  union to include `"audio" | "video"`.
- Update `classify()` to return `"audio"` / `"video"` for the new
  extensions.
- `/files/content` returns the new kinds as metadata-only
  (`{ kind, path, size, modifiedMs }`); the actual bytes are served via
  `/files/raw`, matching how images and PDFs already work.

### 2. HTTP Range support on `/files/raw`

Safari refuses to play `<video>` over HTTP unless the server responds
with a 206 Partial Content to a `Range` request, and Chrome needs it
for seek-past-buffered to work. Current handler only does full-file
pipes, which is fine for images/PDFs/audio but breaks video.

Changes:

- Parse `Range: bytes=START-END` (and `bytes=-SUFFIX`) into a validated
  `{start, end}` range.
- When a satisfiable range is present: respond `206`, set
  `Content-Range`, `Content-Length`, `Content-Type`, `Accept-Ranges:
  bytes`, and stream the requested slice with `fs.createReadStream(p,
  {start, end})`.
- When the range header is malformed or unsatisfiable: respond `416`
  with `Content-Range: bytes */<size>`.
- When no range header: existing full-file behaviour, but still set
  `Accept-Ranges: bytes` so clients know they can request ranges.
- Extract the existing stream-error handler into a small helper so both
  the range and full-file branches can share it.

Keeping helpers small (Range parsing, pipe-with-error) so the route
handler stays readable.

### 3. `src/components/FilesView.vue`

- Extend the local `MetaContent` type to include `"audio" | "video"`.
- Add two new template blocks after the existing PDF block:
  - `<audio controls preload="metadata" :src="rawUrl(selectedPath)">`
  - `<video controls preload="metadata" :src="rawUrl(selectedPath)">`

Switching files automatically unmounts the previous media element
(Vue's `v-else-if` swap on `content.kind`), so the old one stops
playing without any extra handler.

## Out of scope

- Raising `MAX_RAW_BYTES` above 50 MB. Files over that still show the
  existing "too-large" message. Can revisit if needed for large video
  files.
- Waveform / thumbnail preview, playback-speed controls, playlists,
  custom chrome. Native `<audio>`/`<video>` already exposes play,
  pause, seek, volume, fullscreen, and speed.
