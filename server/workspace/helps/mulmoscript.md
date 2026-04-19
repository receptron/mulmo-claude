# MulmoScript

MulmoScript is a JSON/YAML format for authoring multimedia stories — narrated slideshows that can be rendered as video. Each script describes a sequence of **beats** (slides), each with a speaker, narration text, and a visual element.

MulmoScript files are rendered in the canvas. The underlying engine is [mulmocast](https://github.com/receptron/mulmocast).

## Provider Note

**Always use Google providers** for all generation in this app:

| Purpose | Provider | Example config |
|---|---|---|
| TTS (speech) | `gemini` | `"provider": "gemini", "voiceId": "Kore"` |
| Image generation | `google` | `"provider": "google", "model": "gemini-2.5-flash-image"` |
| Video generation | `google` | `"provider": "google", "model": "veo-2.0-generate-001"` |

Do not use `openai`, `elevenlabs`, or other providers — they are not configured in this app.

## Top-Level Structure

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "My Story",
  "lang": "en",
  "canvasSize": { "width": 1280, "height": 720 },
  "speechParams": { ... },
  "imageParams": { ... },
  "audioParams": { ... },
  "beats": [ ... ]
}
```

| Field | Required | Description |
|---|---|---|
| `$mulmocast` | Yes | Header — `version` must be `"1.1"` |
| `beats` | Yes | Array of beats (slides) |
| `title` | No | Script title |
| `description` | No | Short description |
| `lang` | No | Default language code (e.g. `"en"`, `"ja"`) |
| `canvasSize` | No | Pixel dimensions, default 1280×720 |
| `speechParams` | No | TTS speaker configuration |
| `imageParams` | No | Image generation configuration |
| `movieParams` | No | Video rendering and filter options |
| `audioParams` | No | BGM, volume, padding, ducking |
| `captionParams` | No | Caption language and style |
| `slideParams` | No | Global slide theme (colors, fonts, branding) |
| `references` | No | Source citations `[{ url, title?, description?, type? }]` |

## Beats

Each beat is one slide in the presentation.

```json
{
  "speaker": "Presenter",
  "text": "Welcome to this story.",
  "image": { "type": "markdown", "markdown": "# Hello World" }
}
```

| Field | Description |
|---|---|
| `speaker` | Speaker name (must match a key in `speechParams.speakers`) |
| `text` | Narration text read aloud by TTS |
| `texts` | Alternative: array of text segments |
| `id` | Optional identifier for cross-referencing |
| `description` | Internal note, not rendered |
| `image` | Visual content — one of the media types below |

## Image (Visual) Types

### `markdown`
Render Markdown as a slide image.

```json
{ "type": "markdown", "markdown": "## My Slide\n- Point one\n- Point two" }
```

Supports layout variants:
- **Simple**: `"markdown": "# Title\nContent..."` (string or string array)
- **Content**: `"markdown": { "content": "..." }`
- **Two columns**: `"markdown": { "row-2": ["Left content", "Right content"] }`
- **2×2 grid**: `"markdown": { "2x2": ["A", "B", "C", "D"] }`
- **With header/sidebar**: add `"header"` and/or `"sidebar-left"` keys

Optional: `style` (CSS string), `backgroundImage`.

### `slide`
Structured slide with a typed layout system and theming.

```json
{
  "type": "slide",
  "slide": {
    "layout": "title",
    "title": "My Presentation",
    "subtitle": "A subtitle"
  }
}
```

**Layouts**: `"title"`, `"columns"`

Column content item types: `text`, `bullets`, `code`, `callout`, `metric`, `divider`, `image`, `imageRef`, `chart`, `mermaid`, `table`

Optional: per-slide `theme` override.

### `textSlide`
Simple title + bullets slide.

```json
{
  "type": "textSlide",
  "slide": { "title": "Key Points", "subtitle": "Optional", "bullets": ["One", "Two"] }
}
```

### `image`
Embed an existing image.

```json
{ "type": "image", "source": { "kind": "url", "url": "https://..." } }
{ "type": "image", "source": { "kind": "path", "path": "assets/photo.png" } }
```

Source kinds: `url`, `base64`, `path`

### `chart`
Render a chart from data.

```json
{ "type": "chart", "title": "Sales", "chartData": { "type": "bar", "data": { ... } } }
```

### `mermaid`
Render a Mermaid diagram.

```json
{
  "type": "mermaid",
  "title": "System Flow",
  "code": { "kind": "text", "text": "graph TD\n  A --> B" }
}
```

Code source kinds: `url`, `base64`, `text`, `path`

### `html_tailwind`
Custom HTML + Tailwind CSS slide.

```json
{
  "type": "html_tailwind",
  "html": "<div class='text-4xl font-bold'>Hello</div>",
  "animation": true
}
```

Optional: `script` (JS), `elements` (swipe elements), `animation` (`true` or `{ fps, movie? }`).

### `web`
Embed a web page.

```json
{ "type": "web", "url": "https://example.com" }
```

### `pdf` / `svg` / `movie`
Embed a file by source (url/base64/path).

### `moviePrompt`
Generate a video clip from a text prompt.

```json
{ "type": "moviePrompt", "prompt": "A sunset over the ocean" }
```

## speechParams

Configure TTS voices per speaker.

```json
{
  "speechParams": {
    "speakers": {
      "Presenter": {
        "provider": "gemini",
        "voiceId": "Kore",
        "isDefault": true,
        "displayName": { "en": "Presenter" }
      }
    }
  }
}
```

Each speaker supports per-language voice overrides via a `lang` map.

## audioParams

Control BGM and volume mixing.

```json
{
  "audioParams": {
    "bgm": { "kind": "path", "path": "music/theme.mp3" },
    "bgmVolume": 0.3,
    "audioVolume": 1.0,
    "padding": 0.5,
    "suppressSpeech": false
  }
}
```

## Minimal Example

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "Hello World",
  "lang": "en",
  "speechParams": {
    "speakers": {
      "Presenter": { "provider": "gemini", "voiceId": "Kore", "displayName": { "en": "Presenter" } }
    }
  },
  "imageParams": { "provider": "google", "model": "gemini-2.5-flash-image" },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "Welcome to my story.",
      "image": {
        "type": "textSlide",
        "slide": { "title": "Hello World", "bullets": ["Simple", "Clear", "Visual"] }
      }
    },
    {
      "speaker": "Presenter",
      "text": "Here is a diagram of the process.",
      "image": {
        "type": "mermaid",
        "title": "Process Flow",
        "code": { "kind": "text", "text": "graph LR\n  A[Start] --> B[Process] --> C[End]" }
      }
    }
  ]
}
```
