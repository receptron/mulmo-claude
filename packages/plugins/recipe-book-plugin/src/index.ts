// Recipe-book plugin — server side (#1175 / #1169 PR-A).
//
// Sample runtime plugin demonstrating markdown-per-record storage on
// the v0.3 runtime API:
//   - definePlugin factory with destructured runtime (files, pubsub, log)
//   - files.data hosts one `.md` per recipe with YAML frontmatter
//   - readDir + per-file read for the list endpoint
//   - pubsub.publish("changed", ...) on every mutation so multi-tab
//     views auto-refresh
//   - Zod-discriminated args + exhaustive switch with `default: never`
//
// `node:fs` / `node:path` / `console` / direct `fetch` are unused —
// the gui-chat-protocol eslint preset bans them at lint time.

import { createSerialLock, definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isValidSlug = (raw: string): boolean => raw.length > 0 && raw.length <= 64 && SLUG_RE.test(raw);

const RECIPES_DIR = "recipes";
const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

// Shared field shape for the `save` and `update` members — the two
// carry an identical record body and differ only in `kind`.
const recipeWriteFields = {
  slug: z.string(),
  title: z.string(),
  tags: z.array(z.string()).optional(),
  servings: z.number().int().nonnegative().optional(),
  prepTime: z.number().int().nonnegative().optional(),
  cookTime: z.number().int().nonnegative().optional(),
  body: z.string(),
};

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("read"), slug: z.string() }),
  z.object({ kind: z.literal("save"), ...recipeWriteFields }),
  z.object({ kind: z.literal("update"), ...recipeWriteFields }),
  z.object({ kind: z.literal("delete"), slug: z.string() }),
]);

interface Recipe {
  slug: string;
  title: string;
  tags: string[];
  servings: number | null;
  prepTime: number | null;
  cookTime: number | null;
  created: string;
  updated: string;
  body: string;
}

type RecipeSummary = Pick<Recipe, "slug" | "title" | "tags" | "servings" | "updated">;

function escapeYamlScalar(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ").trim();
  const needsQuoting = /[:#'"\\[\]{}>|`*&!%@?]/.test(oneLine) || /^\s|\s$/.test(oneLine) || /^(true|false|null|~|yes|no|on|off)$/i.test(oneLine);
  return needsQuoting ? JSON.stringify(oneLine) : oneLine;
}

function serialise(recipe: Recipe): string {
  const lines = ["---", `title: ${escapeYamlScalar(recipe.title)}`];
  if (recipe.tags.length > 0) {
    lines.push("tags:");
    for (const tag of recipe.tags) lines.push(`  - ${escapeYamlScalar(tag)}`);
  }
  if (recipe.servings !== null) lines.push(`servings: ${recipe.servings}`);
  if (recipe.prepTime !== null) lines.push(`prepTime: ${recipe.prepTime}`);
  if (recipe.cookTime !== null) lines.push(`cookTime: ${recipe.cookTime}`);
  lines.push(`created: ${escapeYamlScalar(recipe.created)}`);
  lines.push(`updated: ${escapeYamlScalar(recipe.updated)}`);
  lines.push("---", "", recipe.body.trimEnd(), "");
  return lines.join("\n");
}

// Tiny line-by-line frontmatter reader. We only use a handful of
// keys, all scalar except `tags`, so a YAML library would be
// overkill (and adds a dep the plugin doesn't otherwise need).
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } | null {
  if (!FRONTMATTER_OPEN.test(raw)) return null;
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) return null;
  const yamlText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  const meta: Record<string, string | string[]> = {};
  let currentArrayKey: string | null = null;
  for (const line of yamlText.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const arrayItem = line.match(/^\s+-\s+(.*)$/);
    if (arrayItem && currentArrayKey) {
      const arr = meta[currentArrayKey];
      if (Array.isArray(arr)) arr.push(unquote(arrayItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    if (valueRaw === "") {
      meta[key] = [];
      currentArrayKey = key;
    } else {
      meta[key] = unquote(valueRaw);
      currentArrayKey = null;
    }
  }
  return { meta, body };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value.trim();
}

function metaInt(meta: Record<string, unknown>, key: string): number | null {
  const raw = meta[key];
  if (typeof raw !== "string") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function metaTags(meta: Record<string, unknown>): string[] {
  const raw = meta.tags;
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function deserialise(slug: string, raw: string): Recipe | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  const title = typeof parsed.meta.title === "string" ? parsed.meta.title : "";
  if (title.length === 0) return null;
  const created = typeof parsed.meta.created === "string" ? parsed.meta.created : "";
  const updated = typeof parsed.meta.updated === "string" ? parsed.meta.updated : created;
  return {
    slug,
    title,
    tags: metaTags(parsed.meta),
    servings: metaInt(parsed.meta, "servings"),
    prepTime: metaInt(parsed.meta, "prepTime"),
    cookTime: metaInt(parsed.meta, "cookTime"),
    created,
    updated,
    body: parsed.body,
  };
}

function recipePath(slug: string): string {
  return `${RECIPES_DIR}/${slug}.md`;
}

function summarise(recipe: Recipe): RecipeSummary {
  return {
    slug: recipe.slug,
    title: recipe.title,
    tags: recipe.tags,
    servings: recipe.servings,
    updated: recipe.updated,
  };
}

type WritableArgsError = { ok: false; error: "invalid_slug"; slug: string } | { ok: false; error: "missing_title" };

/** Slug + title precheck shared by `save` and `update`; null when valid. */
function validateWritableArgs(args: { slug: string; title: string }): WritableArgsError | null {
  if (!isValidSlug(args.slug)) return { ok: false, error: "invalid_slug", slug: args.slug };
  if (args.title.trim().length === 0) return { ok: false, error: "missing_title" };
  return null;
}

export default definePlugin(({ pubsub, files, log }) => {
  // Serialise read-modify-write so two parallel save / update / delete
  // calls can't race the on-disk state.
  const withWriteLock = createSerialLock();

  async function readRecipe(slug: string): Promise<Recipe | null> {
    if (!isValidSlug(slug)) return null;
    if (!(await files.data.exists(recipePath(slug)))) return null;
    const raw = await files.data.read(recipePath(slug));
    return deserialise(slug, raw);
  }

  async function listRecipes(): Promise<Recipe[]> {
    if (!(await files.data.exists(RECIPES_DIR))) return [];
    const entries = await files.data.readDir(RECIPES_DIR);
    const out: Recipe[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const slug = entry.slice(0, -".md".length);
      if (!isValidSlug(slug)) continue;
      const raw = await files.data.read(`${RECIPES_DIR}/${entry}`);
      const recipe = deserialise(slug, raw);
      if (recipe) out.push(recipe);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async function publishChanged(): Promise<void> {
    pubsub.publish("changed", { at: new Date().toISOString() });
  }

  return {
    TOOL_DEFINITION,

    async manageRecipes(rawArgs: unknown) {
      const args = Args.parse(rawArgs);

      switch (args.kind) {
        case "list": {
          const recipes = await listRecipes();
          return { ok: true, recipes: recipes.map(summarise) };
        }

        case "read": {
          if (!isValidSlug(args.slug)) {
            return { ok: false, error: "invalid_slug", slug: args.slug };
          }
          const recipe = await readRecipe(args.slug);
          if (!recipe) return { ok: false, error: "not_found", slug: args.slug };
          return { ok: true, recipe };
        }

        case "save": {
          const invalid = validateWritableArgs(args);
          if (invalid) return invalid;
          return withWriteLock(async () => {
            if (await files.data.exists(recipePath(args.slug))) {
              return { ok: false, error: "exists", slug: args.slug };
            }
            const now = new Date().toISOString();
            const recipe: Recipe = {
              slug: args.slug,
              title: args.title.trim(),
              tags: args.tags ?? [],
              servings: args.servings ?? null,
              prepTime: args.prepTime ?? null,
              cookTime: args.cookTime ?? null,
              created: now,
              updated: now,
              body: args.body,
            };
            await files.data.write(recipePath(args.slug), serialise(recipe));
            log.info("saved", { slug: args.slug });
            await publishChanged();
            return { ok: true, recipe: summarise(recipe) };
          });
        }

        case "update": {
          const invalid = validateWritableArgs(args);
          if (invalid) return invalid;
          return withWriteLock(async () => {
            const existing = await readRecipe(args.slug);
            if (!existing) return { ok: false, error: "not_found", slug: args.slug };
            // Optional metadata (tags / servings / prep / cook) preserves
            // the on-disk value when the caller omits the key — otherwise
            // a body-only update like "bump the lime" would silently wipe
            // the prep / cook times the user had set earlier.
            const now = new Date().toISOString();
            const recipe: Recipe = {
              slug: args.slug,
              title: args.title.trim(),
              tags: args.tags ?? existing.tags,
              servings: args.servings ?? existing.servings,
              prepTime: args.prepTime ?? existing.prepTime,
              cookTime: args.cookTime ?? existing.cookTime,
              created: existing.created || now,
              updated: now,
              body: args.body,
            };
            await files.data.write(recipePath(args.slug), serialise(recipe));
            log.info("updated", { slug: args.slug });
            await publishChanged();
            return { ok: true, recipe: summarise(recipe) };
          });
        }

        case "delete": {
          if (!isValidSlug(args.slug)) {
            return { ok: false, error: "invalid_slug", slug: args.slug };
          }
          return withWriteLock(async () => {
            if (!(await files.data.exists(recipePath(args.slug)))) {
              return { ok: false, error: "not_found", slug: args.slug };
            }
            await files.data.unlink(recipePath(args.slug));
            log.info("deleted", { slug: args.slug });
            await publishChanged();
            return { ok: true, slug: args.slug };
          });
        }

        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
