// Session-granularity helpers for @mulmobridge/slack.
//
// Kept separate from index.ts so they can be unit-tested without
// importing the bridge entrypoint (which starts Socket Mode on load).

export type SessionGranularity = "channel" | "thread" | "auto";

/** Pick the effective `thread_ts` for an incoming Slack message.
 *
 *  - If the message is already in a thread, use that thread's `thread_ts`.
 *  - Otherwise, in `thread` mode on a channel (NOT a DM), synthesise the
 *    thread root from the message's own `ts`. Posting the reply with
 *    `thread_ts = event.ts` causes Slack to promote the original post
 *    into a thread root and thread the reply under it — which is the
 *    whole point of thread mode (each top-level post = one topic =
 *    one thread).
 *  - DMs (`channel_type === "im"`) are intentionally left alone —
 *    threading in a 1:1 conversation is meaningless UI noise.
 *  - `channel` / `auto` modes do not synthesise: a top-level post stays
 *    top-level and users can still opt into threading manually. */
export function effectiveThreadTs(event: { thread_ts?: unknown; ts?: unknown; channel_type?: unknown }, mode: SessionGranularity): string | undefined {
  if (typeof event.thread_ts === "string" && event.thread_ts.length > 0) {
    return event.thread_ts;
  }
  if (mode !== "thread") return undefined;
  if (event.channel_type === "im") return undefined;
  return typeof event.ts === "string" && event.ts.length > 0 ? event.ts : undefined;
}

/** Parse the SLACK_SESSION_GRANULARITY env var into a safe enum value.
 *  Unset falls back to "channel" — the pre-feature default.
 *  Any explicit invalid value is rejected so operators notice the
 *  misconfiguration instead of silently getting channel mode. */
export function parseGranularity(raw: string | undefined): SessionGranularity {
  const normalised = (raw ?? "channel").toLowerCase();
  if (normalised === "channel" || normalised === "thread" || normalised === "auto") {
    return normalised;
  }
  throw new Error(`Invalid SLACK_SESSION_GRANULARITY=${JSON.stringify(raw)}. Expected one of: channel, thread, auto.`);
}

/** Pack (channel, thread_ts) into the opaque externalChatId the server
 *  receives. The server keys sessions by this string verbatim, so two
 *  messages with different externalChatIds get independent sessions.
 *
 *  - "channel" mode → channelId only (backward-compatible)
 *  - "thread" / "auto" mode → channelId_thread_ts when the message is in
 *    a thread; channelId otherwise (root-channel posts remain shared)
 *
 *  `_` separator is safe in chat-service's isSafeId regex (^[\w.-]+$);
 *  the dot inside thread_ts is also safe. */
export function buildExternalChatId(channelId: string, threadTs: string | undefined, mode: SessionGranularity): string {
  const useThread = (mode === "thread" || mode === "auto") && typeof threadTs === "string" && threadTs.length > 0;
  return useThread ? `${channelId}_${threadTs}` : channelId;
}

/** Reverse of `buildExternalChatId`. When the server later pushes a
 *  reply back through us, the externalChatId is all we have to
 *  reconstruct the Slack target (channel + optional thread_ts).
 *
 *  Splits on the FIRST underscore. Slack channel ids ("C"/"D"/"G" + alnum)
 *  do not contain `_` or `.`, so the first `_` always marks the
 *  channel/thread_ts boundary. */
export function parseExternalChatId(externalChatId: string): { channel: string; threadTs?: string } {
  const idx = externalChatId.indexOf("_");
  if (idx === -1) return { channel: externalChatId };
  return {
    channel: externalChatId.slice(0, idx),
    threadTs: externalChatId.slice(idx + 1),
  };
}
