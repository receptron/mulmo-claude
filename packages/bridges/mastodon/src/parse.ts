// Pure parsing helpers for the Mastodon bridge — HTML→text,
// leading-mention strip, mention-status extraction.

export type JsonRecord = Record<string, unknown>;

export function isObj(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export interface ParsedStatus {
  statusId: string;
  senderAcct: string;
  visibility: string;
  text: string;
  media: unknown;
}

function stripTags(input: string): string {
  // Walk char-by-char so we avoid regex backtracking on malformed HTML.
  const out: string[] = [];
  let inTag = false;
  for (const char of input) {
    if (char === "<") inTag = true;
    else if (char === ">") inTag = false;
    else if (!inTag) out.push(char);
  }
  return out.join("");
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function htmlToText(html: string): string {
  const withNewlines = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n");
  return decodeEntities(stripTags(withNewlines)).trim();
}

// Bounded regex with no nested quantifier overlap — matches at most
// one mention token at a time. Safe against ReDoS even on adversarial
// input because the engine commits to a single mention's bounded
// `[A-Za-z0-9_.]+` / `[A-Za-z0-9_.-]+` runs and either advances or
// fails in O(n) per match. eslint-plugin-security's safe-regex
// heuristic flags any `(...)?` containing `+` generically, even
// when the surrounding pattern can't drive exponential backtracking.
// eslint-disable-next-line security/detect-unsafe-regex -- single-mention pattern, no nested-quantifier overlap; the iterative caller bounds total work to O(N) in the input length
const SINGLE_MENTION_RE = /^@[A-Za-z0-9_.]+(?:@[A-Za-z0-9_.-]+)?\s+/;

export function stripLeadingMentions(text: string): string {
  // Iterative strip — peel off one leading "@acct" / "@acct@instance"
  // mention per pass until the prefix no longer matches. Avoids the
  // outer `+` over a group with nested `+` quantifiers (the previous
  // `(?:@[\w.]+(?:@[\w.-]+)?\s+)+` form), which `eslint-plugin-security`
  // / `safe-regex` flag as ReDoS-prone on inputs like long runs of
  // `@a@a@a…` without a trailing space.
  let stripped = text;
  while (true) {
    const match = SINGLE_MENTION_RE.exec(stripped);
    if (!match) break;
    stripped = stripped.slice(match[0].length);
  }
  return stripped.trim();
}

export function parseMentionStatus(notification: JsonRecord): ParsedStatus | null {
  if (notification.type !== "mention") return null;
  const { status } = notification;
  if (!isObj(status)) return null;
  const statusId = typeof status.id === "string" ? status.id : "";
  const visibility = typeof status.visibility === "string" ? status.visibility : "public";
  const account = isObj(status.account) ? status.account : null;
  const senderAcct = account && typeof account.acct === "string" ? account.acct : "";
  const content = typeof status.content === "string" ? status.content : "";
  const text = stripLeadingMentions(htmlToText(content));
  if (!statusId || !senderAcct) return null;
  return { statusId, senderAcct, visibility, text, media: status.media_attachments };
}

/**
 * Wraps JSON.parse + shape validation + parseMentionStatus so the
 * orchestration layer can branch on a single null / non-null result.
 */
export function parseNotificationRaw(raw: string): ParsedStatus | null {
  let notif: unknown;
  try {
    notif = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(notif)) return null;
  return parseMentionStatus(notif);
}

export interface StreamFrame {
  event: string;
  payload: string;
}

export function parseFrame(raw: unknown): StreamFrame | null {
  if (typeof raw !== "string") return null;
  try {
    const msg: unknown = JSON.parse(raw);
    if (!isObj(msg)) return null;
    const event = typeof msg.event === "string" ? msg.event : "";
    const payload = typeof msg.payload === "string" ? msg.payload : "";
    if (!event || !payload) return null;
    return { event, payload };
  } catch {
    return null;
  }
}
