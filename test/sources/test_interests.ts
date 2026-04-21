import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreItem, scoreAndFilter, loadInterests, type InterestsProfile } from "../../server/workspace/sources/interests.js";
import type { SourceItem } from "../../server/workspace/sources/types.js";
import fs from "fs";
import path from "path";
import os from "os";

function makeItem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "test-1",
    title: "Default title",
    url: "https://example.com",
    publishedAt: new Date().toISOString(),
    categories: [],
    sourceSlug: "test-source",
    ...overrides,
  };
}

const baseProfile: InterestsProfile = {
  keywords: ["WebAssembly", "Rust"],
  categories: ["ai", "security"],
  minRelevance: 0.5,
  maxNotificationsPerRun: 5,
};

describe("scoreItem", () => {
  it("returns 0 for no matches", () => {
    const item = makeItem({ title: "Unrelated article about cooking" });
    assert.equal(scoreItem(item, baseProfile), 0);
  });

  it("scores keyword in title at 0.4", () => {
    const item = makeItem({ title: "WebAssembly 3.0 released" });
    assert.equal(scoreItem(item, baseProfile), 0.4);
  });

  it("scores keyword in summary at 0.2", () => {
    const item = makeItem({
      title: "New release",
      summary: "Major WebAssembly update",
    });
    assert.equal(scoreItem(item, baseProfile), 0.2);
  });

  it("prefers title match over summary match for same keyword", () => {
    const item = makeItem({
      title: "WebAssembly news",
      summary: "WebAssembly is great",
    });
    // Should get 0.4 (title), not 0.4 + 0.2
    assert.equal(scoreItem(item, baseProfile), 0.4);
  });

  it("scores multiple keyword matches", () => {
    const item = makeItem({ title: "Rust and WebAssembly integration" });
    assert.equal(scoreItem(item, baseProfile), 0.8);
  });

  it("scores category match at 0.3", () => {
    const item = makeItem({ categories: ["ai"] });
    assert.equal(scoreItem(item, baseProfile), 0.3);
  });

  it("scores keyword + category together", () => {
    const item = makeItem({
      title: "WebAssembly security audit",
      categories: ["security"],
    });
    assert.equal(scoreItem(item, baseProfile), 0.7);
  });

  it("adds severity critical boost", () => {
    const item = makeItem({
      title: "WebAssembly vulnerability",
      severity: "critical",
    });
    assert.equal(scoreItem(item, baseProfile), 0.7);
  });

  it("adds severity warn boost", () => {
    const item = makeItem({
      title: "WebAssembly deprecation",
      severity: "warn",
    });
    assert.equal(scoreItem(item, baseProfile), 0.5);
  });

  it("clamps to 1.0", () => {
    const item = makeItem({
      title: "Rust WebAssembly security critical",
      categories: ["ai", "security"],
      severity: "critical",
    });
    // 0.4 + 0.4 + 0.3 + 0.3 = 1.4 → clamped to 1.0
    assert.equal(scoreItem(item, baseProfile), 1.0);
  });

  it("is case-insensitive", () => {
    const item = makeItem({ title: "WEBASSEMBLY NEWS" });
    assert.equal(scoreItem(item, baseProfile), 0.4);
  });
});

describe("scoreAndFilter", () => {
  it("filters below minRelevance", () => {
    const items = [
      makeItem({ id: "1", title: "WebAssembly release" }), // 0.4 < 0.5
      makeItem({
        id: "2",
        title: "WebAssembly security",
        categories: ["security"],
      }), // 0.7
    ];
    const result = scoreAndFilter(items, baseProfile);
    assert.equal(result.length, 1);
    assert.equal(result[0].item.id, "2");
  });

  it("sorts by score descending", () => {
    const items = [
      makeItem({
        id: "1",
        title: "Rust article",
        categories: ["security"],
      }), // 0.7
      makeItem({
        id: "2",
        title: "WebAssembly and Rust",
        categories: ["ai"],
      }), // 1.0 (clamped)
    ];
    const result = scoreAndFilter(items, baseProfile);
    assert.equal(result[0].item.id, "2");
    assert.equal(result[1].item.id, "1");
  });

  it("respects maxNotificationsPerRun", () => {
    const profile = { ...baseProfile, maxNotificationsPerRun: 1 };
    const items = [
      makeItem({
        id: "1",
        title: "WebAssembly news",
        categories: ["ai"],
      }),
      makeItem({
        id: "2",
        title: "Rust news",
        categories: ["security"],
      }),
    ];
    const result = scoreAndFilter(items, profile);
    assert.equal(result.length, 1);
  });

  it("returns empty for no matches", () => {
    const items = [makeItem({ title: "Cooking recipes" })];
    const result = scoreAndFilter(items, baseProfile);
    assert.equal(result.length, 0);
  });
});

describe("loadInterests", () => {
  it("returns null when file doesn't exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-"));
    const result = loadInterests(tmpDir);
    assert.equal(result, null);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("loads valid interests file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-"));
    const configDir = path.join(tmpDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "interests.json"),
      JSON.stringify({
        keywords: ["AI", "ML"],
        categories: ["ai"],
        minRelevance: 0.3,
        maxNotificationsPerRun: 10,
      }),
    );
    const result = loadInterests(tmpDir);
    assert.notEqual(result, null);
    assert.deepEqual(result!.keywords, ["AI", "ML"]);
    assert.deepEqual(result!.categories, ["ai"]);
    assert.equal(result!.minRelevance, 0.3);
    assert.equal(result!.maxNotificationsPerRun, 10);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns null for empty keywords and categories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-"));
    const configDir = path.join(tmpDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "interests.json"), JSON.stringify({ keywords: [], categories: [] }));
    const result = loadInterests(tmpDir);
    assert.equal(result, null);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns null for invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-"));
    const configDir = path.join(tmpDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "interests.json"), "not json");
    const result = loadInterests(tmpDir);
    assert.equal(result, null);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("uses defaults for missing optional fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-"));
    const configDir = path.join(tmpDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "interests.json"), JSON.stringify({ keywords: ["test"] }));
    const result = loadInterests(tmpDir);
    assert.notEqual(result, null);
    assert.equal(result!.minRelevance, 0.5);
    assert.equal(result!.maxNotificationsPerRun, 5);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("filters invalid category slugs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interests-"));
    const configDir = path.join(tmpDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "interests.json"),
      JSON.stringify({
        keywords: ["test"],
        categories: ["ai", "not-a-real-category", "security"],
      }),
    );
    const result = loadInterests(tmpDir);
    assert.notEqual(result, null);
    assert.deepEqual(result!.categories, ["ai", "security"]);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
