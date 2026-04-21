import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BACKLINKS_MARKER, updateSessionBacklinks } from "../../server/workspace/wiki-backlinks/sessionBacklinks.js";

const SID_A = "3e0382cb-f02f-4f5b-a9a3-a71e50d7ad0c";
const SID_B = "4d7f5377-1bac-460c-8ec5-ea054fa0492d";
const HREF_A = `../../chat/${SID_A}.jsonl`;
const HREF_B = `../../chat/${SID_B}.jsonl`;

describe("updateSessionBacklinks — appendix creation", () => {
  it("creates a fresh appendix when marker is absent", () => {
    const existing = "# Page title\n\nSome body.\n";
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    assert.ok(out.includes(BACKLINKS_MARKER));
    assert.ok(out.includes("## History"));
    assert.ok(out.includes(`[session 3e0382cb](${HREF_A})`));
    assert.ok(out.startsWith(existing), "existing body should be preserved verbatim at the front");
  });

  it("adds blank-line separator before the appendix when body does not end in newline", () => {
    const existing = "# Page title\n\nSome body.";
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    // Between body and marker we want at least one blank line for
    // readability. Body lacks trailing \n so expect: body + \n\n + marker.
    const idx = out.indexOf(BACKLINKS_MARKER);
    assert.equal(out.slice(0, idx), "# Page title\n\nSome body.\n\n");
  });

  it("handles empty existing content by creating a bare appendix", () => {
    const out = updateSessionBacklinks("", SID_A, HREF_A);
    assert.ok(out.startsWith(BACKLINKS_MARKER));
    assert.ok(out.includes(`[session 3e0382cb](${HREF_A})`));
  });
});

describe("updateSessionBacklinks — dedupe (idempotent)", () => {
  it("returns the input unchanged when sessionId is already listed", () => {
    const existing = ["# Page title", "", "Body.", "", BACKLINKS_MARKER, "## History", "", `- [session 3e0382cb](${HREF_A})`, ""].join("\n");
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    assert.equal(out, existing);
  });

  it("returns unchanged even if existing link uses absolute `/chat/` form", () => {
    const existing = ["# Page", "", BACKLINKS_MARKER, "## History", "", `- [session 3e0382cb](/chat/${SID_A}.jsonl)`, ""].join("\n");
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    assert.equal(out, existing);
  });

  it("is idempotent across multiple calls with the same session", () => {
    const existing = "# Page\n";
    const once = updateSessionBacklinks(existing, SID_A, HREF_A);
    const twice = updateSessionBacklinks(once, SID_A, HREF_A);
    assert.equal(twice, once);
  });
});

describe("updateSessionBacklinks — append second session", () => {
  it("appends a new bullet under an existing appendix", () => {
    const existing = ["# Page", "", BACKLINKS_MARKER, "## History", "", `- [session 3e0382cb](${HREF_A})`, ""].join("\n");
    const out = updateSessionBacklinks(existing, SID_B, HREF_B);
    assert.ok(out.includes(`[session 3e0382cb](${HREF_A})`));
    assert.ok(out.includes(`[session 4d7f5377](${HREF_B})`));
    // Existing bullet should appear before the new one.
    assert.ok(out.indexOf(`[session 3e0382cb]`) < out.indexOf(`[session 4d7f5377]`), "new bullet must be appended after existing bullets");
  });

  it("preserves bullets from multiple earlier sessions", () => {
    const existing = [
      "# Page",
      "",
      BACKLINKS_MARKER,
      "## History",
      "",
      `- [session aaaaaaaa](../../chat/aaaaaaaa-1111.jsonl)`,
      `- [session bbbbbbbb](../../chat/bbbbbbbb-2222.jsonl)`,
      "",
    ].join("\n");
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    assert.ok(out.includes("aaaaaaaa"));
    assert.ok(out.includes("bbbbbbbb"));
    assert.ok(out.includes("3e0382cb"));
  });
});

describe("updateSessionBacklinks — edge cases", () => {
  it("no-op on empty sessionId (defensive)", () => {
    const existing = "# Page\n";
    assert.equal(updateSessionBacklinks(existing, "", HREF_A), existing);
  });

  it("uses full id as short form when id is shorter than 8 chars", () => {
    const shortId = "abc";
    const out = updateSessionBacklinks("# Page\n", shortId, `../../chat/${shortId}.jsonl`);
    assert.ok(out.includes(`[session abc](../../chat/abc.jsonl)`));
  });

  it("ignores a bullet whose href has no `chat/` segment", () => {
    // The existing bullet does NOT point at a chat session, so the new
    // sessionId should still be added (not treated as already-present).
    const existing = ["# Page", "", BACKLINKS_MARKER, "## History", "", `- [not a session](../../wiki/pages/other.md)`, ""].join("\n");
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    assert.ok(out.includes(`[session 3e0382cb](${HREF_A})`));
  });

  it("ignores a malformed bullet (no closing paren)", () => {
    const existing = ["# Page", "", BACKLINKS_MARKER, "## History", "", `- [session broken](../../chat/broken.jsonl`, ""].join("\n");
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    assert.ok(out.includes(`[session 3e0382cb](${HREF_A})`));
  });

  it("strips fragment/query from href before id extraction", () => {
    const existing = ["# Page", "", BACKLINKS_MARKER, "## History", "", `- [session 3e0382cb](${HREF_A}#top)`, ""].join("\n");
    const out = updateSessionBacklinks(existing, SID_A, HREF_A);
    // #top variant counts as an existing record of SID_A → no append.
    assert.equal(out, existing);
  });

  it("respects only the first marker if there are multiple (malformed doc)", () => {
    const existing = [
      "# Page",
      "",
      BACKLINKS_MARKER,
      "## History",
      "",
      `- [session 3e0382cb](${HREF_A})`,
      "",
      BACKLINKS_MARKER, // stray duplicate marker
      "",
    ].join("\n");
    const out = updateSessionBacklinks(existing, SID_B, HREF_B);
    // Everything from the FIRST marker onward is treated as the
    // appendix; the second marker sits inside that slice and gets
    // preserved by the scan. New bullet should still land.
    assert.ok(out.includes(`[session 4d7f5377](${HREF_B})`));
  });
});
