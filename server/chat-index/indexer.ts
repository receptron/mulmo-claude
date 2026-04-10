import { createHash } from "crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { workspacePath } from "../workspace.js";
import { summarizeJsonl } from "./summarizer.js";
import type {
  ChatIndexEntry,
  ChatIndexManifest,
  SummaryResult,
} from "./types.js";

const chatDir = (): string => join(workspacePath, "chat");
const indexDir = (): string => join(chatDir(), "index");
const manifestPath = (): string => join(indexDir(), "manifest.json");

export function computeJsonlSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readManifest(): Promise<ChatIndexManifest> {
  try {
    const raw = await readFile(manifestPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as { version: unknown }).version === 1 &&
      "entries" in parsed &&
      Array.isArray((parsed as { entries: unknown }).entries)
    ) {
      return parsed as ChatIndexManifest;
    }
    return { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

// Atomic write: stage to a sibling .tmp file, then rename.
export async function writeManifest(m: ChatIndexManifest): Promise<void> {
  await mkdir(indexDir(), { recursive: true });
  const tmp = manifestPath() + ".tmp";
  await writeFile(tmp, JSON.stringify(m, null, 2));
  await rename(tmp, manifestPath());
}

async function listSessionFiles(): Promise<string[]> {
  try {
    const entries = await readdir(chatDir());
    return entries.filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

interface SessionMeta {
  roleId?: string;
  startedAt?: string;
}

async function readSessionMeta(id: string): Promise<SessionMeta> {
  try {
    const raw = await readFile(join(chatDir(), `${id}.json`), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const o = parsed as Record<string, unknown>;
    return {
      roleId: typeof o.roleId === "string" ? o.roleId : undefined,
      startedAt: typeof o.startedAt === "string" ? o.startedAt : undefined,
    };
  } catch {
    return {};
  }
}

// A session is "stale" when its current jsonl sha256 does not match
// the indexed sha (or there is no indexed entry yet).
export async function findStaleSessions(): Promise<string[]> {
  const files = await listSessionFiles();
  const manifest = await readManifest();
  const indexed = new Map(manifest.entries.map((e) => [e.id, e]));
  const stale: string[] = [];
  for (const file of files) {
    const id = file.replace(/\.jsonl$/, "");
    let content: string;
    try {
      content = await readFile(join(chatDir(), file), "utf-8");
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    const sha = computeJsonlSha256(content);
    const existing = indexed.get(id);
    if (!existing || existing.sourceSha256 !== sha) {
      stale.push(id);
    }
  }
  return stale;
}

export interface IndexerDeps {
  // Injection point for tests so they can stub the claude CLI call.
  summarize?: (jsonlPath: string) => Promise<SummaryResult>;
}

export async function indexOne(
  id: string,
  deps: IndexerDeps = {},
): Promise<ChatIndexEntry | null> {
  const summarize = deps.summarize ?? summarizeJsonl;
  const jsonlPath = join(chatDir(), `${id}.jsonl`);
  let content: string;
  try {
    content = await readFile(jsonlPath, "utf-8");
  } catch {
    return null;
  }
  const sha = computeJsonlSha256(content);
  const lines = content.split("\n").filter(Boolean).length;
  const meta = await readSessionMeta(id);

  let summary: SummaryResult;
  try {
    summary = await summarize(jsonlPath);
  } catch (err) {
    console.error(
      `[chat-index] failed to summarize ${id}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const entry: ChatIndexEntry = {
    id,
    roleId: meta.roleId ?? "general",
    startedAt: meta.startedAt ?? new Date().toISOString(),
    sourceSha256: sha,
    sourceLines: lines,
    indexedAt: new Date().toISOString(),
    title: summary.title,
    summary: summary.summary,
    keywords: summary.keywords,
  };

  // Per-session file is written first so partial progress survives a
  // crash mid-cycle even if the manifest update never lands.
  await mkdir(indexDir(), { recursive: true });
  await writeFile(
    join(indexDir(), `${id}.json`),
    JSON.stringify(entry, null, 2),
  );

  // Upsert into manifest, sort newest-first by startedAt.
  const manifest = await readManifest();
  const filtered = manifest.entries.filter((e) => e.id !== id);
  filtered.push(entry);
  filtered.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  await writeManifest({ version: 1, entries: filtered });

  return entry;
}

export interface IndexStaleOptions {
  limit?: number;
  deps?: IndexerDeps;
}

export async function indexStale(
  opts: IndexStaleOptions = {},
): Promise<number> {
  const limit = opts.limit ?? 20;
  const stale = (await findStaleSessions()).slice(0, limit);
  let processed = 0;
  for (const id of stale) {
    const result = await indexOne(id, opts.deps);
    if (result) processed++;
  }
  return processed;
}
