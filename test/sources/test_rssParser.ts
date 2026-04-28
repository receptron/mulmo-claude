import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "../../server/workspace/sources/fetchers/rssParser.js";

// --- RSS 2.0 ------------------------------------------------------------

describe("parseFeed — RSS 2.0", () => {
  const RSS_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <item>
      <title>First post</title>
      <link>https://example.com/1</link>
      <guid>https://example.com/1</guid>
      <pubDate>Wed, 01 Apr 2026 12:00:00 GMT</pubDate>
      <description>Short summary of first post.</description>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/2</link>
      <guid>https://example.com/2</guid>
      <pubDate>Thu, 02 Apr 2026 09:30:00 GMT</pubDate>
      <description>Summary for second.</description>
    </item>
  </channel>
</rss>`;

  it("parses basic RSS 2.0", () => {
    const feed = parseFeed(RSS_BASIC);
    assert.ok(feed);
    assert.equal(feed.kind, "rss");
    assert.equal(feed.title, "Example Feed");
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].title, "First post");
    assert.equal(feed.items[0].link, "https://example.com/1");
    assert.equal(feed.items[0].feedId, "https://example.com/1");
    assert.equal(feed.items[0].summary, "Short summary of first post.");
    // RFC 822 → ISO 8601 conversion
    assert.ok(feed.items[0].publishedAt);
    assert.match(feed.items[0].publishedAt, /2026-04-01T12:00:00/);
  });

  it("normalizes multiple date formats to ISO", () => {
    // A feed in the wild with a non-standard date — we pass
    // through whatever Date.parse can handle.
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <title>item</title>
      <link>https://x.com/1</link>
      <pubDate>2026-04-01T12:00:00Z</pubDate>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items[0].publishedAt, "2026-04-01T12:00:00.000Z");
  });

  it("preserves the raw date string when parsing fails", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <title>item</title>
      <link>https://x.com/1</link>
      <pubDate>not-a-date</pubDate>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    // Fallback: passes the junk through rather than dropping.
    assert.equal(feed.items[0].publishedAt, "not-a-date");
  });

  it("handles CDATA-wrapped description", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <title>item</title>
      <link>https://x.com/1</link>
      <description><![CDATA[<p>HTML <strong>body</strong>.</p>]]></description>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.ok(feed.items[0].summary);
    assert.match(feed.items[0].summary, /HTML.*body/);
  });

  it("picks up content:encoded as the full content body", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>t</title>
    <item>
      <title>item</title>
      <link>https://x.com/1</link>
      <description>short summary</description>
      <content:encoded><![CDATA[<p>Full body HTML.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items[0].summary, "short summary");
    assert.ok(feed.items[0].content);
    assert.match(feed.items[0].content, /Full body/);
  });

  it("drops entries with no title", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <link>https://x.com/titleless</link>
    </item>
    <item>
      <title>has title</title>
      <link>https://x.com/1</link>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].title, "has title");
  });

  it("handles feeds with a single item (not wrapped in array)", () => {
    // Without `isArray` hinting, fast-xml-parser collapses
    // single-element lists into objects. The parser must coerce
    // to an array.
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <title>only one</title>
      <link>https://x.com/1</link>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items.length, 1);
  });

  it("falls back to link when guid is absent", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <title>x</title>
      <link>https://x.com/1</link>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items[0].feedId, "https://x.com/1");
  });
});

// --- RSS 1.0 / RDF ------------------------------------------------------

describe("parseFeed — RSS 1.0 (RDF)", () => {
  it("parses an RDF feed with top-level items", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/"
         xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.com">
    <title>RDF Feed</title>
    <link>https://example.com</link>
  </channel>
  <item rdf:about="https://example.com/1">
    <title>RDF item</title>
    <link>https://example.com/1</link>
    <description>summary</description>
  </item>
</rdf:RDF>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.kind, "rss");
    assert.equal(feed.title, "RDF Feed");
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].title, "RDF item");
  });
});

// --- Atom 1.0 -----------------------------------------------------------

describe("parseFeed — Atom 1.0", () => {
  const ATOM_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom post</title>
    <id>urn:uuid:1</id>
    <link rel="alternate" href="https://example.com/1" />
    <link rel="self" href="https://example.com/1.atom" />
    <published>2026-04-01T12:00:00Z</published>
    <summary>short</summary>
    <content type="html">full body</content>
  </entry>
</feed>`;

  it("parses basic Atom", () => {
    const feed = parseFeed(ATOM_BASIC);
    assert.ok(feed);
    assert.equal(feed.kind, "atom");
    assert.equal(feed.title, "Atom Feed");
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].title, "Atom post");
    assert.equal(feed.items[0].feedId, "urn:uuid:1");
    assert.equal(feed.items[0].summary, "short");
    assert.equal(feed.items[0].content, "full body");
  });

  it("prefers rel=alternate over rel=self for the link", () => {
    const feed = parseFeed(ATOM_BASIC);
    assert.ok(feed);
    // Alternate (web URL) wins; self (feed URL) is ignored.
    assert.equal(feed.items[0].link, "https://example.com/1");
  });

  it("falls back to the first link when no rel=alternate present", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>t</title>
  <entry>
    <title>x</title>
    <id>u1</id>
    <link rel="related" href="https://example.com/related" />
    <link rel="enclosure" href="https://example.com/audio.mp3" />
  </entry>
</feed>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    // First link wins when none is "alternate".
    assert.equal(feed.items[0].link, "https://example.com/related");
  });

  it("uses <updated> when <published> is missing", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>t</title>
  <entry>
    <title>x</title>
    <id>u1</id>
    <link href="https://example.com/1" />
    <updated>2026-04-01T12:00:00Z</updated>
  </entry>
</feed>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items[0].publishedAt, "2026-04-01T12:00:00.000Z");
  });

  it("handles a plain <link>some-url</link> (no attrs)", () => {
    // Some feeds are hand-written and don't use the attribute form.
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>t</title>
  <entry>
    <title>x</title>
    <id>u1</id>
    <link>https://example.com/1</link>
  </entry>
</feed>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items[0].link, "https://example.com/1");
  });
});

// --- malformed / edge cases --------------------------------------------

describe("parseFeed — malformed / unusual input", () => {
  it("returns null for empty input", () => {
    assert.equal(parseFeed(""), null);
    assert.equal(parseFeed("   \n   "), null);
  });

  it("returns null for non-XML garbage", () => {
    assert.equal(parseFeed("not xml at all"), null);
  });

  it("returns null for well-formed XML that isn't a feed", () => {
    assert.equal(parseFeed("<root><nope/></root>"), null);
  });

  it("tolerates a UTF-8 BOM at the start", () => {
    const bom = "\uFEFF";
    const xml = `${bom}<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>t</title>
    <item>
      <title>x</title>
      <link>https://x.com/1</link>
    </item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.equal(feed.items.length, 1);
  });

  it("tolerates malformed XML that still has a feed-looking root", () => {
    // fast-xml-parser is fairly lenient; we rely on that.
    const xml = `<rss version="2.0">
  <channel>
    <title>t</title>
    <item><title>x</title><link>https://x.com/1</link></item>
  </channel>
</rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
  });

  it("returns an empty items array for a feed with no items", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>empty</title></channel></rss>`;
    const feed = parseFeed(xml);
    assert.ok(feed);
    assert.deepEqual(feed.items, []);
  });
});
