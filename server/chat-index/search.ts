import type { ChatIndexEntry } from "./types.js";

export interface ChatHistorySearchResult {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  startedAt: string;
  score: number;
  snippet: string;
}

const SCORE_KEYWORD_EXACT = 5;
const SCORE_TITLE_SUBSTRING = 3;
const SCORE_SUMMARY_SUBSTRING = 1;
const SNIPPET_RADIUS = 40;

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC");
}

// Returns the chunk of `text` around the first occurrence of `needle`,
// padded by SNIPPET_RADIUS characters either side. Used so the search
// result UI can show *why* a session matched.
function makeSnippet(text: string, needle: string): string {
  if (!text || !needle) return "";
  const lowerText = normalize(text);
  const lowerNeedle = normalize(needle);
  const idx = lowerText.indexOf(lowerNeedle);
  if (idx < 0) return "";
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + needle.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function scoreEntries(
  entries: ChatIndexEntry[],
  query: string,
): ChatHistorySearchResult[] {
  const q = normalize(query.trim());
  if (!q) return [];

  const scored: ChatHistorySearchResult[] = [];
  for (const entry of entries) {
    const title = normalize(entry.title);
    const summary = normalize(entry.summary);
    let score = 0;

    for (const kw of entry.keywords) {
      if (normalize(kw) === q) {
        score += SCORE_KEYWORD_EXACT;
        break;
      }
    }
    if (title.includes(q)) score += SCORE_TITLE_SUBSTRING;
    if (summary.includes(q)) score += SCORE_SUMMARY_SUBSTRING;

    if (score === 0) continue;

    scored.push({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      keywords: entry.keywords,
      startedAt: entry.startedAt,
      score,
      snippet: makeSnippet(entry.summary, query),
    });
  }

  // Tie-break: more recent first
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return scored;
}
