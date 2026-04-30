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
  it("renders a user/assistant exchange as blockquoted turns", () => {
    const out = exportChatToMarkdown([textResult("user", "hello"), textResult("assistant", "hi there")], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Conversation/);
    assert.match(out, /### 👤 You/);
    assert.match(out, /### 🤖 Assistant/);
    assert.match(out, /^> hello$/m);
    assert.match(out, /^> hi there$/m);
  });

  it("includes the role name in the title when provided", () => {
    const out = exportChatToMarkdown([textResult("user", "hi")], { sessionRoleName: "General", exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Conversation · General/);
  });

  it("preserves markdown inside a message by quoting every line", () => {
    const inner = "# Heading\n\nBody line\n\n## Sub\n- item";
    const out = exportChatToMarkdown([textResult("assistant", inner)], { exportedAt: "2026-04-30T12:00:00Z" });
    // every non-empty source line becomes "> ..."
    assert.match(out, /^> # Heading$/m);
    assert.match(out, /^> Body line$/m);
    assert.match(out, /^> ## Sub$/m);
    assert.match(out, /^> - item$/m);
    // blank lines inside the message stay inside the quote (bare ">")
    assert.match(out, /^>$/m);
  });

  it("renders non-text tool calls as a single italic line", () => {
    const out = exportChatToMarkdown(
      [textResult("user", "show todos"), toolResult("manageTodoList", "Today's todos", "tool-1"), textResult("assistant", "here you go")],
      { exportedAt: "2026-04-30T12:00:00Z" },
    );
    assert.match(out, /\*🔧 manageTodoList — Today's todos.*\*/);
    // tool line is NOT inside a blockquote
    assert.doesNotMatch(out, /^> \*🔧 manageTodoList/m);
  });

  it("falls back to tool name when title is missing", () => {
    const out = exportChatToMarkdown([toolResult("manageWiki", undefined, "tool-2")], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /\*🔧 manageWiki\*/);
  });

  it("renders a header even for an empty session", () => {
    const out = exportChatToMarkdown([], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /^# Conversation/);
    assert.match(out, /Exported 2026-04-30/);
  });

  it("includes time stamps when resultTimestamps has the uuid", () => {
    const stamps = new Map<string, number>([["t-user", Date.UTC(2026, 3, 30, 14, 35)]]);
    const out = exportChatToMarkdown([textResult("user", "hi")], { resultTimestamps: stamps, exportedAt: "2026-04-30T12:00:00Z" });
    // 14:35 UTC will be locale-shifted on the renderer; assert "·" + HH:MM shape.
    assert.match(out, /### 👤 You · \d{2}:\d{2}/);
  });

  it("treats system role correctly", () => {
    const out = exportChatToMarkdown([textResult("system", "session started")], { exportedAt: "2026-04-30T12:00:00Z" });
    assert.match(out, /### ⚙️ System/);
  });
});
