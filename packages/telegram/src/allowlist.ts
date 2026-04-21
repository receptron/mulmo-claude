// Telegram chat-ID allowlist. Telegram bots accept messages from any
// user who knows the bot's username — this is the one gate that keeps
// the operator's MulmoClaude from being driven by the entire
// internet. Default = empty set = deny everyone.
//
// Chat IDs are Telegram integers (positive for user chats, negative
// for group chats). We parse strictly: a non-integer entry in the
// CSV is a misconfiguration and should halt startup, not get silently
// dropped.

export interface Allowlist {
  allows(chatId: number): boolean;
  size(): number;
  /** For logging — never returns a mutable reference. */
  snapshot(): readonly number[];
}

/**
 * Parse a comma-separated list of integer chat IDs. Throws if any
 * entry isn't a valid integer so the operator notices a typo at
 * startup instead of silently denying messages.
 */
export function parseAllowlist(raw: string | undefined): Allowlist {
  const ids = new Set<number>();
  if (raw && raw.trim().length > 0) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;
      const n = Number(trimmed);
      if (!Number.isInteger(n)) {
        throw new Error(`TELEGRAM_ALLOWED_CHAT_IDS: "${trimmed}" is not an integer chat id`);
      }
      ids.add(n);
    }
  }
  return createAllowlist(ids);
}

export function createAllowlist(ids: Iterable<number>): Allowlist {
  const set = new Set(ids);
  return {
    allows(chatId) {
      return set.has(chatId);
    },
    size() {
      return set.size;
    },
    snapshot() {
      return Array.from(set).sort((a, b) => a - b);
    },
  };
}
