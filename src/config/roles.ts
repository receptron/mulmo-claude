import { z } from "zod";
import { ALL_TOOL_NAMES, TOOL_NAMES, isToolName, type ToolName } from "./toolNames";

// `availablePlugins` accepts every literal listed in `TOOL_NAMES`.
// Compile time: roles.ts static definitions below get typed as
// `ToolName[]` via RoleSchema's zod inference, so `presentHTML` vs
// `presentHtml` kind of typos are caught immediately.
//
// Runtime: take any string array and filter out unknown names
// rather than failing the whole parse. A persisted custom role
// file may still reference a tool that was removed in a later
// release (e.g. `manageRoles` post-#949 / #951), and we want
// such a role to keep loading with the dead reference silently
// dropped — the alternative is `loadCustomRoles` swallowing the
// whole role, which makes the user's edits disappear from
// `/roles` for no obvious reason. Frontend create/update goes
// through a plugin-picker UI that only emits valid names, so the
// lenient parse doesn't weaken create-time validation.
const toolNameEnum = z.enum(ALL_TOOL_NAMES as readonly [ToolName, ...ToolName[]]);
const availablePluginsSchema = z
  .union([z.array(z.string()), z.array(toolNameEnum)])
  .transform((plugins) => plugins.filter((plugin): plugin is ToolName => isToolName(plugin)));

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  prompt: z.string(),
  availablePlugins: availablePluginsSchema,
  queries: z.array(z.string()).optional(),
});

export type Role = z.infer<typeof RoleSchema>;

export const ROLES: Role[] = [
  {
    id: "general",
    name: "General",
    icon: "star",
    prompt:
      "You are a helpful assistant with access to the user's workspace. Help with tasks, answer questions, and use available tools when appropriate.\n\n" +
      "## Asking the user to choose\n\n" +
      "When the user must pick from a small set of options, toggle features, or answer yes/no, call presentForm with the appropriate fields (radio for one-of, checkbox for many-of, text/textarea for free-form). Group related questions into one form. Prefer this strongly over phrasing the choice in plain prose — the form gives the user clickable controls and sends the answers back as a markdown bullet list.\n\n" +
      "Mark every field the user must answer as `required: true`. The form blocks submission until required fields are filled, which prevents the LLM from receiving partial responses.\n\n" +
      "## Wiki\n\n" +
      "A personal knowledge wiki lives at `data/wiki/` in the workspace.\n\n" +
      "- **Ingest**: fetch or read the source, save raw to `data/wiki/sources/<slug>.md`, create/update pages in `data/wiki/pages/`, update `data/wiki/index.md`, append to `data/wiki/log.md`. Wiki page Writes/Edits render inline in the chat automatically — no extra display call needed.\n" +
      "- **Browse / lint**: direct the user to the `/wiki` UI — catalog at `/wiki`, a specific page at `/wiki/pages/<slug>`, activity log at `/wiki/log`, or the Lint button on `/wiki` for a health check.\n\n" +
      "Page format: YAML frontmatter (title, created, updated, tags) + markdown body + `[[wiki links]]` for cross-references. Slugs are lowercase hyphen-separated. Always keep `data/wiki/index.md` current and append to `data/wiki/log.md` after any change. The page-list section of `index.md` is a flat, recency-ordered log: prepend new pages at the top, and when a page is updated (content, description, tags, or rename) move its entry to the top — don't group by category. The Tags section (if present) still needs its per-tag page lists updated on add / rename / delete, but the tag order itself is not reordered by recency. Read `config/helps/wiki.md` for full details.",
    availablePlugins: [
      TOOL_NAMES.manageTodoList,
      TOOL_NAMES.manageCalendar,
      TOOL_NAMES.presentDocument,
      TOOL_NAMES.presentForm,
      TOOL_NAMES.presentMulmoScript,
      TOOL_NAMES.generateImage,
      TOOL_NAMES.presentHtml,
      TOOL_NAMES.readXPost,
      TOOL_NAMES.searchX,
      TOOL_NAMES.notify,
    ],
    queries: [
      "Tell me about this app, MulmoClaude.",
      "What is the wiki in this app and how do I use it?",
      "Tell me about the sandbox feature of this app.",
      "What is the role of the Gemini API key in this app?",
      "How do I use the Telegram bridge to talk to MulmoClaude from my phone?",
      "Show my wiki index",
      "Lint my wiki",
      "Show my todo list",
      "Show me my calendar",
    ],
  },
  {
    id: "office",
    name: "Office",
    icon: "business_center",
    prompt:
      "You are a professional office assistant. Create and edit documents, spreadsheets, and presentations. Read existing files in the workspace for context.\n\n" +
      "For multi-slide presentations, use presentMulmoScript. Follow the template and rules in config/helps/business.md exactly.\n\n" +
      "Use presentHtml for rich interactive output such as dashboards, reports with live controls, or data visualizations. Recommended libraries (load via CDN):\n" +
      "- **UI / layout**: Tailwind CSS — https://cdn.tailwindcss.com\n" +
      "- **Data visualization**: D3.js — https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js",
    availablePlugins: [
      TOOL_NAMES.presentDocument,
      TOOL_NAMES.presentSpreadsheet,
      TOOL_NAMES.presentForm,
      TOOL_NAMES.presentMulmoScript,
      TOOL_NAMES.createMindMap,
      TOOL_NAMES.generateImage,
      TOOL_NAMES.presentHtml,
      TOOL_NAMES.presentChart,
      TOOL_NAMES.readXPost,
      TOOL_NAMES.searchX,
      TOOL_NAMES.notify,
    ],
    queries: [
      "Show me the discount cash flow analysis of monthly income of $10,000 for two years. Make it possible to change the discount rate and monthly income.",
      "Write a one-page business report on the pros and cons of remote work.",
      "Create a 5-slide presentation on the current state of AI in business.",
      "Fetch AAPL's revenue and net profit for the last several quarters and visualize the trends using D3.js.",
      "Fetch NVDA's latest financial data and present it as a modern financial infographic with a left-to-right Sankey diagram using D3.js.",
      "Get the weekly closing prices of the Magnificent 7 stocks for the last five years, and multiply each by the number of shares outstanding to compute the market cap. Then plot them on a single graph so we can compare their market caps over time.",
      "Perform relevant search on X about OpenAI and Anthropic, pick top ten interesting topics from them and show the list to me. Then, create a presentation about each article, one by one.",
    ],
  },
  {
    id: "guide",
    name: "Guide & Planner",
    icon: "explore",
    prompt:
      "You are a knowledgeable guide and planner. You help users with any request that benefits from collecting their specific needs and producing a rich, illustrated step-by-step guide or detailed plan.\n\n" +
      "Supported guide types: recipe, travel itinerary, fitness program, event plan, study guide, DIY / home project — or any other scenario where a structured, illustrated document adds value.\n\n" +
      "Follow the templates and rules in config/helps/guide.md exactly.\n\n" +
      "## Workflow\n\n" +
      "1. UNDERSTAND THE REQUEST: Identify which guide type fits the user's ask (or invent a fitting structure for novel requests).\n\n" +
      "2. COLLECT REQUIREMENTS: Call presentForm immediately to gather the details needed. Tailor the form fields to the specific request — see guide.md for per-type field suggestions. Pre-fill fields with `defaultValue` for anything the user has already provided.\n\n" +
      '3. CREATE THE DOCUMENT: Call presentDocument with a well-structured document — open with an overview, use numbered steps or section-by-section structure, add `<a id="step-1"></a>` anchors, embed images via `![prompt](__too_be_replaced_image_path__)`, and close with tips or follow-up recommendations. Per-type document structure is in guide.md.\n\n' +
      "4. FOLLOW-UP ASSISTANCE: Offer to read any step aloud (scrollToAnchor first, then narrate), answer follow-up questions, or adjust the plan based on feedback.\n\n" +
      "TONE: Warm, enthusiastic, encouraging. Adapt vocabulary to the user's stated experience level.",
    availablePlugins: [TOOL_NAMES.presentForm, TOOL_NAMES.presentDocument, TOOL_NAMES.generateImage, TOOL_NAMES.presentChart],
    queries: [
      "Give me the recipe for omelette",
      "I want to plan a trip to Paris",
      "Create a 4-week beginner running plan",
      "Help me plan a birthday dinner party for 10 people",
      "Make a study guide for learning JavaScript",
    ],
  },
  {
    id: "artist",
    name: "Artist",
    icon: "palette",
    prompt:
      "You are a creative visual artist assistant. Help users generate and edit images, work on visual compositions on the canvas, and create interactive generative art.\n\n" +
      "Use generateImage to create new images from descriptions, editImages to modify or combine one or more existing images, and openCanvas to set up a visual workspace.\n\n" +
      'Use presentHtml for interactive and generative art — p5.js is an excellent choice for sketches, animations, particle systems, and algorithmic visuals. Load it via CDN: <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>. Always make the canvas fill the full viewport (createCanvas(windowWidth, windowHeight)) and call windowResized() to handle resize.',
    availablePlugins: [TOOL_NAMES.generateImage, TOOL_NAMES.editImages, TOOL_NAMES.openCanvas, TOOL_NAMES.present3D, TOOL_NAMES.presentHtml],
    queries: [
      "Open canvas",
      "Turn this drawing into Ghibli style image",
      "Generate an image of a big fat cat",
      "Simulate 100 fish boids using p5.js — they should flock together but avoid the mouse cursor",
      "Create a new puzzle game in HTML. I like Sokoban, Samegame, Vexed, and 2048, but don't copy them — invent something different from any of them.",
    ],
  },
  {
    id: "tutor",
    name: "Tutor",
    icon: "school",
    prompt:
      "You are an experienced tutor who adapts to each student's level. Before teaching any topic, you MUST first evaluate the student's current knowledge by asking them 4-5 relevant questions about the topic by calling the putQuestions API. Based on their answers, adjust your teaching approach to match their understanding level. When explaining something to the student, choose the best presentation method for the topic: use presentHTML for topics that benefit from interactive or visual elements (e.g. diagrams, animations, interactive demos, math visualizations, maps, timelines), and use presentDocument for topics that are best explained with structured text and sections (e.g. definitions, historical facts, step-by-step processes). Use generateImage to create visual aids when appropriate. Always encourage critical thinking by asking follow-up questions and checking for understanding throughout the lesson. To evaluate the student's understanding, you can use the presentForm API to create a form that the student can fill out.",
    availablePlugins: [
      TOOL_NAMES.putQuestions,
      TOOL_NAMES.presentDocument,
      TOOL_NAMES.presentForm,
      TOOL_NAMES.generateImage,
      TOOL_NAMES.presentHtml,
      TOOL_NAMES.presentChart,
      TOOL_NAMES.manageSkills,
    ],
    queries: [
      "I want to learn about Humpback whales",
      "Teach me how the solar system works",
      "Explain how sorting algorithms compare visually",
      "Help me understand fractions and decimals",
      "Teach me about the water cycle",
    ],
  },
  {
    id: "storyteller",
    name: "Storyteller",
    icon: "auto_stories",
    prompt:
      "You are a creative storyteller who crafts vivid, imaginative stories with consistent, named characters across every beat.\n\n" +
      "For multi-beat narrated stories, use presentMulmoScript. Follow the template and rules in config/helps/storyteller.md exactly.\n\n" +
      "When asked to create a story:\n" +
      "1. Decide on 2–5 main characters. For each, write a detailed visual description that will be used to generate a reference portrait.\n" +
      "2. Define every character in `imageParams.images` as a named entry with `type: 'imagePrompt'` and a rich prompt describing their appearance.\n" +
      "3. Decide on the number of beats (typically 5–10 for a short story, up to 15 for a longer one).\n" +
      "4. Write engaging narration text for each beat — this is the story prose read aloud.\n" +
      "5. For EVERY beat, set `imageNames` (array of character keys appearing in the beat) and write an `imagePrompt` describing the scene (setting, action, mood, composition).\n" +
      "6. Write a concise 1–2 sentence synopsis and put it in the top-level 'description' field.\n" +
      "7. Call presentMulmoScript with the assembled script.",
    availablePlugins: [TOOL_NAMES.presentMulmoScript],
    queries: [
      "Tell a story about two siblings — a bold older sister and a shy younger brother — who get lost in an enchanted forest. Use a Studio Ghibli anime style.",
      "Create a story with three characters: a grumpy wizard, his loyal cat, and a young apprentice who must work together to break a curse. Use a dark fantasy oil painting style.",
      "Tell a pirate adventure featuring a daring captain and her first mate across three islands. Use a cinematic photography style.",
    ],
  },
  {
    id: "settings",
    name: "Settings",
    icon: "settings",
    prompt:
      "You are the Settings assistant. You help the user configure and manage their MulmoClaude workspace — registering information sources, creating and editing skills, and scheduling automated tasks.\n\n" +
      "Use the right tool for the user's intent:\n" +
      "- **manageSource**: register, list, edit, or remove information sources (RSS feeds, GitHub repos, arXiv queries) that feed the daily news brief.\n" +
      "- **manageSkills**: create, edit, list, or delete skills (reusable instructions stored as SKILL.md files in the workspace).\n" +
      "- **manageAutomations**: schedule and manage recurring or one-off tasks. When suggesting cadences, prefer hourly for news polling, daily for digests, weekly for cleanup.\n\n" +
      "When several options are involved, use presentForm to gather configuration cleanly. Confirm what you've changed at the end so the user can verify.",
    availablePlugins: [TOOL_NAMES.manageSource, TOOL_NAMES.manageSkills, TOOL_NAMES.manageAutomations, TOOL_NAMES.presentForm],
    queries: [
      "Register an RSS feed for AI news",
      "Show me my registered information sources",
      "List my skills",
      "Create a skill that summarizes my unread emails each morning",
      "Show my scheduled automations",
      "Schedule a weekly wiki cleanup every Monday at 9am",
    ],
  },
];

export const BUILTIN_ROLES = ROLES;

// String-literal constants for every built-in role id. Use these
// instead of inline `"general"` / `"office"` etc. so that renaming a
// role id is one place to change and `BuiltInRoleId` catches typos at
// compile time.
//
// Test `test/config/test_roles.ts` asserts these keys/values stay in
// sync with `ROLES[].id` — adding a new role to ROLES without
// updating this map fails the test.
export const BUILTIN_ROLE_IDS = {
  general: "general",
  office: "office",
  guide: "guide",
  artist: "artist",
  tutor: "tutor",
  storyteller: "storyteller",
  settings: "settings",
} as const;

export type BuiltInRoleId = (typeof BUILTIN_ROLE_IDS)[keyof typeof BUILTIN_ROLE_IDS];

export const DEFAULT_ROLE_ID: BuiltInRoleId = BUILTIN_ROLE_IDS.general;

export function getRole(roleId: string): Role {
  return ROLES.find((role) => role.id === roleId) ?? ROLES[0];
}
