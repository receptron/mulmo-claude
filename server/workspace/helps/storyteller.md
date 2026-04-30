# Storyteller Template (MulmoScript)

Use `presentMulmoScript` to create character-driven, narrated stories. Follow this template exactly.

## When to Use

Reach for `presentMulmoScript` when the user asks for a story, fairy tale, narrative, or any character-driven imaginative content meant to be read aloud over visuals.

## Beat Format (CRITICAL)

- Every beat MUST have a top-level `imagePrompt` (string) and `imageNames` (array of character keys from `imageParams.images`).
- NEVER use an `image` object with a `type` field — no `textSlide`, `chart`, `mermaid`, `html_tailwind`, `markdown` on any beat.
- `imagePrompt` and `imageNames` are top-level fields on the beat, NOT nested under `image`.
- Every beat needs both fields, even when a single character appears alone.

## Image Prompts

- Do NOT re-describe character appearance in `imagePrompt` — their look is already encoded in `imageParams.images`.
- Focus the prompt on setting, action, mood, and composition.
- Set the art style ONCE in `imageParams.style` — do NOT repeat it per beat. The style is applied globally.

## Narrator Voice

Set `speechOptions.instruction` on the Narrator speaker to match the story's tone. Pick a `voiceId` from this list:

| Tone | Voice IDs |
|---|---|
| Bright / upbeat | Zephyr, Leda, Autonoe, Callirrhoe |
| Neutral / clear | Kore, Charon, Fenrir, Orus |
| Warm / smooth | Schedar, Sulafat, Despina, Erinome |
| Deep / authoritative | Alnilam, Iapetus, Algieba |
| Soft / gentle | Aoede, Umbriel, Laomedeia, Achernar, Rasalgethi, Pulcherrima, Vindemiatrix, Sadachbia, Sadaltager, Zubenelgenubi |

## Other Rules

- Always use Google providers (`gemini` for TTS, `google` for image generation).
- Default transition: `fade` in `movieParams.transition`, unless the user requests a different style.
- Keep narration text conversational and evocative, as if read aloud to a listener.

## Template

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "The Silver Wolf and the Red-Haired Girl",
  "description": "A girl lost in an enchanted forest befriends a wise silver wolf who shows her the way home.",
  "lang": "en",
  "speechParams": {
    "speakers": {
      "Narrator": {
        "provider": "gemini",
        "voiceId": "Schedar",
        "displayName": { "en": "Narrator" },
        "speechOptions": {
          "instruction": "Speak as a warm, captivating storyteller — slow and deliberate, with gentle wonder for magical moments and tender warmth for emotional ones."
        }
      }
    }
  },
  "imageParams": {
    "provider": "google",
    "model": "gemini-3.1-flash-image",
    "style": "painterly watercolor illustration",
    "images": {
      "mara": {
        "type": "imagePrompt",
        "prompt": "A girl, age 10, with wild curly red hair and bright green eyes, wearing a worn blue dress and muddy boots, curious and brave expression"
      },
      "wolf": {
        "type": "imagePrompt",
        "prompt": "A large silver wolf with a thick luminous coat, wise amber eyes, and a calm, gentle demeanor — majestic but not threatening"
      }
    }
  },
  "movieParams": {
    "provider": "google",
    "model": "veo-3.1-generate",
    "transition": { "type": "fade", "duration": 0.5 }
  },
  "beats": [
    {
      "speaker": "Narrator",
      "text": "Deep in the emerald forest, young Mara wandered further than she ever had before.",
      "imageNames": ["mara"],
      "imagePrompt": "A small figure standing at the edge of a vast ancient forest, towering trees with glowing moss, golden afternoon light filtering through the canopy, a sense of wonder and apprehension"
    },
    {
      "speaker": "Narrator",
      "text": "Then, from the shadows between the roots, came the Silver Wolf — ancient, patient, and utterly still.",
      "imageNames": ["mara", "wolf"],
      "imagePrompt": "A girl and a large wolf facing each other in a misty forest clearing, shafts of light between them, tension softening into curiosity"
    },
    {
      "speaker": "Narrator",
      "text": "Side by side, they walked through the night until the lanterns of home flickered into view.",
      "imageNames": ["mara", "wolf"],
      "imagePrompt": "A girl and a wolf walking together along a moonlit forest path, distant warm cottage lights glowing through the trees, fireflies drifting around them"
    }
  ]
}
```
