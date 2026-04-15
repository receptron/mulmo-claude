---
name: url-to-video
description: Create a MulmoScript video from a URL — fetch article, write script, generate movie
allowed-tools: WebFetch, WebSearch, Bash, Write, Read
user-invocable: true
---

# /url-to-video — URL to Video

Create a horizontal (16:9) video from a URL. Fetches the article, writes a MulmoScript JSON file, and runs `npx mulmocast movie` to generate the video.

## Input

```
/url-to-video <URL>
```

`$ARGUMENTS` contains the URL (and optionally additional instructions).

## Language Detection

Detect the language from:
1. The article content language
2. The user's query language (if they wrote additional instructions)
3. Default to English if ambiguous

Use the detected language for:
- `lang` field in the script
- All beat `text` (narration)
- Slide titles and content
- Speaker voice selection
- Caption language flag (`-c ja` for Japanese, omit for English)

### Voice Selection by Language

| Language | Provider | voiceId |
|----------|----------|---------|
| Japanese | kotodama | jikkyo_baby |
| English | gemini | Kore |
| Other | gemini | Kore |

## Workflow

### Phase 1: Fetch & Analyze

1. Fetch the URL content with WebFetch
2. Extract: title, key points, data/numbers, quotes, structure
3. Determine the language and tone

### Phase 2: Script Design

Design a 3-6 beat presentation (60-120 seconds):

| Beat | Role | Duration |
|------|------|----------|
| 1 | **INTRO** — Hook + topic overview | ~15-20s |
| 2-N | **BODY** — Key points, data, analysis | ~15-20s each |
| Last | **SUMMARY** — Takeaway + closing thought | ~10-15s |

### Beat Visual Guidelines

Choose the best visual type for each beat's content:

- **imagePrompt** — For scenes, concepts, atmosphere. Write detailed prompts in English regardless of content language
- **textSlide** — For titles, bullet point summaries
- **chart** — For data comparisons, trends, statistics (Chart.js format)
- **mermaid** — For flows, processes, relationships, architectures
- **markdown** — For detailed text, code, tables
- **html_tailwind** — For custom layouts, rich visuals

Mix visual types across beats for variety. Never use the same type for all beats.

### Phase 3: Write Script File

1. Write the MulmoScript JSON to `stories/<slug>.json` in the workspace directory

Required structure:

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "...",
  "description": "1-2 sentence summary",
  "lang": "<detected language code>",
  "speechParams": {
    "speakers": {
      "Presenter": {
        "provider": "<see voice table>",
        "voiceId": "<see voice table>",
        "displayName": { "<lang>": "Presenter" }
      }
    }
  },
  "imageParams": { "provider": "google", "model": "gemini-3.1-flash-image" },
  "beats": [ ... ]
}
```

### Phase 4: Generate Images

Run mulmocast to generate images for the storyboard:

```bash
npx mulmocast@latest images stories/<slug>.json
```

This generates the images so the storyboard is viewable in the Web UI.

After completion, tell the user the script is ready and they can:
- View the storyboard in the Web UI (reload if needed)
- Use the "Generate Movie" button in the canvas to create the video

### Rules

1. **Always populate `description`** — concise summary of the presentation
2. **One topic per video** — don't split the article into multiple videos
3. **Lead with the most interesting finding** — don't bury the lede
4. **Use concrete numbers** — data makes content compelling
5. **imagePrompt must be in English** — even for Japanese content
6. **Keep narration natural** — conversational tone, not robotic reading
7. **End with a thought-provoking statement** — leave the viewer thinking
