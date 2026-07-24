// Decode a `ws` message frame to a utf8 string, shared by the WebSocket-based
// bridges (Mastodon, Signal).
//
// `ws` hands the listener `Buffer | ArrayBuffer | Buffer[]`. The default
// binaryType is nodebuffer so a Buffer is what actually arrives, but the type
// admits ArrayBuffer — whose `toString()` is the literal "[object ArrayBuffer]",
// i.e. a frame silently parsed as garbage. Normalise instead of trusting the
// runtime default to hold.
export function frameText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
