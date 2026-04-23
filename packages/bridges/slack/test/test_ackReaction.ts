import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAckReaction } from "../src/ackReaction.ts";

describe("parseAckReaction — disabled", () => {
  it("returns null when unset", () => {
    assert.equal(parseAckReaction(undefined), null);
  });

  it("returns null on empty string", () => {
    assert.equal(parseAckReaction(""), null);
  });

  for (const value of ["0", "false", "off", "no", "FALSE", "Off", "No"]) {
    it(`returns null on explicit off value ${JSON.stringify(value)}`, () => {
      assert.equal(parseAckReaction(value), null);
    });
  }

  it("treats whitespace-only as disabled", () => {
    assert.equal(parseAckReaction("   "), null);
  });
});

describe("parseAckReaction — enabled with default emoji", () => {
  for (const value of ["1", "true", "on", "yes", "TRUE", "On", "Yes"]) {
    it(`returns "eyes" on boolean-on value ${JSON.stringify(value)}`, () => {
      assert.equal(parseAckReaction(value), "eyes");
    });
  }
});

describe("parseAckReaction — enabled with custom emoji", () => {
  it("passes standard emoji shortcodes through", () => {
    assert.equal(parseAckReaction("white_check_mark"), "white_check_mark");
    assert.equal(parseAckReaction("thumbsup"), "thumbsup");
    assert.equal(parseAckReaction("eyes"), "eyes");
  });

  it("allows custom workspace emoji (letters + underscores)", () => {
    assert.equal(parseAckReaction("my_bot_ack"), "my_bot_ack");
  });

  it("allows digits, + and - per Slack's shortcode grammar", () => {
    assert.equal(parseAckReaction("clap1"), "clap1");
    assert.equal(parseAckReaction("+1"), "+1");
    assert.equal(parseAckReaction("-1"), "-1");
    assert.equal(parseAckReaction("star-struck"), "star-struck");
  });

  it("trims surrounding whitespace before validating", () => {
    assert.equal(parseAckReaction("  eyes  "), "eyes");
  });
});

describe("parseAckReaction — invalid", () => {
  it("rejects names with surrounding colons", () => {
    assert.throws(() => parseAckReaction(":eyes:"), /Invalid SLACK_ACK_REACTION/);
  });

  it("rejects names with whitespace", () => {
    assert.throws(() => parseAckReaction("has space"), /Invalid SLACK_ACK_REACTION/);
  });

  it("rejects names with dots", () => {
    assert.throws(() => parseAckReaction("emoji.with.dot"), /Invalid SLACK_ACK_REACTION/);
  });

  it("rejects uppercase letters (Slack shortcodes are lowercase)", () => {
    assert.throws(() => parseAckReaction("Eyes"), /Invalid SLACK_ACK_REACTION/);
  });

  it("rejects names with unicode / non-ASCII", () => {
    assert.throws(() => parseAckReaction("目"), /Invalid SLACK_ACK_REACTION/);
  });
});
