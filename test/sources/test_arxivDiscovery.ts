import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { buildArxivQuery, keywordsToSlug, discoverAndRegister } from "../../server/workspace/sources/arxivDiscovery.js";

describe("buildArxivQuery", () => {
  it("builds query for single keyword", () => {
    const q = buildArxivQuery(["transformer"]);
    assert.equal(q, 'ti:"transformer" OR abs:"transformer"');
  });

  it("builds query for multiple keywords", () => {
    const q = buildArxivQuery(["transformer", "attention"]);
    assert.equal(q, 'ti:"transformer" OR abs:"transformer" OR ti:"attention" OR abs:"attention"');
  });

  it("escapes quotes in keywords", () => {
    const q = buildArxivQuery(['large "language" model']);
    assert.equal(q, 'ti:"large language model" OR abs:"large language model"');
  });

  it("handles empty array", () => {
    assert.equal(buildArxivQuery([]), "");
  });
});

describe("keywordsToSlug", () => {
  it("generates slug with prefix and hash", () => {
    const slug = keywordsToSlug(["WebAssembly"]);
    assert.ok(slug.startsWith("arxiv-auto-webassembly-"));
    assert.ok(slug.length > "arxiv-auto-webassembly-".length);
  });

  it("joins multiple keywords with hyphen", () => {
    const slug = keywordsToSlug(["AI", "safety"]);
    assert.ok(slug.startsWith("arxiv-auto-ai-safety-"));
  });

  it("limits latin part to 3 keywords", () => {
    const slug = keywordsToSlug(["a", "b", "c", "d", "e"]);
    assert.ok(slug.startsWith("arxiv-auto-a-b-c-"));
  });

  it("different chunks produce different slugs", () => {
    const slug1 = keywordsToSlug(["a", "b", "c", "d", "e"]);
    const slug2 = keywordsToSlug(["a", "b", "c", "f", "g"]);
    assert.notEqual(slug1, slug2);
  });

  it("handles non-ASCII keywords via hash", () => {
    const slug = keywordsToSlug(["トランスフォーマー", "注意機構"]);
    assert.ok(slug.startsWith("arxiv-auto-"));
    assert.ok(slug.length > "arxiv-auto-".length); // hash only, no latin part
  });

  it("handles special characters", () => {
    const slug = keywordsToSlug(["C++", "Rust"]);
    assert.ok(slug.startsWith("arxiv-auto-c-rust-"));
  });

  it("handles empty array with hash", () => {
    const slug = keywordsToSlug([]);
    assert.ok(slug.startsWith("arxiv-auto-"));
  });
});

describe("discoverAndRegister", () => {
  function makeTmpWorkspace(interests: Record<string, unknown> | null): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arxiv-disc-"));
    const configDir = path.join(tmp, "config");
    fs.mkdirSync(configDir, { recursive: true });
    if (interests) {
      fs.writeFileSync(path.join(configDir, "interests.json"), JSON.stringify(interests));
    }
    // Create sources directory
    fs.mkdirSync(path.join(tmp, "sources"), { recursive: true });
    return tmp;
  }

  it("skips when no interests file", async () => {
    const tmp = makeTmpWorkspace(null);
    const result = await discoverAndRegister(tmp);
    assert.equal(result.reason, "no keywords in interests");
    assert.equal(result.registered.length, 0);
    fs.rmSync(tmp, { recursive: true });
  });

  it("skips when no keywords", async () => {
    const tmp = makeTmpWorkspace({ keywords: [], categories: ["ai"] });
    const result = await discoverAndRegister(tmp);
    assert.equal(result.reason, "no keywords in interests");
    fs.rmSync(tmp, { recursive: true });
  });

  it("registers arXiv source for keywords", async () => {
    const tmp = makeTmpWorkspace({
      keywords: ["transformer"],
      categories: ["ai"],
    });
    const result = await discoverAndRegister(tmp);
    assert.equal(result.registered.length, 1);
    assert.ok(result.registered[0].startsWith("arxiv-auto-transformer-"));

    // Verify source file was created
    const sourceFile = path.join(tmp, "sources", result.registered[0] + ".md");
    assert.ok(fs.existsSync(sourceFile));
    const content = fs.readFileSync(sourceFile, "utf-8");
    assert.ok(content.includes("arxiv_query"));
    assert.ok(content.includes("transformer"));

    fs.rmSync(tmp, { recursive: true });
  });

  it("skips existing sources", async () => {
    const tmp = makeTmpWorkspace({
      keywords: ["transformer"],
      categories: ["ai"],
    });
    // First run registers
    await discoverAndRegister(tmp);
    // Second run skips
    const result = await discoverAndRegister(tmp);
    assert.equal(result.registered.length, 0);
    assert.equal(result.skipped.length, 1);
    fs.rmSync(tmp, { recursive: true });
  });

  it("chunks keywords into groups of 5", async () => {
    const tmp = makeTmpWorkspace({
      keywords: ["a", "b", "c", "d", "e", "f", "g"],
      categories: [],
    });
    // categories empty but keywords present — needs at least one to pass
    // Actually with empty categories, loadInterests returns null...
    // Let's add a category
    fs.writeFileSync(
      path.join(tmp, "config", "interests.json"),
      JSON.stringify({
        keywords: ["a", "b", "c", "d", "e", "f", "g"],
        categories: ["ai"],
      }),
    );
    const result = await discoverAndRegister(tmp);
    assert.equal(result.registered.length, 2); // [a,b,c,d,e] + [f,g]
    fs.rmSync(tmp, { recursive: true });
  });
});
