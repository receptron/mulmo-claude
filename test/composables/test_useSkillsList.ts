import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useSkillsList } from "../../src/composables/useSkillsList.js";

// Coverage for the error paths added in #898 (follow-up to #886):
//   - apiGet returns ok:false       → error surfaced, stale skills preserved
//   - apiGet returns ok:true but the response body is missing/malformed
//     → same error path, no false-positive happy-path
//   - the underlying fetch throws    → caught, no unhandled rejection,
//                                       error surfaced
//
// We follow the test_useSessionHistory.ts pattern: stub globalThis.fetch
// and let apiGet thread the response through. The composable's module-
// level state means tests run in series and sequence their assertions
// off prior state — no per-test reset hook.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch: any = (globalThis as any).fetch;

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = impl;
}

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

interface SkillRow {
  name: string;
  description: string;
  source: "user" | "project";
}

const SKILL_A: SkillRow = { name: "alpha", description: "first", source: "user" };
const SKILL_B: SkillRow = { name: "beta", description: "second", source: "project" };

describe("useSkillsList — happy path", () => {
  it("populates skills and clears error on a successful refresh", async () => {
    stubFetch(async () => mockJsonResponse(200, { skills: [SKILL_A, SKILL_B] }));
    const { skills, error, refresh } = useSkillsList();
    await refresh();
    assert.equal(skills.value.length, 2);
    assert.equal(skills.value[0].name, "alpha");
    assert.equal(error.value, null);
  });
});

describe("useSkillsList — error path (apiGet result.ok=false)", () => {
  it("sets error and keeps the previously-loaded skills list", async () => {
    // Prime with a healthy fetch.
    stubFetch(async () => mockJsonResponse(200, { skills: [SKILL_A] }));
    const { skills, error, refresh } = useSkillsList();
    await refresh();
    assert.equal(skills.value.length, 1);

    // Fail. Stale list must survive (transient blip ≠ wipe).
    stubFetch(async () => mockJsonResponse(500, { error: "server exploded" }));
    await refresh();
    assert.equal(skills.value.length, 1, "skills preserved across a failed refresh");
    assert.equal(typeof error.value, "string", "error surfaced");
    assert.ok((error.value ?? "").length > 0);
  });

  it("clears error on the next successful refresh", async () => {
    stubFetch(async () => mockJsonResponse(500, { error: "transient" }));
    const { error, refresh } = useSkillsList();
    await refresh();
    assert.ok(error.value);

    stubFetch(async () => mockJsonResponse(200, { skills: [SKILL_A] }));
    await refresh();
    assert.equal(error.value, null);
  });
});

describe("useSkillsList — malformed-payload path", () => {
  it("surfaces an error when response body is missing the skills array", async () => {
    // ok:true but body lacks `skills`. Pre-#898 this branch was
    // silent — neither error nor a console hint fired.
    stubFetch(async () => mockJsonResponse(200, { unrelated: "field" }));
    const { error, refresh } = useSkillsList();
    await refresh();
    assert.equal(typeof error.value, "string");
    assert.ok((error.value ?? "").includes("skills"), `error mentions the missing field; got: ${error.value}`);
  });

  it("surfaces an error when skills is the wrong type (e.g. null)", async () => {
    stubFetch(async () => mockJsonResponse(200, { skills: null }));
    const { error, refresh } = useSkillsList();
    await refresh();
    assert.equal(typeof error.value, "string");
  });
});

describe("useSkillsList — refresh contract: never throws", () => {
  it("a fetch error surfaces as result.ok=false (apiGet wraps), and refresh resolves cleanly", async () => {
    // Today, apiGet itself catches network errors and returns
    // {ok: false}, so the composable's `try/catch` block is
    // defense-in-depth rather than load-bearing. Either way the
    // observable contract is the same: the bootstrap `void refresh()`
    // call site must never see an unhandled rejection. Pin that
    // contract here so a future apiGet refactor can't regress it.
    stubFetch(async () => {
      throw new Error("network down");
    });
    const { error, refresh } = useSkillsList();
    await assert.doesNotReject(refresh());
    assert.equal(typeof error.value, "string");
    assert.ok((error.value ?? "").toLowerCase().includes("network"));
  });
});

describe("useSkillsList — concurrent refreshes share one in-flight call", () => {
  it("does not fire two fetches when refresh() is called twice in parallel", async () => {
    let fetchCount = 0;
    stubFetch(async () => {
      fetchCount++;
      // Defer one tick so the second caller has a chance to land
      // before the first resolves.
      await new Promise((resolve) => setImmediate(resolve));
      return mockJsonResponse(200, { skills: [SKILL_A] });
    });
    const { refresh } = useSkillsList();
    await Promise.all([refresh(), refresh(), refresh()]);
    assert.equal(fetchCount, 1, "in-flight guard must dedup concurrent callers");
  });
});
