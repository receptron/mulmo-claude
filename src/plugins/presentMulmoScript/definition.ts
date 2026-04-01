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
- "image": { "type": "mermaid", "title": "...", "code": { "kind": "text", "text": "..." } }
- "image": { "type": "chart", "title": "...", "chartData": { ... } }

IMPORTANT: "imagePrompt" and "moviePrompt" are plain string fields on the beat, NOT nested under "image".`,
  parameters: {
    type: "object",
    properties: {
      script: {
        type: "object",
        description:
          "Complete MulmoScript JSON. Must include $mulmocast, speechParams, imageParams, movieParams, and beats array.",
        additionalProperties: true,
      },
      filename: {
        type: "string",
        description:
          "Optional filename without extension. Defaults to a slug of the script title.",
      },
    },
    required: ["script"],
  },
};

export default toolDefinition;
