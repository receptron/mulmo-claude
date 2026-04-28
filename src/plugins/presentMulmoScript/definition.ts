import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentMulmoScript";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: `Save and present a MulmoScript story or presentation as a visual storyboard in the canvas.

Two modes — provide EXACTLY ONE of \`script\` or \`filePath\`:

1. **Create new** — pass \`script\` (full MulmoScript JSON). Server saves it to disk and presents it.
2. **Re-display existing** — pass \`filePath\` (workspace-relative path returned by a previous call, e.g. "stories/my-story-1700000000000.json"). Much cheaper than re-sending the full script. Use whenever the user wants to revisit a presentation that was already created in this workspace.

Optional \`autoGenerateMovie: true\` kicks off movie generation in the background, so the final video is ready by the time the user opens the canvas. Movie generation is expensive (multiple image + audio API calls + video encoding) — only set this when the user has explicitly asked for the movie. Default \`false\`.

Provider rules for new scripts:
- \`speechParams.speakers.<name>.provider\`: \`"gemini"\` — pairs with Gemini voices like \`"Kore"\`, \`"Aoede"\`, \`"Puck"\`. Do NOT use \`"google"\` here — that routes to Google Cloud TTS, where Gemini-class voices fail with "This voice requires a model name to be specified." unless an explicit \`model\` is set.
- \`imageParams.provider\`: \`"google"\`
- \`movieParams.provider\`: \`"google"\`
- Do NOT add a top-level \`provider\` field to \`speechParams\` — provider belongs per-speaker only.

Required structure:

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
          "Complete MulmoScript JSON for a NEW presentation. Must include $mulmocast, speechParams, imageParams, movieParams, and beats array. Always populate the top-level 'description' field with a concise 1–2 sentence summary of the presentation. Do NOT pass alongside `filePath`.",
        additionalProperties: true,
      },
      filename: {
        type: "string",
        description:
          "Optional filename without extension. Defaults to a slug of the script title. Only meaningful with `script`; ignored when `filePath` is given.",
      },
      filePath: {
        type: "string",
        description:
          "Workspace-relative path to an EXISTING MulmoScript JSON file (e.g. 'stories/my-story-1700000000000.json'). Use this to re-display a script previously saved in this workspace, instead of resending the full JSON. Do NOT pass alongside `script`.",
      },
      autoGenerateMovie: {
        type: "boolean",
        description:
          "When true, the server starts movie generation in the background after save/load. The user does NOT need to open the canvas — progress streams via the existing session channel. Default false. Only set true when the user has explicitly asked for the movie; generation is expensive.",
      },
    },
    required: [],
  },
};

export default toolDefinition;
