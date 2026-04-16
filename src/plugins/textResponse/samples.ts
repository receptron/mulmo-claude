/**
 * Text Response Plugin - Samples
 */

import type { ToolSample } from "gui-chat-protocol";

export const samples: ToolSample[] = [
  {
    name: "Simple Text",
    args: {
      text: "Hello, this is a simple text response from the assistant.",
      role: "assistant",
    },
  },
  {
    name: "System Message",
    args: {
      text: "System: Configuration has been updated successfully.",
      role: "system",
    },
  },
  {
    name: "User Message",
    args: {
      text: "User: What is the weather like today?",
      role: "user",
    },
  },
  {
    name: "Markdown Content",
    args: {
      text: `# Markdown Example

This demonstrates **bold** and *italic* text.

## Features
- List item 1
- List item 2
- List item 3

### Code Example
\`\`\`javascript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

> This is a blockquote with important information.

| Column A | Column B |
|----------|----------|
| Data 1   | Data 2   |
| Data 3   | Data 4   |
`,
      role: "assistant",
    },
  },
  {
    name: "JSON Data",
    args: {
      text: JSON.stringify(
        {
          name: "Example",
          version: "1.0.0",
          features: ["markdown", "json", "roles"],
        },
        null,
        2,
      ),
      role: "assistant",
    },
  },
  {
    name: "Think Block",
    args: {
      text: `Let me analyze this problem.

<think>
First, I need to consider the requirements:
1. The solution should be efficient
2. It must handle edge cases
3. Code should be readable
</think>

Based on my analysis, here's my recommendation...`,
      role: "assistant",
    },
  },
  {
    name: "With Transport",
    args: {
      text: "This response came from a specific transport provider.",
      role: "assistant",
      transportKind: "openai-realtime",
    },
  },
];
