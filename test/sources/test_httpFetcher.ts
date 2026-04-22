import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPolite,
  RedirectLimitError,
  RobotsDisallowedError,
  USER_AGENT,
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  type HttpFetcherDeps,
  type RobotsProvider,
} from "../../server/workspace/sources/httpFetcher.js";
import { HostRateLimiter, type RateLimiterDeps } from "../../server/workspace/sources/rateLimiter.js";

// Controllable clock for the rate limiter.
function controllableClock(start = 0): {
  deps: RateLimiterDeps;
  tick: (delayMs: number) => void;
  read: () => number;
} {
  const state = { t: start };
  return {
    deps: {
      now: () => state.t,
      sleep: (delayMs) => {
        state.t += delayMs;
        return Promise.resolve();
      },
    },
    tick: (delayMs) => {
      state.t += delayMs;
    },
    read: () => state.t,
  };
}

// Build a stub fetch that returns prebuilt responses keyed by URL,
// tracking which headers arrived and when each request fired.
interface StubCall {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal | null;
}

function makeStubFetch(responses: Record<string, Response | Error>): {
  fetchImpl: typeof fetch;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    if (rawHeaders) {
      for (const [key, val] of Object.entries(rawHeaders)) {
        headers[key] = val;
      }
    }
    calls.push({ url, headers, signal: init?.signal ?? null });
    const resp = responses[url];
    if (!resp) throw new Error(`unexpected URL in test: ${url}`);
    if (resp instanceof Error) throw resp;
    return resp;
  };
  return { fetchImpl, calls };
}

function makeDeps(over: Partial<HttpFetcherDeps> = {}): HttpFetcherDeps {
  const clock = controllableClock();
  const rateLimiter = new HostRateLimiter(clock.deps);
  const stub = makeStubFetch({});
  return {
    fetchImpl: stub.fetchImpl,
    robots: async () => null, // no robots by default → allow all
    rateLimiter,
    rateLimiterDeps: clock.deps,
    crawlDelayMs: () => 0, // disable delay by default
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    onWillFetch: () => {},
    ...over,
  };
}

describe("fetchPolite — User-Agent + scheme guard", () => {
  it("sends the MulmoClaude-SourceBot User-Agent on every request", async () => {
    const url = "https://example.com/feed";
    const stub = makeStubFetch({
      [url]: new Response("<rss/>", { status: 200 }),
    });
    const deps = makeDeps({ fetchImpl: stub.fetchImpl });
    const res = await fetchPolite(url, deps);
    assert.equal(res.status, 200);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].headers["User-Agent"], USER_AGENT);
  });

  it("rejects non-http(s) URLs", async () => {
    const deps = makeDeps();
    await assert.rejects(() => fetchPolite("file:///etc/passwd", deps), /refusing non-http/);
    await assert.rejects(() => fetchPolite("ftp://example.com/feed", deps), /refusing non-http/);
    await assert.rejects(() => fetchPolite("javascript:alert(1)", deps), /refusing non-http/);
  });
});

describe("fetchPolite — robots.txt enforcement", () => {
  it("throws RobotsDisallowedError for a disallowed path", async () => {
    const url = "https://example.com/private";
    const robots: RobotsProvider = async (host) => (host === "example.com" ? "User-agent: *\nDisallow: /private\n" : null);
    const deps = makeDeps({ robots });
    await assert.rejects(
      () => fetchPolite(url, deps),
      (err: unknown) => err instanceof RobotsDisallowedError && err.url === url,
    );
  });

  it("allows a path with Allow overriding a broader Disallow", async () => {
    const url = "https://example.com/api/public/feed";
    const stub = makeStubFetch({
      [url]: new Response("{}", { status: 200 }),
    });
    const robots: RobotsProvider = async () => "User-agent: *\nDisallow: /api/\nAllow: /api/public/\n";
    const deps = makeDeps({ fetchImpl: stub.fetchImpl, robots });
    const res = await fetchPolite(url, deps);
    assert.equal(res.status, 200);
  });

  it("proceeds when robots returns null (no robots.txt)", async () => {
    const url = "https://example.com/any";
    const stub = makeStubFetch({
      [url]: new Response("ok", { status: 200 }),
    });
    const deps = makeDeps({
      fetchImpl: stub.fetchImpl,
      robots: async () => null,
    });
    const res = await fetchPolite(url, deps);
    assert.equal(res.status, 200);
  });

  it("checks robots using the full path + query string", async () => {
    // Some robots.txt disallow specific query patterns, e.g.
    // `Disallow: /*?*session_id=`. We pass path+query, so the
    // evaluator sees the query.
    const url = "https://example.com/page?session_id=abc";
    const robots: RobotsProvider = async () => "User-agent: *\nDisallow: /*?*session_id=\n";
    const deps = makeDeps({ robots });
    await assert.rejects(() => fetchPolite(url, deps), RobotsDisallowedError);
  });
});

describe("fetchPolite — rate limiting", () => {
  it("serializes same-host requests", async () => {
    const clock = controllableClock();
    const limiter = new HostRateLimiter(clock.deps);
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const stub: typeof fetch = async (input) => {
      const url = String(input);
      order.push(`start:${url}`);
      if (url.endsWith("a")) {
        await new Promise<void>((resolve) => {
          releaseA = resolve;
        });
      }
      order.push(`end:${url}`);
      return new Response("", { status: 200 });
    };
    const deps = makeDeps({
      fetchImpl: stub,
      rateLimiter: limiter,
      rateLimiterDeps: clock.deps,
      crawlDelayMs: () => 0,
    });
    const fetchA = fetchPolite("https://example.com/a", deps);
    const fetchB = fetchPolite("https://example.com/b", deps);
    await Promise.resolve();
    await Promise.resolve();
    // Only a has started; b is queued.
    assert.deepEqual(order, ["start:https://example.com/a"]);
    releaseA();
    await Promise.all([fetchA, fetchB]);
    // b starts only after a ends.
    assert.deepEqual(order, ["start:https://example.com/a", "end:https://example.com/a", "start:https://example.com/b", "end:https://example.com/b"]);
  });

  it("uses crawlDelayMs() per host", async () => {
    const clock = controllableClock();
    const limiter = new HostRateLimiter(clock.deps);
    const stub = makeStubFetch({
      "https://slow.com/1": new Response("", { status: 200 }),
      "https://slow.com/2": new Response("", { status: 200 }),
    });
    const deps = makeDeps({
      fetchImpl: stub.fetchImpl,
      rateLimiter: limiter,
      rateLimiterDeps: clock.deps,
      // Host-specific delay: slow.com gets 5s between requests.
      crawlDelayMs: (host) => (host === "slow.com" ? 5_000 : 0),
    });
    await fetchPolite("https://slow.com/1", deps);
    const before = clock.read();
    await fetchPolite("https://slow.com/2", deps);
    assert.ok(clock.read() - before >= 5_000, `expected ≥5000ms gap, got ${clock.read() - before}`);
  });
});

describe("fetchPolite — timeout + abort", () => {
  it("aborts when the external signal fires mid-fetch", async () => {
    const controller = new AbortController();
    const url = "https://example.com/slow";
    const stub: typeof fetch = (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init!.signal!.reason ?? new DOMException("", "AbortError"));
        });
      });
    const deps = makeDeps({
      fetchImpl: stub,
      externalSignal: controller.signal,
    });
    const promise = fetchPolite(url, deps);
    // Cancel right away.
    controller.abort(new DOMException("cancelled", "AbortError"));
    await assert.rejects(() => promise, /cancelled|AbortError/);
  });

  it("rejects immediately when the external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("pre", "AbortError"));
    const deps = makeDeps({
      externalSignal: controller.signal,
    });
    await assert.rejects(() => fetchPolite("https://example.com/x", deps), /pre/);
  });

  it("calls onWillFetch right before the fetch fires", async () => {
    const url = "https://example.com/x";
    const stub = makeStubFetch({
      [url]: new Response("", { status: 200 }),
    });
    const calls: string[] = [];
    const deps = makeDeps({
      fetchImpl: stub.fetchImpl,
      onWillFetch: (fetchUrl) => calls.push(fetchUrl),
    });
    await fetchPolite(url, deps);
    assert.deepEqual(calls, [url]);
  });

  it("surfaces HTTP error responses as-is (no throwing)", async () => {
    const url = "https://example.com/404";
    const stub = makeStubFetch({
      [url]: new Response("not found", { status: 404 }),
    });
    const deps = makeDeps({ fetchImpl: stub.fetchImpl });
    const res = await fetchPolite(url, deps);
    // 4xx/5xx are not thrown — the fetcher inspects status.
    assert.equal(res.status, 404);
  });
});

describe("fetchPolite — manual redirect handling", () => {
  it("follows a 302 redirect to the Location URL", async () => {
    const start = "https://a.com/login";
    const target = "https://a.com/dashboard";
    const stub = makeStubFetch({
      [start]: new Response("", {
        status: 302,
        headers: { location: target },
      }),
      [target]: new Response("ok", { status: 200 }),
    });
    const deps = makeDeps({ fetchImpl: stub.fetchImpl });
    const res = await fetchPolite(start, deps);
    assert.equal(res.status, 200);
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].url, start);
    assert.equal(stub.calls[1].url, target);
  });

  it("re-checks robots.txt on every hop", async () => {
    // The redirect crosses hosts. robots.txt says `a.com` is OK but
    // `b.com` is disallowed — the second hop must throw rather than
    // quietly follow.
    const start = "https://a.com/go";
    const target = "https://b.com/blocked";
    const stub = makeStubFetch({
      [start]: new Response("", {
        status: 302,
        headers: { location: target },
      }),
      // target fetch should never happen
      [target]: new Response("leaked", { status: 200 }),
    });
    const robots: RobotsProvider = async (host) => {
      if (host === "b.com") return "User-agent: *\nDisallow: /";
      return null;
    };
    const deps = makeDeps({ fetchImpl: stub.fetchImpl, robots });
    await assert.rejects(
      () => fetchPolite(start, deps),
      (err: unknown) => err instanceof RobotsDisallowedError,
    );
    // First hop fired, second did not.
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, start);
  });

  it("resolves a relative Location against the current URL", async () => {
    const start = "https://a.com/foo/bar";
    const target = "https://a.com/baz";
    const stub = makeStubFetch({
      [start]: new Response("", {
        status: 301,
        headers: { location: "/baz" },
      }),
      [target]: new Response("ok", { status: 200 }),
    });
    const deps = makeDeps({ fetchImpl: stub.fetchImpl });
    const res = await fetchPolite(start, deps);
    assert.equal(res.status, 200);
    assert.equal(stub.calls[1].url, target);
  });

  it("returns the 3xx response as-is when no Location header is present", async () => {
    const start = "https://a.com/odd";
    const stub = makeStubFetch({
      [start]: new Response("no location", { status: 302 }),
    });
    const deps = makeDeps({ fetchImpl: stub.fetchImpl });
    const res = await fetchPolite(start, deps);
    assert.equal(res.status, 302);
    assert.equal(stub.calls.length, 1);
  });

  it("throws RedirectLimitError after MAX_REDIRECTS hops", async () => {
    // Build a chain of MAX_REDIRECTS + 2 redirects — too many.
    const base = "https://loop.example/";
    const responses: Record<string, Response> = {};
    for (let i = 0; i <= MAX_REDIRECTS + 1; i++) {
      const url = `${base}${i}`;
      const next = `${base}${i + 1}`;
      responses[url] = new Response("", {
        status: 302,
        headers: { location: next },
      });
    }
    const stub = makeStubFetch(responses);
    const deps = makeDeps({ fetchImpl: stub.fetchImpl });
    await assert.rejects(
      () => fetchPolite(`${base}0`, deps),
      (err: unknown) => err instanceof RedirectLimitError,
    );
  });

  it("does not auto-follow via fetch — uses redirect: 'manual'", async () => {
    // The point of manual redirects is that the platform's own
    // follow logic is disabled. We check the `redirect` init value
    // reaches our stub fetch.
    const start = "https://a.com/x";
    let observedRedirect: string | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      observedRedirect = init?.redirect;
      return new Response("ok", { status: 200 });
    };
    const deps = makeDeps({ fetchImpl });
    await fetchPolite(start, deps);
    assert.equal(observedRedirect, "manual");
  });
});
