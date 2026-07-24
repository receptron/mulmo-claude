// Attachment URLs arrive from remote senders, and with the allowlist unset any
// account can reach that path. The pure classification cases (deny-list edges,
// hostname blocklist, URL shape) are covered in @mulmoclaude/common's
// test_ssrf.ts (#2459); this file covers the DNS-resolution wrapper the bridge
// keeps.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolvePublicUrl } from "../src/urlGuard.js";

describe("resolvePublicUrl", () => {
  it("refuses a literal internal address without touching DNS", async () => {
    assert.equal(await resolvePublicUrl("http://127.0.0.1/x"), null);
    assert.equal(await resolvePublicUrl("http://169.254.169.254/latest/meta-data/"), null);
    assert.equal(await resolvePublicUrl("http://[::1]/x"), null);
  });

  it("refuses non-http(s) schemes and unparseable input", async () => {
    assert.equal(await resolvePublicUrl("file:///etc/passwd"), null);
    assert.equal(await resolvePublicUrl("not a url"), null);
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // `localhost` is caught by name, but this asserts the resolve path too.
    assert.equal(await resolvePublicUrl("http://localhost/x"), null);
  });

  it("refuses a hostname that does not resolve", async () => {
    assert.equal(await resolvePublicUrl("http://no-such-host.invalid/x"), null);
  });

  it("passes a literal public address straight through", async () => {
    const url = await resolvePublicUrl("https://1.1.1.1/a.png");
    assert.notEqual(url, null);
  });
});
