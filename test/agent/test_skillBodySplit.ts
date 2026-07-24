// Verifies the structural split that separates the synthesised
// SKILL.md body Claude CLI inlines from the LLM's actual reply
// concatenated to it (#1218 follow-up — issue 3 reproducer:
// shiritori). Without this split the entire blob gets tagged
// `type: "skill"` and the user's actual reply disappears when they
// collapse the card.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitSkillAndReply } from "../../server/agent/skillEvents.js";

const SKILL_BODY =
  "# Shiritori (しりとり)\n\nPlay a round of しりとり with the user.\n\nStart the game now — output just your opening word + the prompt line, nothing else first.";

describe("splitSkillAndReply (#1218)", () => {
  it("isolates the LLM reply when no ARGUMENTS line is appended (the shiritori reproducer)", () => {
    const message = `Base directory for this skill: /home/.../shiritori\n\n${SKILL_BODY}\nさくら (あなたの番です。「ら」で始まる言葉をどうぞ)`;
    const { skillPart, replyPart } = splitSkillAndReply(message, SKILL_BODY);
    assert.match(skillPart, /Base directory for this skill:/);
    assert.match(skillPart, /Start the game now/);
    assert.equal(replyPart, "さくら (あなたの番です。「ら」で始まる言葉をどうぞ)");
  });

  it("strips the ARGUMENTS line and the trailing reply together when both are present", () => {
    const message = `Base directory for this skill: /x\n\n${SKILL_BODY}\n\nARGUMENTS: しりとししたい\n\nさくら (...)`;
    const { skillPart, replyPart } = splitSkillAndReply(message, SKILL_BODY);
    assert.match(skillPart, /ARGUMENTS: しりとししたい$/);
    assert.equal(replyPart, "さくら (...)");
  });

  it("returns the whole message as skillPart and empty replyPart when no reply was concatenated", () => {
    const message = `Base directory for this skill: /x\n\n${SKILL_BODY}`;
    const { skillPart, replyPart } = splitSkillAndReply(message, SKILL_BODY);
    assert.equal(skillPart, message);
    assert.equal(replyPart, "");
  });

  it("falls through (no split) when the SKILL.md body is unavailable (discoverSkills missed)", () => {
    const message = "Base directory for this skill: /x\n\n# unknown skill body\n\nreply text";
    const { skillPart, replyPart } = splitSkillAndReply(message, null);
    assert.equal(skillPart, message);
    assert.equal(replyPart, "");
  });

  it("falls through when the SKILL.md body is empty (whitespace only)", () => {
    const message = "Base directory for this skill: /x\n\nbody\n\nreply";
    const { skillPart, replyPart } = splitSkillAndReply(message, "   \n\n   ");
    assert.equal(skillPart, message);
    assert.equal(replyPart, "");
  });

  it("falls through when the SKILL.md body is not found verbatim (Claude CLI rewording)", () => {
    // The canary log warn fires server-side in this branch; here we
    // just verify the split degrades to "treat the whole thing as
    // skill" rather than producing a wrong split.
    const message = "Base directory for this skill: /x\n\nDIFFERENT body inlined by CLI\n\nreply text";
    const { skillPart, replyPart } = splitSkillAndReply(message, SKILL_BODY);
    assert.equal(skillPart, message);
    assert.equal(replyPart, "");
  });

  it("trims trailing whitespace from skillPart and leading whitespace from replyPart", () => {
    const message = `head\n${SKILL_BODY}\n\n\n   さくら   `;
    const { skillPart, replyPart } = splitSkillAndReply(message, SKILL_BODY);
    assert.ok(!skillPart.endsWith("\n"));
    assert.ok(replyPart.startsWith("さくら"));
  });
});
