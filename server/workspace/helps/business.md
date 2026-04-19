# Business Presentation Template (MulmoScript)

Use `presentMulmoScript` to create business presentations. Follow this template exactly.

## When to Use

Reach for `presentMulmoScript` when the user asks for a presentation, slideshow, pitch deck, business review, or any multi-slide structured content.

## Rules

- Always use Google providers (see below)
- Typically 4–8 beats per presentation
- Choose the visual type that best fits each beat's content:
  - `html_tailwind` — title slide, section dividers, closing slide
  - `chart` — data, numbers, comparisons, trends (prefer whenever numbers are involved)
  - `mermaid` — flows, timelines, org charts, architectures, relationships
  - `textSlide` — key-point summary slides (title + bullets)
  - `markdown` — rich text, tables, mixed content
- Do NOT use `imagePrompt` or `moviePrompt` in business presentations
- Write concise, professional narration text for each beat (becomes the voiceover)
- Put a 1–2 sentence summary of the whole presentation in the top-level `description` field

## Template

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "Q2 Business Review",
  "description": "Quarterly business review covering revenue, pipeline, and Q3 roadmap.",
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
  "imageParams": { "provider": "google", "model": "gemini-2.5-flash-image" },
  "movieParams": { "provider": "google", "model": "veo-2.0-generate-001" },
  "textSlideParams": { "cssStyles": "body { background-color: white; }" },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "Welcome to the Q2 Business Review. Today we cover revenue performance, pipeline health, and our roadmap for Q3.",
      "image": {
        "type": "html_tailwind",
        "html": "<div class=\"flex flex-col items-center justify-center h-full bg-gradient-to-br from-slate-800 to-blue-900 text-white\"><h1 class=\"text-5xl font-bold mb-3\">Q2 Business Review</h1><p class=\"text-xl text-blue-300\">Revenue · Pipeline · Roadmap</p></div>"
      }
    },
    {
      "speaker": "Presenter",
      "text": "Revenue grew 18% quarter-over-quarter, with SaaS subscriptions now accounting for 72% of total revenue.",
      "image": {
        "type": "chart",
        "title": "Quarterly Revenue ($M)",
        "chartData": {
          "type": "bar",
          "data": {
            "labels": ["Q3 '24", "Q4 '24", "Q1 '25", "Q2 '25"],
            "datasets": [{ "label": "Revenue", "data": [4.2, 4.8, 5.1, 6.0] }]
          }
        }
      }
    },
    {
      "speaker": "Presenter",
      "text": "Our sales pipeline follows a five-stage process from lead generation through to closed-won.",
      "image": {
        "type": "mermaid",
        "title": "Sales Pipeline",
        "code": {
          "kind": "text",
          "text": "graph LR\n  A[Lead] --> B[Qualified]\n  B --> C[Proposal]\n  C --> D[Negotiation]\n  D --> E[Closed Won]"
        }
      }
    },
    {
      "speaker": "Presenter",
      "text": "Key highlights from this quarter include three enterprise wins, a 94% renewal rate, and NPS up 12 points.",
      "image": {
        "type": "textSlide",
        "slide": {
          "title": "Q2 Highlights",
          "bullets": [
            "3 new enterprise accounts closed",
            "94% subscription renewal rate",
            "NPS improved from 41 to 53"
          ]
        }
      }
    },
    {
      "speaker": "Presenter",
      "text": "In Q3 we will focus on three strategic initiatives: expanding into APAC, launching the self-serve tier, and completing the SOC 2 audit.",
      "image": {
        "type": "markdown",
        "markdown": "## Q3 Strategic Initiatives\n\n| Initiative | Owner | Target Date |\n|---|---|---|\n| APAC expansion | Sales | Aug 31 |\n| Self-serve tier launch | Product | Sep 15 |\n| SOC 2 Type II audit | Engineering | Sep 30 |"
      }
    }
  ]
}
```
