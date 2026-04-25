// Parse the SLACK_ACK_REACTION env var into a concrete action:
//
//   - `null`               → feature disabled
//   - emoji shortcode name → feature enabled, use that emoji
//
// The var is dual-purpose (on/off switch + emoji selector) so we
// don't need a second variable. See plans/done/feat-slack-ack-reaction.md.
//
// Shortcode charset matches what Slack accepts for custom and
// standard emoji names: lowercase letters, digits, `_`, `+`, `-`.
// Operators pass names WITHOUT surrounding colons.

const EMOJI_PATTERN = /^[a-z0-9_+-]+$/;

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["", "0", "false", "off", "no"]);
const DEFAULT_EMOJI = "eyes";

/** Parse the raw env string.
 *  - Returns `null` when the feature is disabled (unset, empty, or
 *    an explicit off value).
 *  - Returns the emoji shortcode when enabled.
 *  - Throws on an invalid non-empty value so startup fails fast
 *    instead of silently running without the reaction. */
export function parseAckReaction(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  const lower = value.toLowerCase();
  if (FALSE_VALUES.has(lower)) return null;
  if (TRUE_VALUES.has(lower)) return DEFAULT_EMOJI;
  if (!EMOJI_PATTERN.test(value)) {
    throw new Error(
      `Invalid SLACK_ACK_REACTION=${JSON.stringify(raw)}. ` +
        `Expected: unset / "1" / emoji shortcode without colons ` +
        `(lowercase letters, digits, "_", "+", "-").`,
    );
  }
  return value;
}
