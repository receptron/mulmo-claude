// Pure parsing helpers for the LINE bridge webhook.

export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { type: string; text?: string };
}

export interface LineWebhookBody {
  events: LineEvent[];
}

export interface IncomingLineMessage {
  userId: string;
  text: string;
}

/**
 * Reduce a LINE webhook event to the actionable userId / text pair.
 * Returns null for non-text events, missing fields, or whitespace-only
 * text. Pure — no side effects, no allowlist check.
 */
export function extractIncomingLineMessage(event: LineEvent): IncomingLineMessage | null {
  if (event.type !== "message") return null;
  if (event.message?.type !== "text") return null;
  const userId = event.source?.userId;
  const text = event.message.text ?? "";
  if (!userId || !text.trim()) return null;
  return { userId, text };
}

/** Best-effort JSON parse for the webhook body — null on malformed input. */
export function parseLineWebhookBody(raw: string): LineWebhookBody | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { events?: unknown }).events)) {
      return null;
    }
    return parsed as LineWebhookBody;
  } catch {
    return null;
  }
}
