import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchText } from "../../src/feeds/server/fetch/httpClient.ts";

// All cases reject at the SSRF guard BEFORE any network call (IP literals
// need no DNS), so these run offline and deterministically.
describe("httpClient SSRF guard", () => {
  it("rejects non-http(s) schemes", async () => {
    await assert.rejects(() => fetchText("ftp://example.com/x"), /non-http/);
    await assert.rejects(() => fetchText("file:///etc/passwd"), /non-http/);
  });

  it("rejects loopback / private / link-local / metadata addresses", async () => {
    await assert.rejects(() => fetchText("http://127.0.0.1:9/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://10.1.2.3/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://192.168.0.1/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://172.16.5.5/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://169.254.169.254/latest/meta-data/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://[::1]/"), /private|loopback/);
  });

  it("rejects the ranges the shared deny-list added over the old local table (#2459)", async () => {
    await assert.rejects(() => fetchText("http://192.0.0.8/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://198.18.0.1/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://224.0.0.1/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://240.0.0.1/"), /private|loopback/);
  });

  it("rejects internal-by-convention hostnames without DNS (#2459)", async () => {
    await assert.rejects(() => fetchText("http://localhost:9/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://printer.local/feed"), /private|loopback/);
    await assert.rejects(() => fetchText("http://db.internal/feed"), /private|loopback/);
  });

  it("rejects an IPv4-mapped IPv6 wrapper around a blocked address", async () => {
    await assert.rejects(() => fetchText("http://[::ffff:127.0.0.1]/"), /private|loopback/);
  });
});
