// User interest profile for news notification filtering (#466).
//
// Loaded from `config/interests.json`. Claude populates this file
// during conversation when it detects user interest in a topic.
// The pipeline's notify phase uses it to score and filter articles.

import fs from "fs";
import path from "path";
import { workspacePath } from "../paths.js";
import { log } from "../../system/logger/index.js";
import type { SourceItem } from "./types.js";
import type { CategorySlug } from "./taxonomy.js";
import { isCategorySlug } from "./taxonomy.js";
import { isNonEmptyString, isRecord } from "../../utils/types.js";

// ── Types ───────────────────────────────────────────────────────

export interface InterestsProfile {
  keywords: string[];
  categories: CategorySlug[];
  minRelevance: number;
  maxNotificationsPerRun: number;
}

// ── Constants ───────────────────────────────────────────────────

const CONFIG_FILE = "config/interests.json";
const DEFAULT_MIN_RELEVANCE = 0.5;
const DEFAULT_MAX_NOTIFICATIONS = 5;

// Scoring weights
const KEYWORD_TITLE_WEIGHT = 0.4;
const KEYWORD_SUMMARY_WEIGHT = 0.2;
const CATEGORY_MATCH_WEIGHT = 0.3;
const SEVERITY_CRITICAL_WEIGHT = 0.3;
const SEVERITY_WARN_WEIGHT = 0.1;

// ── Load ────────────────────────────────────────────────────────

export function loadInterests(root?: string): InterestsProfile | null {
  const base = root ?? workspacePath;
  const filePath = path.join(base, CONFIG_FILE);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return validateInterests(parsed);
  } catch (err) {
    log.warn("interests", "failed to load interests.json", {
      error: String(err),
    });
    return null;
  }
}

function validateInterests(raw: unknown): InterestsProfile | null {
  if (!isRecord(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // Filter out blank/whitespace-only keywords — "" matches every title
  const keywords = Array.isArray(obj.keywords) ? obj.keywords.filter((keyword): keyword is string => isNonEmptyString(keyword)) : [];

  const categories = Array.isArray(obj.categories) ? obj.categories.filter((category): category is CategorySlug => isCategorySlug(category)) : [];

  if (keywords.length === 0 && categories.length === 0) return null;

  // Clamp minRelevance to [0, 1] — values > 1 would make notifications
  // impossible since scores are clamped to 1.0
  const rawMin = typeof obj.minRelevance === "number" ? obj.minRelevance : DEFAULT_MIN_RELEVANCE;
  const minRelevance = Math.max(0, Math.min(1, rawMin));

  // Floor to integer, minimum 1
  const rawMax = typeof obj.maxNotificationsPerRun === "number" ? obj.maxNotificationsPerRun : DEFAULT_MAX_NOTIFICATIONS;
  const maxNotificationsPerRun = Math.max(1, Math.floor(rawMax));

  return { keywords, categories, minRelevance, maxNotificationsPerRun };
}

// ── Scoring ─────────────────────────────────────────────────────

export interface ScoredItem {
  item: SourceItem;
  score: number;
}

export function scoreItem(item: SourceItem, profile: InterestsProfile): number {
  let score = 0;
  const titleLower = item.title.toLowerCase();
  const summaryLower = (item.summary ?? "").toLowerCase();

  for (const keyword of profile.keywords) {
    const keywordLower = keyword.toLowerCase();
    if (titleLower.includes(keywordLower)) {
      score += KEYWORD_TITLE_WEIGHT;
    } else if (summaryLower.includes(keywordLower)) {
      score += KEYWORD_SUMMARY_WEIGHT;
    }
  }

  const hasCategory = item.categories.some((category) => profile.categories.includes(category));
  if (hasCategory) {
    score += CATEGORY_MATCH_WEIGHT;
  }

  if (item.severity === "critical") {
    score += SEVERITY_CRITICAL_WEIGHT;
  } else if (item.severity === "warn") {
    score += SEVERITY_WARN_WEIGHT;
  }

  return Math.min(score, 1.0);
}

export function scoreAndFilter(items: readonly SourceItem[], profile: InterestsProfile): ScoredItem[] {
  return items
    .map((item) => ({ item, score: scoreItem(item, profile) }))
    .filter((scoredItem) => scoredItem.score >= profile.minRelevance)
    .sort((leftItem, rightItem) => rightItem.score - leftItem.score)
    .slice(0, profile.maxNotificationsPerRun);
}
