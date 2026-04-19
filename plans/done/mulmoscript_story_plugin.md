# MulmoScript Story Plugin — Plan

## Goal

Add a `presentMulmoScript` local plugin that lets Claude generate a story or presentation in [MulmoScript](https://github.com/receptron/mulmocast-cli/blob/main/src/types/schema.ts) format and present it visually to the user as an interactive storyboard in the canvas.

---

## User Flow

1. User asks a story/presentation role to create content (e.g. "Make a 5-slide intro to quantum computing")
2. Claude constructs a valid `mulmoScript` JSON following the schema
3. Claude calls `presentMulmoScript` with the assembled script
4. The plugin saves the script to `<workspace>/stories/<filename>.json`
5. The canvas renders an interactive storyboard view — one card per beat showing narration text, speaker, and visual type
6. The sidebar preview shows the script title and beat count

---

## MulmoScript Schema Summary (from `mulmo/src/types/schema.ts`)

A minimal valid script that the LLM should produce:

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "Story title",
  "lang": "en",
  "speechParams": {
    "provider": "gemini",
    "speakers": {
      "Presenter": {
        "provider": "gemini",
        "voiceId": "Kore",
        "displayName": { "en": "Presenter" }
      }
    }
  },
  "imageParams": {
    "provider": "google",
    "model": "gemini-2.5-flash-image"
  },
  "movieParams": {
    "provider": "google",
    "model": "veo-2.0-generate-001"
  },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "Narration text for this beat",
      "image": {
        "type": "markdown",
        "markdown": "## Slide content\n\nBody text here"
      }
    }
  ]
}
```

### Google provider details (from `mulmo/src/types/provider2agent.ts`)

| Capability | Provider key | Recommended model | API key env var |
|---|---|---|---|
| Text-to-speech | `"gemini"` | `"gemini-2.5-flash-preview-tts"` | `GEMINI_API_KEY` |
| Image generation | `"google"` | `"gemini-2.5-flash-image"` | `GEMINI_API_KEY` |
| Video generation | `"google"` | `"veo-2.0-generate-001"` | `GEMINI_API_KEY` |

**TTS voice**: The `gemini` TTS provider's default voice is `"Kore"`. This must be set as `voiceId` on the speaker entry (not `"shimmer"`, which is OpenAI-specific).

**Image models available** (`provider: "google"`): `imagen-4.0-generate-001`, `imagen-4.0-ultra-generate-001`, `imagen-4.0-fast-generate-001`, `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`

**Movie models available** (`provider: "google"`): `veo-2.0-generate-001`, `veo-3.0-generate-001`, `veo-3.1-generate-preview`

All three providers share the same `GEMINI_API_KEY` — a single key covers TTS, images, and video.

Supported `image.type` values: `markdown`, `textSlide`, `html_tailwind`, `mermaid`, `chart`, `imagePrompt`, `moviePrompt`

---

## Implementation

### 1. `src/plugins/presentMulmoScript/definition.ts`

Tool name: `presentMulmoScript`

Input schema:
```typescript
{
  script: object,     // Full MulmoScript JSON (required) — Claude assembles this
  filename?: string   // Optional filename (without extension), defaults to slugified title
}
```

The schema description must guide Claude to produce valid MulmoScript, referencing the beat structure, speaker dictionary, and image types.

### 2. `src/plugins/presentMulmoScript/index.ts`

- Imports `toolDefinition` from `./definition`
- `execute(args)`:
  - Validates the script has required fields (`$mulmocast`, `beats`, `speechParams`)
  - Derives filename from `args.filename` or slug of `script.title`, timestamped to avoid collisions
  - Writes the script as pretty-printed JSON to `<workspacePath>/stories/<filename>.json`
  - Returns a `ToolResult` with `type: "presentMulmoScript"`, the script data, and the saved path
- Exports `viewComponent` (View.vue) and `previewComponent` (Preview.vue)

### 3. `src/plugins/presentMulmoScript/View.vue`

Storyboard view — renders the full script visually:

```
┌─────────────────────────────────────────┐
│  Title: "Intro to Quantum Computing"    │
│  5 beats · en · saved to stories/…     │
├─────┬───────────────────────────────────┤
│  1  │ [markdown]  Presenter             │
│     │ ## What is a Qubit?               │
│     │ ───────────────────────           │
│     │ "Today we explore quantum bits…"  │
├─────┼───────────────────────────────────┤
│  2  │ [textSlide]  Presenter            │
│     │ Title: Superposition              │
│     │ ───────────────────────           │
│     │ "A qubit can be 0 and 1 at once…" │
└─────┴───────────────────────────────────┘
```

Each beat card shows:
- Beat index and optional `id`
- Image type badge (`markdown`, `textSlide`, `imagePrompt`, etc.)
- Speaker name
- Image content preview (markdown excerpt, slide title+bullets, prompt text, etc.)
- Narration `text`

Include a "Download JSON" button that triggers a browser download of the saved file.

### 4. `src/plugins/presentMulmoScript/Preview.vue`

Sidebar preview — shows:
- Script title (or filename)
- Beat count
- Small beat type breakdown (e.g. "3× markdown, 2× textSlide")

### 5. `server/api/routes/mulmo-script.ts`

`POST /api/mulmo-script`:
- Reads `script` and optional `filename` from the request body
- Creates `<workspacePath>/stories/` directory if it doesn't exist
- Derives a safe filename (slug + timestamp + `.json`)
- Writes the script to disk
- Returns `{ message, filePath, script }` for the MCP server to pass back

### 6. Wire-up (4 files)

**`server/agent/mcp-server.ts`**
- Import `toolDefinition` from `../src/plugins/presentMulmoScript/definition.js`
- Add `presentMulmoScript` to `TOOL_ENDPOINTS` → `"/api/mulmo-script"`
- Add `toolDefinition` to the `ALL_TOOLS` spread array

**`src/tools/index.ts`**
- Import plugin from `../plugins/presentMulmoScript/index`
- Register as `presentMulmoScript` in the `plugins` map

**`src/config/roles.ts`**
- Add a new `storyteller` role (see below)
- Optionally add `presentMulmoScript` to the `office` role

**`server/agent/index.ts`**
- Add `"presentMulmoScript"` to `MCP_PLUGINS`

---

## New Role: `storyteller`

```typescript
{
  id: "storyteller",
  name: "Storyteller",
  icon: "auto_stories",
  prompt: `You are a creative storyteller and presentation designer.

When asked to create a story, presentation, explainer, or educational video:
1. Decide on the number of beats (typically 4–8)
2. Choose appropriate image types per beat (markdown for text-heavy slides, textSlide for title/bullet slides, imagePrompt to describe a generated image, mermaid for diagrams)
3. Write clear narration text for each beat (this becomes the voiceover)
4. Assemble the complete mulmoScript JSON following the template below exactly
5. Call presentMulmoScript with the assembled script

Always use Google providers as shown in the template. Keep beat texts conversational and engaging.

## MulmoScript Template

\`\`\`json
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
  "imageParams": {
    "provider": "google",
    "model": "gemini-2.5-flash-image"
  },
  "movieParams": {
    "provider": "google",
    "model": "veo-2.0-generate-001"
  },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "Every star you see in the night sky began its life inside a vast cloud of gas and dust called a nebula.",
      "image": {
        "type": "imagePrompt",
        "prompt": "A vast colorful nebula in deep space, swirling clouds of purple and gold gas, stars forming within"
      }
    },
    {
      "speaker": "Presenter",
      "text": "Gravity pulls the gas together until the core grows so hot and dense that nuclear fusion ignites — and a star is born.",
      "image": {
        "type": "textSlide",
        "slide": {
          "title": "Birth of a Star",
          "bullets": [
            "Nebula collapses under gravity",
            "Core temperature reaches 10 million °C",
            "Hydrogen fusion begins"
          ]
        }
      }
    },
    {
      "speaker": "Presenter",
      "text": "Our own Sun has been burning steadily for 4.6 billion years and will continue for another 5 billion more.",
      "image": {
        "type": "markdown",
        "markdown": "## The Main Sequence\\n\\nStars spend most of their lives in a stable phase, balancing gravity and radiation pressure.\\n\\n- **Small stars** burn for trillions of years\\n- **Medium stars** (like our Sun) burn for ~10 billion years\\n- **Massive stars** burn out in just millions of years"
      }
    },
    {
      "speaker": "Presenter",
      "text": "When a massive star finally exhausts its fuel, it collapses in an instant and explodes as a supernova — one of the most energetic events in the universe.",
      "image": {
        "type": "imagePrompt",
        "prompt": "A dramatic supernova explosion in space, shockwave of light and energy expanding outward, remnant nebula forming"
      }
    },
    {
      "speaker": "Presenter",
      "text": "The heavier elements forged in that explosion — carbon, oxygen, iron — scattered across space to eventually form new planets and, one day, life itself.",
      "image": {
        "type": "textSlide",
        "slide": {
          "title": "We Are Stardust",
          "subtitle": "The atoms in your body were forged in dying stars"
        }
      }
    }
  ]
}
\`\`\``,
  availablePlugins: ["presentMulmoScript", "switchRole"],
  queries: [
    "Create a 5-slide intro to quantum computing",
    "Make a short story about a robot who learns to paint",
    "Build a presentation explaining the water cycle to kids",
  ],
}
```

---

## File Checklist

```
src/plugins/presentMulmoScript/
  definition.ts          ← tool schema only (no Vue)
  index.ts               ← execute() + Vue component refs
  View.vue               ← storyboard canvas view
  Preview.vue            ← sidebar preview
server/api/routes/mulmo-script.ts  ← POST /api/mulmo-script
```

Edits to existing files:
- `server/agent/mcp-server.ts` — import def, add endpoint, add to ALL_TOOLS
- `src/tools/index.ts` — register plugin
- `src/config/roles.ts` — add storyteller role (+ optionally office)
- `server/agent/index.ts` — add to MCP_PLUGINS
- `server/index.ts` (or wherever routes are mounted) — mount the new route

---

## Notes & Decisions

- **Claude generates the script, not a separate LLM call.** The tool is a save-and-display operation; the intelligence is in Claude's tool call.
- **Google providers must be explicitly set** — the mulmo defaults are OpenAI/Replicate, so all three provider blocks (`speechParams`, `imageParams`, `movieParams`) must be present with explicit Google values. The `definition.ts` tool description should include the canonical template so Claude always copies it correctly.
- **TTS provider is `"gemini"`, not `"google"`** — the `"google"` TTS provider is the older Cloud TTS; `"gemini"` is the Gemini-native TTS (model `gemini-2.5-flash-preview-tts`, voice `"Kore"`). This distinction must be clear in the tool description to avoid Claude using the wrong key.
- **No schema validation on the server** beyond presence checks — trust Claude to produce valid JSON. Zod validation can be added later.
- **Workspace sub-directory `stories/`** keeps MulmoScript files discoverable and separate from todos/calendar/etc.
- **`currentMulmoScriptVersion`** in the schema is `"1.1"` — the `$mulmocast.version` field should be hardcoded to this in the tool description so Claude always gets it right.
- All three Google capabilities share `GEMINI_API_KEY` — only one env var is needed.
- The saved `.json` files are ready to pass directly to the `mulmo` CLI for rendering into video.
