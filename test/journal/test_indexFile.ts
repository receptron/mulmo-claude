import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndexMarkdown,
  DEFAULT_MAX_RECENT_DAYS,
  type IndexInputs,
} from "../../server/journal/indexFile.js";

function baseInput(over: Partial<IndexInputs> = {}): IndexInputs {
  return {
    topics: [],
    days: [],
    archivedTopicCount: 0,
    builtAtIso: "2026-04-11T09:00:00.000Z",
    ...over,
  };
}

describe("buildIndexMarkdown", () => {
  it("renders empty placeholders when there is nothing to index", () => {
    const out = buildIndexMarkdown(baseInput());
    assert.match(out, /# Workspace Journal/);
    assert.match(out, /Last updated: 2026-04-11T09:00:00\.000Z/);
    assert.match(out, /_No topics yet\._/);
    assert.match(out, /_No daily entries yet\._/);
    assert.match(out, /_No archived topics\._/);
  });

  it("sorts topics newest-first by lastUpdatedIso", () => {
    const out = buildIndexMarkdown(
      baseInput({
        topics: [
          { slug: "older", lastUpdatedIso: "2026-04-01T00:00:00Z" },
          { slug: "newer", lastUpdatedIso: "2026-04-10T00:00:00Z" },
          { slug: "mid", lastUpdatedIso: "2026-04-05T00:00:00Z" },
        ],
      }),
    );
    const newerIdx = out.indexOf("newer");
    const midIdx = out.indexOf("mid");
    const olderIdx = out.indexOf("older");
    assert.ok(newerIdx < midIdx && midIdx < olderIdx, "expected newest first");
  });

  it("sorts topics with no timestamp after timestamped ones, alphabetically", () => {
    const out = buildIndexMarkdown(
      baseInput({
        topics: [
          { slug: "zebra" },
          { slug: "alpha" },
          { slug: "dated", lastUpdatedIso: "2026-04-01T00:00:00Z" },
        ],
      }),
    );
    const datedIdx = out.indexOf("dated");
    const alphaIdx = out.indexOf("alpha");
    const zebraIdx = out.indexOf("zebra");
    assert.ok(datedIdx < alphaIdx, "dated topic should come first");
    assert.ok(alphaIdx < zebraIdx, "alpha should precede zebra among undated");
  });

  it("uses the topic title when present and falls back to slug otherwise", () => {
    const out = buildIndexMarkdown(
      baseInput({
        topics: [
          { slug: "video-generation", title: "Video Generation" },
          { slug: "bare-slug" },
        ],
      }),
    );
    assert.match(out, /\[Video Generation\]\(topics\/video-generation\.md\)/);
    assert.match(out, /\[bare-slug\]\(topics\/bare-slug\.md\)/);
  });

  it("sorts daily entries newest-first", () => {
    const out = buildIndexMarkdown(
      baseInput({
        days: [
          { date: "2026-04-09" },
          { date: "2026-04-11" },
          { date: "2026-04-10" },
        ],
      }),
    );
    const d11 = out.indexOf("2026-04-11");
    const d10 = out.indexOf("2026-04-10");
    const d09 = out.indexOf("2026-04-09");
    assert.ok(d11 < d10 && d10 < d09);
  });

  it("collapses older days beyond maxRecentDays with a footer", () => {
    const days = Array.from({ length: DEFAULT_MAX_RECENT_DAYS + 5 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return { date: `2026-04-${day}` };
    });
    const out = buildIndexMarkdown(baseInput({ days }));
    assert.match(out, /…and 5 earlier days\./);
  });

  it("uses singular 'day' when exactly one is collapsed", () => {
    const days = Array.from({ length: DEFAULT_MAX_RECENT_DAYS + 1 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return { date: `2026-04-${day}` };
    });
    const out = buildIndexMarkdown(baseInput({ days }));
    assert.match(out, /…and 1 earlier day\./);
  });

  it("renders the archive count when > 0", () => {
    const out = buildIndexMarkdown(baseInput({ archivedTopicCount: 3 }));
    assert.match(out, /Archived topics.*3 archived topics/);
  });

  it("uses singular noun when exactly one topic is archived", () => {
    const out = buildIndexMarkdown(baseInput({ archivedTopicCount: 1 }));
    assert.match(out, /1 archived topic\b/);
  });

  it("renders daily row with nested YYYY/MM/DD path", () => {
    const out = buildIndexMarkdown(
      baseInput({ days: [{ date: "2026-04-11" }] }),
    );
    assert.match(out, /\[2026-04-11\]\(daily\/2026\/04\/11\.md\)/);
  });
});
