import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRepoSlug,
  GithubFetcherError,
  githubFetchJson,
} from "../../server/sources/fetchers/github.js";
import {
  HostRateLimiter,
  type RateLimiterDeps,
} from "../../server/sources/rateLimiter.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  type HttpFetcherDeps,
  type RobotsProvider,
} from "../../server/sources/httpFetcher.js";

// --- parseRepoSlug ------------------------------------------------------

describe("parseRepoSlug — accepts real repo shapes", () => {
  it("accepts simple owner/repo", () => {
    assert.deepEqual(parseRepoSlug("anthropics/claude-code"), {
      owner: "anthropics",
      repo: "claude-code",
    });
  });

  it("accepts mixed case", () => {
    assert.deepEqual(parseRepoSlug("Anthropics/Claude-Code"), {
      owner: "Anthropics",
      repo: "Claude-Code",
    });
  });

  it("accepts digits, dots, underscores", () => {
    assert.deepEqual(parseRepoSlug("user42/my.pkg_v2"), {
      owner: "user42",
      repo: "my.pkg_v2",
    });
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(parseRepoSlug("  foo/bar  "), {
      owner: "foo",
      repo: "bar",
    });
  });

  it("accepts the special `.github` community-health repo", () => {
    // GitHub documents `<owner>/.github` as the default
    // community-health defaults repo for organizations, so the
    // repo segment is allowed to start with a dot.
    assert.deepEqual(parseRepoSlug("anthropics/.github"), {
      owner: "anthropics",
      repo: ".github",
    });
    assert.deepEqual(parseRepoSlug("github/.github"), {
      owner: "github",
      repo: ".github",
    });
  });
});

describe("parseRepoSlug — rejects malformed / unsafe input", () => {
  it("rejects missing slash", () => {
    assert.equal(parseRepoSlug("anthropics"), null);
    assert.equal(parseRepoSlug(""), null);
  });

  it("rejects multiple slashes (path traversal attempt)", () => {
    // `owner/../etc` would craft a dangerous URL if built verbatim.
    assert.equal(parseRepoSlug("a/b/c"), null);
    assert.equal(parseRepoSlug("a/../etc"), null);
    assert.equal(parseRepoSlug("/etc/passwd"), null);
  });

  it("rejects segments starting with a non-alphanumeric character", () => {
    // Owners can never start with a dot. The `.github` exemption
    // is a repo-only thing.
    assert.equal(parseRepoSlug(".hidden/bar"), null);
    assert.equal(parseRepoSlug("foo/-start-with-dash"), null);
  });

  it("rejects bare '.' / '..' repo names (path traversal)", () => {
    // The repo-segment regex allows leading dots (for `.github`),
    // so the guard has to explicitly reject the traversal shapes.
    assert.equal(parseRepoSlug("foo/."), null);
    assert.equal(parseRepoSlug("foo/.."), null);
  });

  it("rejects segments ending with a dot (Windows path issue)", () => {
    assert.equal(parseRepoSlug("foo./bar"), null);
    assert.equal(parseRepoSlug("foo/bar."), null);
  });

  it("rejects segments with unsafe characters", () => {
    assert.equal(parseRepoSlug("foo bar/baz"), null);
    assert.equal(parseRepoSlug("foo/bar baz"), null);
    assert.equal(parseRepoSlug("foo/bar?x=1"), null);
    assert.equal(parseRepoSlug("foo/bar#frag"), null);
    assert.equal(parseRepoSlug("foo/bar/"), null);
  });

  it("rejects over-long segments (defensive cap)", () => {
    assert.equal(parseRepoSlug("a/" + "b".repeat(101)), null);
  });

  it("rejects non-string input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(parseRepoSlug(null as any), null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(parseRepoSlug(42 as any), null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(parseRepoSlug({ repo: "a/b" } as any), null);
  });
});

// --- githubFetchJson ----------------------------------------------------

function controllableClock(start = 0): {
  deps: RateLimiterDeps;
  tick: (ms: number) => void;
} {
  const state = { t: start };
  return {
    deps: {
      now: () => state.t,
      sleep: (ms) => {
        state.t += ms;
        return Promise.resolve();
      },
    },
    tick: (ms) => {
      state.t += ms;
    },
  };
}

function makeHttpDeps(
  fetchImpl: typeof fetch,
  robots: RobotsProvider = async () => null,
): HttpFetcherDeps {
  const clock = controllableClock();
  return {
    fetchImpl,
    robots,
    rateLimiter: new HostRateLimiter(clock.deps),
    rateLimiterDeps: clock.deps,
    crawlDelayMs: () => 0,
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    onWillFetch: () => {},
  };
}

describe("githubFetchJson — happy path", () => {
  it("returns the parsed JSON body on 200", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const body = await githubFetchJson(
      "https://api.github.com/repos/x/y/releases",
      makeHttpDeps(fetchImpl),
    );
    assert.deepEqual(body, [{ id: 1 }, { id: 2 }]);
  });

  it("returns objects with the `message` field unchanged on 200", async () => {
    // Success responses with a top-level `message` key shouldn't
    // be confused with error envelopes.
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "ok", data: 42 }), {
        status: 200,
      });
    const body = await githubFetchJson(
      "https://api.github.com/x",
      makeHttpDeps(fetchImpl),
    );
    assert.deepEqual(body, { message: "ok", data: 42 });
  });
});

describe("githubFetchJson — non-2xx → GithubFetcherError", () => {
  it("throws on 404 with the API message attached", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    await assert.rejects(
      () =>
        githubFetchJson(
          "https://api.github.com/repos/x/y/releases",
          makeHttpDeps(fetchImpl),
        ),
      (err: unknown) => {
        if (!(err instanceof GithubFetcherError)) return false;
        return err.status === 404 && err.apiMessage === "Not Found";
      },
    );
  });

  it("throws on 403 rate-limit with the API message attached", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          message: "API rate limit exceeded for 203.0.113.1",
        }),
        { status: 403 },
      );
    await assert.rejects(
      () =>
        githubFetchJson("https://api.github.com/x", makeHttpDeps(fetchImpl)),
      (err: unknown) =>
        err instanceof GithubFetcherError &&
        err.status === 403 &&
        /rate limit/i.test(err.apiMessage ?? ""),
    );
  });

  it("throws with null apiMessage when the body isn't JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>not json</html>", { status: 500 });
    await assert.rejects(
      () =>
        githubFetchJson("https://api.github.com/x", makeHttpDeps(fetchImpl)),
      (err: unknown) =>
        err instanceof GithubFetcherError &&
        err.status === 500 &&
        err.apiMessage === null,
    );
  });

  it("throws with null apiMessage when the JSON has no `message` field", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ code: "oops" }), { status: 500 });
    await assert.rejects(
      () =>
        githubFetchJson("https://api.github.com/x", makeHttpDeps(fetchImpl)),
      (err: unknown) =>
        err instanceof GithubFetcherError && err.apiMessage === null,
    );
  });

  it("propagates RobotsDisallowedError from fetchPolite untouched", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("[]", { status: 200 });
    const robots: RobotsProvider = async () =>
      "User-agent: *\nDisallow: /repos\n";
    await assert.rejects(
      () =>
        githubFetchJson(
          "https://api.github.com/repos/x/y/releases",
          makeHttpDeps(fetchImpl, robots),
        ),
      /robots\.txt disallows/,
    );
  });
});
