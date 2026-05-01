import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { exportChatToMarkdown } from "../../../src/utils/chat/exportMarkdown.js";

function textResult(role: "user" | "assistant" | "system", text: string, uuid = `t-${role}`): ToolResultComplete {
  return {
    toolName: "text-response",
    uuid,
    message: text,
    data: { role, text },
  };
}

function toolResult(toolName: string, title: string | undefined, uuid: string): ToolResultComplete {
  return {
    toolName,
    uuid,
    message: title ?? toolName,
    title,
  };
}

describe("exportChatToMarkdown", () => {
  it("renders a user/assistant exchange as plain-markdown turns", async () => {
    const out = await exportChatToMarkdown([textResult("user", "hello"), textResult("assistant", "hi there")], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Conversation/);
    assert.match(out, /## ⬜︎ You/);
    assert.match(out, /## ⬛︎ Assistant/);
    assert.match(out, /^hello$/m);
    assert.match(out, /^hi there$/m);
    assert.match(out, /\n\n---\n\n/);
  });

  it("includes the role name in the title when provided", async () => {
    const out = await exportChatToMarkdown([textResult("user", "hi")], { sessionRoleName: "General", exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Conversation · General/);
  });

  it("demotes headings inside a message body by 2 levels (cap at h6)", async () => {
    const inner = "# H1\n\n## H2\n\n### H3\n\n##### H5\n\n###### H6\n\nBody line\n- item";
    const out = await exportChatToMarkdown([textResult("assistant", inner)], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^### H1$/m);
    assert.match(out, /^#### H2$/m);
    assert.match(out, /^##### H3$/m);
    assert.match(out, /^###### H5$/m);
    assert.match(out, /^###### H6$/m);
    assert.match(out, /^Body line$/m);
    assert.match(out, /^- item$/m);
  });

  it("does not demote headings inside fenced code blocks", async () => {
    const inner = "```md\n# This is sample syntax\n```\n\n## Real heading";
    const out = await exportChatToMarkdown([textResult("assistant", inner)], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# This is sample syntax$/m);
    assert.match(out, /^#### Real heading$/m);
  });

  it("treats a shorter inner fence as content (4-backtick block containing a 3-backtick block)", async () => {
    // Outer fence is 4 backticks; inner ``` is just content. The `#` on
    // line 3 must stay untouched, and `## After` after the real close
    // must be demoted normally.
    const inner = "````md\n```\n# Inside inner\n```\n````\n\n## After";
    const out = await exportChatToMarkdown([textResult("assistant", inner)], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Inside inner$/m); // untouched
    assert.match(out, /^#### After$/m); // demoted
  });

  it("treats the opposite fence char as content (~~~ inside ```)", async () => {
    const inner = "```\n~~~\n# Inside\n~~~\n```\n\n## After";
    const out = await exportChatToMarkdown([textResult("assistant", inner)], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Inside$/m); // untouched (~~~ doesn't close a ``` fence)
    assert.match(out, /^#### After$/m);
  });

  it("renders a non-text tool call as a single `## ⬛︎ toolName HH:MM` heading line", async () => {
    const stamps = new Map<string, number>([["tool-1", Date.UTC(2026, 3, 30, 15, 17)]]);
    const out = await exportChatToMarkdown([textResult("user", "open it"), toolResult("openCanvas", "Untitled", "tool-1"), textResult("assistant", "done")], {
      exportedAt: "2026-04-30T12:00:00Z",
      resultTimestamps: stamps,
    });
    assert.match(out, /^## ⬛︎ openCanvas \d{2}:\d{2}$/m);
    assert.doesNotMatch(out, /\*▸ openCanvas/);
    assert.doesNotMatch(out, /openCanvas — Untitled/);
  });

  it("renders the tool heading without a time when no timestamp is available", async () => {
    const out = await exportChatToMarkdown([toolResult("manageWiki", undefined, "tool-2")], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^## ⬛︎ manageWiki$/m);
  });

  it("inlines presentDocument's inline markdown body (demoted) under the marker line", async () => {
    const presentDoc: ToolResultComplete = {
      toolName: "presentDocument",
      uuid: "doc-1",
      message: "doc",
      title: "Trip plan",
      data: {
        markdown: "# Trip plan\n\n## Day 1\n\nFly to Tokyo.",
        filenamePrefix: "trip-plan",
      },
    };
    const out = await exportChatToMarkdown([presentDoc], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^## ⬛︎ presentDocument$/m);
    assert.match(out, /^### Trip plan$/m);
    assert.match(out, /^#### Day 1$/m);
    assert.match(out, /^Fly to Tokyo\.$/m);
  });

  it("inlines presentDocument's file-mode body via the readFile resolver", async () => {
    const presentDoc: ToolResultComplete = {
      toolName: "presentDocument",
      uuid: "doc-2",
      message: "doc",
      title: "Saved doc",
      data: {
        markdown: "artifacts/documents/saved-doc.md",
        filenamePrefix: "saved-doc",
      },
    };
    const files = new Map<string, string>([["artifacts/documents/saved-doc.md", "# Saved doc\n\nServer body."]]);
    const out = await exportChatToMarkdown([presentDoc], {
      exportedAt: "2026-04-30T12:00:00Z",
      readFile: async (path) => files.get(path) ?? null,
    });
    assert.match(out, /^## ⬛︎ presentDocument$/m);
    assert.match(out, /^### Saved doc$/m); // # → ###
    assert.match(out, /^Server body\.$/m);
  });

  it("falls back to marker-only when the readFile resolver throws", async () => {
    const presentDoc: ToolResultComplete = {
      toolName: "presentDocument",
      uuid: "doc-throw",
      message: "doc",
      title: "Throws",
      data: {
        markdown: "artifacts/documents/throws.md",
        filenamePrefix: "throws",
      },
    };
    const out = await exportChatToMarkdown([presentDoc], {
      exportedAt: "2026-04-30T12:00:00Z",
      readFile: async () => {
        throw new Error("network down");
      },
    });
    assert.match(out, /^## ⬛︎ presentDocument$/m);
    assert.doesNotMatch(out, /network down/);
  });

  it("falls back to marker-only when the readFile resolver returns null", async () => {
    const presentDoc: ToolResultComplete = {
      toolName: "presentDocument",
      uuid: "doc-3",
      message: "doc",
      title: "Missing",
      data: {
        markdown: "artifacts/documents/missing.md",
        filenamePrefix: "missing",
      },
    };
    const out = await exportChatToMarkdown([presentDoc], {
      exportedAt: "2026-04-30T12:00:00Z",
      readFile: async () => null,
    });
    assert.match(out, /^## ⬛︎ presentDocument$/m);
    assert.doesNotMatch(out, /artifacts\/documents\/missing\.md/);
  });

  it("falls back to marker-only when no readFile resolver is supplied for a file-mode reference", async () => {
    const presentDoc: ToolResultComplete = {
      toolName: "presentDocument",
      uuid: "doc-4",
      message: "doc",
      title: "Saved doc",
      data: {
        markdown: "artifacts/documents/saved-doc.md",
        filenamePrefix: "saved-doc",
      },
    };
    const out = await exportChatToMarkdown([presentDoc], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^## ⬛︎ presentDocument$/m);
    assert.doesNotMatch(out, /artifacts\/documents\/saved-doc\.md/);
  });

  it("renders a header even for an empty session", async () => {
    const out = await exportChatToMarkdown([], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Conversation/);
    assert.match(out, /Exported 2026-04-30/);
  });

  it("includes time stamps when resultTimestamps has the uuid", async () => {
    const stamps = new Map<string, number>([["t-user", Date.UTC(2026, 3, 30, 14, 35)]]);
    const out = await exportChatToMarkdown([textResult("user", "hi")], { resultTimestamps: stamps, exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /## ⬜︎ You · \d{2}:\d{2}/);
  });

  it("renders the time even when the timestamp is the Unix epoch (0)", async () => {
    // Boundary case: `epochMs ? …` would silently drop this.
    const stamps = new Map<string, number>([["t-user", 0]]);
    const out = await exportChatToMarkdown([textResult("user", "hi")], { resultTimestamps: stamps, exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /## ⬜︎ You · \d{2}:\d{2}/);
  });

  it("treats system role correctly", async () => {
    const out = await exportChatToMarkdown([textResult("system", "session started")], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /## ◇ System/);
  });
});
