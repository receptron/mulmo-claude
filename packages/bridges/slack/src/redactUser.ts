// Slack user IDs (U...) are stable, persistent identifiers tied to
// a workspace — effectively PII. Hash to a short, stable identifier
// so log lines still correlate messages from the same user without
// exposing the raw ID if log files are shared or leak.
//
// 8 hex chars = 32 bits of entropy, which is plenty to distinguish
// the tens-to-hundreds of users a single bridge installation sees.
import { createHash } from "node:crypto";

export function redactUser(userId: string | undefined): string {
  if (!userId) return "?";
  return `u_${createHash("sha256").update(userId).digest("hex").slice(0, 8)}`;
}
