# Structured-input UI for LLM choice prompts (#826)

## Goal

When the LLM asks the user to pick from options (color choice,
feature toggles, yes/no confirmation, etc.), let the frontend
render an interactive form (radio / checkbox / textarea / yes-no)
the user clicks through and submits with one button. Submission
becomes the next user-turn text message. Saves the user from
re-typing the LLM's options just to choose one.

## Spec (settled — see #826 for the design discussion)

| Decision | Value |
|---|---|
| Tool name | `askUserChoice` |
| Question types (v1) | `select`, `multiselect`, `text`, `boolean` |
| Submit format | text-only (no JSON sidecar) |
| Post-submit behaviour | whole form disabled, no re-select |
| Default `required` | `true` |
| User ignores form | form stays interactive in chat history |
| Multi-question layout | all vertical, no accordion / steps |
| **Placement** | **canvas plugin pane** (existing pattern — same slot as `manageWiki` / `scheduler` / `canvas`) |

### Placement detail

The form renders in the right-side canvas pane, NOT inline in the
chat thread and NOT above the input box. This matches the existing
plugin convention (every tool result that needs interactive UI
lives in the canvas), so:

- the implementation reuses the existing tool-result → plugin-view
  selection plumbing (no new chat-bubble component)
- the chat thread stays text-only, easier to scroll-read later
- canvas has the room for long option lists and multi-question forms

```
┌────────────────────────────────────────────────────┐
│ chat (left)           │  canvas (right)            │
│                       │                            │
│ user: 色選んで        │  ┌─ askUserChoice ───┐    │
│                       │  │ 色は?              │    │  ← form lives here
│ assistant: 色を選ん   │  │ ⦿ red ○ blue ...  │    │
│ でください [tool:     │  │ [送信]            │    │
│ askUserChoice]        │  └────────────────────┘   │
│                       │                            │
│ ┌─ text box ───┐     │                            │
│ │ Type a task… │     │                            │
│ └──────────────┘     │                            │
└────────────────────────────────────────────────────┘
```

Trade-off accepted: the user's eyes split between the chat (the
question text) and the canvas (the form). The alternative
in-bubble layouts (form rendered inside an assistant message, or
above the text box like a quick-reply bar) were considered and
rejected for v1 — the in-bubble option requires a new rendering
seam in the chat thread; the above-text-box option blurs the line
between "what the LLM asked" and "what I'm about to type". Either
can revisit in a follow-up if real usage shows split-attention is
a real problem.

## Architecture

### Server side

#### 1. MCP tool definition

New file `server/agent/mcp-tools/askUserChoice.ts` defining the
schema. Registered in `server/agent/mcp-tools/index.ts` alongside
existing `readXPost` / `searchX`.

```ts
export const askUserChoice = {
  definition: {
    name: "askUserChoice",
    description:
      "Ask the user a question with structured choices. Use this " +
      "INSTEAD of phrasing a multiple-choice question in plain " +
      "text whenever the user has to pick from a list, toggle " +
      "options, or answer yes/no. Multiple related questions go " +
      "in a single call. Free-form text-only questions can stay " +
      "as plain prose.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["select", "multiselect", "text", "boolean"] },
              label: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              placeholder: { type: "string" },
              default: { /* string | string[] | boolean */ },
              required: { type: "boolean" },
            },
            required: ["id", "type", "label"],
          },
        },
        submitLabel: { type: "string" },
      },
      required: ["questions"],
    },
  },
  prompt:
    "Use askUserChoice whenever the user has to pick from " +
    "options. Prefer it strongly over plain-text choice questions.",
  // The handler echoes the input — the tool's role is to surface
  // the form on the canvas, not to compute anything server-side.
  // The plugin View consumes the resulting tool result and waits
  // for the user to submit.
  async handler(args: Record<string, unknown>): Promise<string> {
    return JSON.stringify(args);
  },
};
```

#### 2. Plugin registration

Add `askUserChoice` to:
- `server/agent/plugin-names.ts` — name → endpoint mapping (if
  the convention requires it; pure tool may not need a route)
- The MCP tool list registered into the bridge

Cross-check existing patterns. May not need a separate
`server/api/routes/askUserChoice.ts` — the tool is read-only on
the server.

### Client side

#### 3. Plugin definition

New folder `src/plugins/askUserChoice/`:

- `definition.ts` — exported `AskUserChoiceData` type, plugin
  config (icon, view component, no preview probably).
- `index.ts` — wires the plugin into `src/plugins/index.ts`.
- `View.vue` — the form renderer. Reads `selectedResult.data`
  for the questions array.

#### 4. Form component

`AskUserChoiceView.vue` rendering:

- Loop over `data.questions`
- Per type:
  - `select` → `<input type="radio">` group, one checked at a time
  - `multiselect` → `<input type="checkbox">` group
  - `text` → `<textarea>` (single-line `<input>` if no newlines
    expected — defer to `placeholder`'s presence, or always
    textarea for simplicity)
  - `boolean` → `<input type="checkbox">` single
- Per question, surface required-marker (`*`) when
  `required !== false`
- Bottom-of-form submit button:
  - Label = `submitLabel` if provided else `t("pluginAskUserChoice.send")`
  - Disabled until every required question has a non-empty answer
  - On click → constructs the text payload and emits a new
    user-turn via the existing `sendTextMessage` prop (already
    threaded through plugin views in App.vue)
- After submit:
  - Flip a local `submitted` ref to true
  - Render every input as `disabled`
  - Show a small "送信済み ✓" badge near the submit button (or
    swap the button to a non-clickable "送信済み" state)

#### 5. Submit text construction

```ts
function buildAnswerText(questions, answers): string {
  const lines = ["回答:"];
  for (const q of questions) {
    const a = answers[q.id];
    let rendered: string;
    if (q.type === "multiselect") rendered = a.length ? a.join(", ") : "(なし)";
    else if (q.type === "boolean") rendered = a ? "yes" : "no";
    else if (q.type === "text") rendered = a.trim() || "(なし)";
    else rendered = a; // select
    lines.push(`- ${q.label}: ${rendered}`);
  }
  return lines.join("\n");
}
```

The text uses `\n- ` bullets so a human reading the chat history
sees something natural and the LLM parses cleanly.

### Prompt nudge

Update `server/agent/prompt.ts` (or wherever the system prompt
assembly lives — there's a single `prompt.ts` in `server/agent/`)
with one sentence in the tool-usage section:

> If the user must pick from options or answer yes/no, prefer the
> `askUserChoice` tool over phrasing the question in plain prose.
> Group related questions in one call.

### i18n

Add to `src/lang/en.ts`:

```ts
pluginAskUserChoice: {
  send: "Send",
  sent: "Sent ✓",
  required: "Required",
  emptyAnswer: "(none)",
}
```

Translate to ja / zh / ko / es / fr / de / pt-BR (8-locale lockstep
per CLAUDE.md). Brand-friendly — match `chatInput.send` tone.

## Tests

`test/plugins/test_askUserChoiceView.ts` (or wherever Vue plugin
tests live):

- Renders one of each type with known questions[]
- Required question disables submit until answered
- Submit triggers `sendTextMessage` with the expected
  multi-line text shape
- After submit, all inputs gain `disabled`, button stays disabled

`test/agent/test_askUserChoice_tool.ts`:

- Tool definition shape validates against the MCP schema
- `handler()` echoes input verbatim

Manual test scenarios in PR description (no automated way to
test the round-trip from LLM → tool → form → submit → next-turn).

## Rollout

Single PR. Behind no flag — the LLM either uses it or doesn't,
and the existing chat input still works for free-form answers.

## Manual test plan (in the implementation PR)

1. Ask Claude: "色は red / blue / green のどれにしますか?". Confirm
   it uses the tool (re-prompt if it falls back to prose).
2. Click "blue" → submit. Verify chat shows the answer text and
   the LLM's next reply takes "blue" into account.
3. Multi-question scenario: "色 + 機能 + 同意" all in one tool call.
4. Required-gating: question with `required: true` must block
   submit.
5. Form-residual: submit, then ask the LLM something else; verify
   the form stays in chat (still disabled).
6. Ignore-form: don't submit, type a new message; verify the form
   stays interactive in history.

## Out of scope (follow-up issues)

- Type extensions: `number` / `date` / `range` / `file`
- Form recall (search past form submissions)
- Folded / accordion layout (B-3 alternative)
- JSON sidecar in submit text (A-2 alternative)
- Cancel button on form
