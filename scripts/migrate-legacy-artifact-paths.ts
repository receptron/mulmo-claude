#!/usr/bin/env tsx
// One-shot text migration for issue #773: rewrite legacy artifact path
// references in session / workspace text files.
//
// Background: #284 moved `markdowns/` → `artifacts/documents/` and
// `spreadsheets/` → `artifacts/spreadsheets/` on disk, but left text
// references inside session JSONL, summaries, and wiki pages alone.
// That inconsistency caused #773 (Vue accepts legacy, server rejects
// → silent save failure). This script rewrites those references in
// place.
//
// Usage:
//   npx tsx scripts/migrate-legacy-artifact-paths.ts              # dry-run
//   npx tsx scripts/migrate-legacy-artifact-paths.ts --write      # apply
//   npx tsx scripts/migrate-legacy-artifact-paths.ts --root=/tmp/ws  # override
//
// Safe to re-run: the rewriter is idempotent.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { rewriteLegacyPaths } from "./lib/legacyPaths.js";

interface CliArgs {
  write: boolean;
  root: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let write = false;
  let root = path.join(os.homedir(), "mulmoclaude");
  for (const arg of argv) {
    if (arg === "--write") {
      write = true;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  return { write, root };
}

function printHelp(): void {
  console.error(`Usage: migrate-legacy-artifact-paths.ts [--write] [--root=<path>]

  --write           Apply changes (default is dry-run: print what would change).
  --root=<path>     Workspace root (default: ~/mulmoclaude).
`);
}

// Relative paths under the workspace root that are allowed to be
// scanned. Keeps the script predictable — we don't recurse into
// `artifacts/` or `github/` because those either contain canonical
// paths already or are git working trees whose contents aren't our
// concern.
const TARGET_SUBTREES: readonly string[] = [
  "conversations/chat",
  "conversations/summaries",
  "data/wiki/pages",
];

const TARGET_FILES: readonly string[] = [
  "memory.md",
  "data/wiki/log.md",
  "data/wiki/index.md",
];

const SUPPORTED_EXTS: ReadonlySet<string> = new Set([".jsonl", ".json", ".md"]);

// `.bak` and migration manifests are historical — leave them alone so
// the audit trail stays readable.
function isSkippedFile(name: string): boolean {
  if (name.endsWith(".bak")) return true;
  if (name.startsWith("migration-") && name.endsWith("-manifest.json")) return true;
  return false;
}

interface FileStats {
  filePath: string;
  occurrences: number;
}

async function processFile(absPath: string, relPath: string, write: boolean): Promise<FileStats | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(absPath, "utf-8");
  } catch (err) {
    console.error(`  skip ${relPath}: cannot read (${(err as Error).message})`);
    return null;
  }
  const { text: rewritten, occurrences } = rewriteLegacyPaths(text);
  if (occurrences === 0) return null;
  if (write) {
    // Atomic write: temp file next to the destination, then rename.
    // Same-FS, so rename is atomic. Keeps partial writes out of the
    // way if the process dies mid-write.
    const tmpPath = `${absPath}.migrate-773.tmp`;
    await fs.promises.writeFile(tmpPath, rewritten, "utf-8");
    await fs.promises.rename(tmpPath, absPath);
  }
  return { filePath: relPath, occurrences };
}

async function walk(root: string, rel: string, write: boolean, stats: FileStats[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(path.join(root, rel), {
      withFileTypes: true,
    });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await walk(root, childRel, write, stats);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSkippedFile(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;
    const result = await processFile(path.join(root, childRel), childRel, write);
    if (result) stats.push(result);
  }
}

async function processSingleFile(root: string, rel: string, write: boolean, stats: FileStats[]): Promise<void> {
  const absPath = path.join(root, rel);
  try {
    const fileStat = await fs.promises.stat(absPath);
    if (!fileStat.isFile()) return;
  } catch {
    return;
  }
  if (isSkippedFile(path.basename(absPath))) return;
  const result = await processFile(absPath, rel, write);
  if (result) stats.push(result);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rootExists = fs.existsSync(args.root);
  if (!rootExists) {
    console.error(`Workspace root not found: ${args.root}`);
    process.exit(1);
  }
  console.error(`Workspace root: ${args.root}`);
  console.error(`Mode: ${args.write ? "WRITE" : "dry-run"}`);
  console.error("");

  const stats: FileStats[] = [];

  for (const subtree of TARGET_SUBTREES) {
    await walk(args.root, subtree, args.write, stats);
  }
  for (const fileRel of TARGET_FILES) {
    await processSingleFile(args.root, fileRel, args.write, stats);
  }

  if (stats.length === 0) {
    console.error("No legacy references found. Nothing to do.");
    return;
  }

  stats.sort((left, right) => left.filePath.localeCompare(right.filePath));
  for (const entry of stats) {
    console.log(`${entry.filePath}: ${entry.occurrences} occurrence(s)`);
  }
  const totalOccurrences = stats.reduce((acc, entry) => acc + entry.occurrences, 0);
  console.error("");
  console.error(`${stats.length} file(s), ${totalOccurrences} occurrence(s) ${args.write ? "rewritten" : "would be rewritten"}.`);
  if (!args.write) {
    console.error("Re-run with --write to apply.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
