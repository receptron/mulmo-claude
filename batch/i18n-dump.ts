// Dump src/lang/*.ts to .i18n-cache/*.json so
// @intlify/eslint-plugin-vue-i18n can load them via
// `settings['vue-i18n'].localeDir`. The plugin only reads JSON/YAML,
// not TypeScript — this bridges the gap without forcing the app to
// maintain dictionaries in JSON (which loses the `typeof en` module
// augmentation we rely on for compile-time key checks).
//
// Run via `yarn dumpi18n`. `yarn lint` runs it first so the cache is
// always fresh before eslint consumes it.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import enMessages from "../src/lang/en";
import jaMessages from "../src/lang/ja";

const locales = { en: enMessages, ja: jaMessages };

// vue-i18n supports a "message function" form — e.g.
// `argsPlaceholder: () => "…"`. JSON.stringify skips those keys
// (functions → undefined). Replace them with a placeholder literal
// so the eslint plugin still sees the key exists. The runtime
// dictionary keeps the function; only the lint cache loses it.
function serializableDictionary(input: unknown): unknown {
  if (typeof input === "function") return "[message-function]";
  if (Array.isArray(input)) return input.map(serializableDictionary);
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = serializableDictionary(value);
    }
    return out;
  }
  return input;
}

const thisFile = url.fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "..");
const outDir = path.join(repoRoot, ".i18n-cache");

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    Object.entries(locales).map(([locale, dict]) =>
      writeFile(
        path.join(outDir, `${locale}.json`),
        JSON.stringify(serializableDictionary(dict), null, 2) + "\n",
        "utf8",
      ),
    ),
  );
  console.log(`i18n JSON dumped to ${path.relative(repoRoot, outDir)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
