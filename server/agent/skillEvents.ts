// Skill bookkeeping over the raw agent event stream (#1218).
//
// When the model invokes a skill, Claude CLI emits the SKILL.md body as the
// next assistant text. Both halves of that expectation live here: tracking
// which skill is pending, and splitting the body back off the reply once the
// text arrives. The structural signal is `toolName === "Skill"` + the `skill`
// slug in args — not a body-text prefix — so it survives any rewording Claude
// CLI does to the synthesised body.

import { isRecord } from "../utils/types.js";

export interface PendingSkill {
  skillName: string;
  toolUseId: string;
}

/** Only the slot the state machine reads and mutates, so callers with a bigger
 *  event context (and tests with none) can both pass something valid. */
export interface PendingSkillSlot {
  pendingSkill: PendingSkill | null;
}

export function updatePendingSkillOnToolCall(ctx: PendingSkillSlot, event: { toolName: string; toolUseId: string; args: unknown }): void {
  // Any non-Skill tool_call resets the pending state. Without this, a Skill
  // call followed by another tool (Bash, etc.) without a body flush in between
  // would leak `pendingSkill` and miscategorise a later unrelated assistant
  // text as a skill body.
  if (event.toolName !== "Skill") {
    ctx.pendingSkill = null;
    return;
  }
  const skillSlug = isRecord(event.args) && typeof event.args.skill === "string" ? event.args.skill : null;
  ctx.pendingSkill = skillSlug ? { skillName: skillSlug, toolUseId: event.toolUseId } : null;
}

// The Skill's own tool_call_result (matching toolUseId) carries "Launching
// skill: X" content; the body follows in the next text event so we leave
// `pendingSkill` set. A tool_call_result with any OTHER id means a different
// tool's result interleaved before the body — sequence broken, clear the flag
// so a later unrelated assistant text isn't mis-tagged as `type: "skill"`.
export function updatePendingSkillOnToolCallResult(ctx: PendingSkillSlot, toolUseId: string): void {
  if (ctx.pendingSkill && toolUseId !== ctx.pendingSkill.toolUseId) {
    ctx.pendingSkill = null;
  }
}

/** Split an assistant text that carries a skill body from the model's own reply
 *  to the user (Claude CLI concatenates them when the SKILL.md ends with a
 *  "respond now" instruction).
 *
 *  Structural split: the SKILL.md body is on disk, available via
 *  `discoverSkills()`. We find that exact substring inside the message and
 *  slice. The optional `ARGUMENTS: <user_input>` line that Claude CLI appends
 *  when the SKILL.md uses `{{ARGUMENTS}}` is consumed too. Returns the whole
 *  message as `skillPart` with empty `replyPart` when `skillBody` is empty
 *  (discovery missed) or not found verbatim (Claude CLI changed the inlining
 *  format — the caller's canary log warn fires in that case). */
export function splitSkillAndReply(message: string, skillBody: string | null): { skillPart: string; replyPart: string } {
  if (!skillBody) return { skillPart: message, replyPart: "" };
  const trimmedBody = skillBody.trim();
  if (!trimmedBody) return { skillPart: message, replyPart: "" };
  const idx = message.indexOf(trimmedBody);
  if (idx < 0) return { skillPart: message, replyPart: "" };
  let cursor = idx + trimmedBody.length;
  // Skip the optional ARGUMENTS line + trailing whitespace.
  const argMatch = /^\s*ARGUMENTS:[^\n]*\n?/.exec(message.slice(cursor));
  if (argMatch) cursor += argMatch[0].length;
  const skillPart = message.slice(0, cursor).trimEnd();
  const replyPart = message.slice(cursor).replace(/^\s+/, "");
  return { skillPart, replyPart };
}
