import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentMulmoScript";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: `Save and present a MulmoScript story or presentation as a visual storyboard in the canvas.

Always use Google providers. Required structure:

{
  "$mulmocast": { "version": "1.1" },
  "title": "The Life of a Star",
  "description": "A short educational explainer about stellar evolution",
  "lang": "en",
  "speechParams": {
    "speakers": {
      "Presenter": {
        "provider": "gemini",
        "voiceId": "Kore",
        "displayName": { "en": "Presenter" }
      }
    }
  },
  "imageParams": { "provider": "google", "model": "gemini-3.1-flash-image" },
  "movieParams": { "provider": "google", "model": "veo-3.1-generate" },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "Narration spoken aloud for this beat.",
      "imagePrompt": "Detailed description — AI generates the image"
    },
    {
      "speaker": "Presenter",
      "text": "Bullet point beat.",
      "image": { "type": "textSlide", "slide": { "title": "Slide Title", "bullets": ["Point one", "Point two"] } }
    },
    {
      "speaker": "Presenter",
      "text": "Markdown beat.",
      "image": { "type": "markdown", "markdown": "## Heading\\n\\nBody text here." }
    },
    {
      "speaker": "Presenter",
      "text": "Chart beat — use for data, comparisons, trends.",
      "image": { "type": "chart", "title": "Chart Title", "chartData": { "type": "bar", "data": { "labels": ["A", "B", "C"], "datasets": [{ "label": "Series", "data": [10, 20, 30] }] } } }
    },
    {
      "speaker": "Presenter",
      "text": "Diagram beat — use for flows, architectures, relationships.",
      "image": { "type": "mermaid", "title": "Diagram Title", "code": { "kind": "text", "text": "graph TD\\n  A[Start] --> B[Process] --> C[End]" } }
    },
    {
      "speaker": "Presenter",
      "text": "Rich interactive beat — use for custom layouts, animations, or anything that benefits from HTML/CSS.",
      "image": { "type": "html_tailwind", "html": "<div class=\\"flex items-center justify-center h-full text-4xl font-bold text-blue-600\\">Hello World</div>" }
    },
    {
      "speaker": "Presenter",
      "text": "AI video beat.",
      "moviePrompt": "Detailed description — AI generates the video clip"
    }
  ]
}

Beat visual options (choose one per beat):
- "imagePrompt": "..."  → top-level string field — AI generates an image from the prompt
- "moviePrompt": "..."  → top-level string field — AI generates a video clip from the prompt
- "image": { "type": "textSlide", "slide": { "title", "subtitle"?, "bullets"? } }
- "image": { "type": "markdown", "markdown": "..." }
- "image": { "type": "chart", "title": "...", "chartData": { "type": "bar"|"line"|"pie"|..., "data": { "labels": [...], "datasets": [...] } } }  ← PREFER for data/numbers/comparisons. chartData is a full Chart.js config: labels/datasets go under "data", not at the top level.
- "image": { "type": "mermaid", "title": "...", "code": { "kind": "text", "text": "..." } }  ← PREFER for flows/diagrams/relationships
- "image": { "type": "html_tailwind", "html": "...", "script"?: "..." }  ← PREFER for rich layouts, animations, custom visuals

IMPORTANT: "imagePrompt" and "moviePrompt" are plain string fields on the beat, NOT nested under "image".`,
  parameters: {
    type: "object",
    properties: {
      script: {
        type: "object",
        description:
          "Complete MulmoScript JSON. Must include $mulmocast, speechParams, imageParams, movieParams, and beats array. Always populate the top-level 'description' field with a concise 1–2 sentence summary of the presentation.",
        additionalProperties: true,
      },
      filename: {
        type: "string",
        description: "Optional filename without extension. Defaults to a slug of the script title.",
      },
    },
    required: ["script"],
  },
};

export default toolDefinition;
