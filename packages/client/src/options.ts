// Env-var scraper for the bridge options bag.
//
// Bridges don't want to hand-maintain a forward-list of env vars
// that should travel to the host app. Instead we scrape a single
// dedicated prefix pattern at `createBridgeClient()` time:
//
//   <TRANSPORT>_BRIDGE_<KEY>  — transport-specific, wins on clash
//   BRIDGE_<KEY>              — shared default across every bridge
//
// The `_BRIDGE_` segment is deliberate: it lets the bridge keep its
// own secrets (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, …) naturally
// outside the scrape — they have no `_BRIDGE_` segment so they're
// never picked up, no allowlist needed. That structural guarantee
// is why this side passes no `allowKeys` (the relay side, whose
// `RELAY_*` namespace also holds `RELAY_TOKEN`, does).

import { scanEnvOptions } from "@mulmoclaude/common/env-options";

const SHARED_PREFIX = "BRIDGE_";

/**
 * Read `<TRANSPORT>_BRIDGE_*` and `BRIDGE_*` env vars into a
 * lowerCamelCase-keyed bag ready to hand to `createBridgeClient`.
 *
 * Precedence when the same key resolves from both forms:
 * transport-specific wins over shared.
 *
 * Transport ids with dashes (`google-chat`, `line-works`,
 * `twilio-sms`, …) are normalised to underscores when building the
 * env prefix: `google-chat` → `GOOGLE_CHAT_BRIDGE_*`. Dashes in env
 * var names break shells, so `_` is the portable convention.
 *
 * Example:
 *   SLACK_BRIDGE_DEFAULT_ROLE=slack
 *   BRIDGE_DEFAULT_ROLE=general
 *   → `{ defaultRole: "slack" }`
 *
 *   GOOGLE_CHAT_BRIDGE_DEFAULT_ROLE=support
 *   (with transportId="google-chat")
 *   → `{ defaultRole: "support" }`
 */
export function readBridgeEnvOptions(transportId: string, env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const transportPrefix = `${transportId.toUpperCase().replace(/-/g, "_")}_${SHARED_PREFIX}`;
  return scanEnvOptions(env, { prefixes: [transportPrefix, SHARED_PREFIX] });
}
