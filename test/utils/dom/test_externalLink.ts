import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { isCrossOriginHttpUrl, handleExternalLinkClick } from "@mulmoclaude/markdown-utils/dom/externalLink";

const ORIGIN = "http://localhost:3001";

describe("isCrossOriginHttpUrl", () => {
  it("returns true for an http URL with a different origin", () => {
    assert.equal(isCrossOriginHttpUrl("http://example.com/page", ORIGIN), true);
  });

  it("returns true for an https URL with a different origin", () => {
    assert.equal(isCrossOriginHttpUrl("https://example.com/page", ORIGIN), true);
  });

  it("returns true for a different port on the same host", () => {
    // Different port → different origin per the web platform's
    // same-origin policy.
    assert.equal(isCrossOriginHttpUrl("http://localhost:8080/foo", ORIGIN), true);
  });

  it("returns false for a same-origin http URL", () => {
    assert.equal(isCrossOriginHttpUrl("http://localhost:3001/files/foo", ORIGIN), false);
  });

  it("returns false for a same-origin hash anchor (after href resolution)", () => {
    // `anchor.href` in the browser resolves `#section` to a full
    // URL like "http://localhost:3001/#section", which is
    // same-origin, so it should NOT be opened in a new tab — let
    // the browser scroll to the fragment instead.
    assert.equal(isCrossOriginHttpUrl("http://localhost:3001/#section", ORIGIN), false);
  });

  it("returns false for mailto: links", () => {
    assert.equal(isCrossOriginHttpUrl("mailto:alice@example.com", ORIGIN), false);
  });

  it("returns false for tel: links", () => {
    assert.equal(isCrossOriginHttpUrl("tel:+81-90-1234-5678", ORIGIN), false);
  });

  it("returns false for javascript: links (defensive)", () => {
    // eslint-disable-next-line no-script-url -- guard test fixture
    assert.equal(isCrossOriginHttpUrl("javascript:void(0)", ORIGIN), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(isCrossOriginHttpUrl("", ORIGIN), false);
  });

  it("returns false for a malformed URL that can't be parsed", () => {
    // "http://" alone is not a valid URL for the URL constructor.
    assert.equal(isCrossOriginHttpUrl("http://", ORIGIN), false);
  });

  it("returns false for a URL with no scheme (already relative)", () => {
    // Relative paths never reach this function from the click
    // handler (because `anchor.href` resolves them to an absolute
    // URL first), but the predicate should still reject them if
    // called directly.
    assert.equal(isCrossOriginHttpUrl("/files/foo.md", ORIGIN), false);
  });

  it("handles https origin correctly", () => {
    const httpsOrigin = "https://app.mulmoclaude.test";
    assert.equal(isCrossOriginHttpUrl("https://app.mulmoclaude.test/page", httpsOrigin), false);
    assert.equal(isCrossOriginHttpUrl("https://external.example.com/page", httpsOrigin), true);
  });

  it("treats http vs https on the same host as cross-origin", () => {
    // Scheme is part of the origin in the web platform.
    assert.equal(isCrossOriginHttpUrl("https://localhost:3001/foo", "http://localhost:3001"), true);
  });
});

// `handleExternalLinkClick` is the DOM half, and the half the plugin
// views actually bind (#2471 / #2493). It reads a live click event, so
// drive it with real jsdom nodes and dispatched MouseEvents instead of
// a hand-rolled event literal — `closest("a")`, href resolution, the
// modifier/button fields and `preventDefault()` all have to behave like
// the browser for these assertions to mean anything.
//
// The handler touches `window` lazily (inside the call), so installing
// the jsdom globals after the static import above is safe.

// The "leave it alone" cases deliberately let the anchor click run its
// default action, which makes jsdom report "Not implemented: navigation
// to another Document" for every one of them. Suppress THAT MESSAGE only
// — a blanket `jsdomError` sink would also swallow malformed-DOM errors
// and other not-implemented paths, so a real regression could pass
// silently. Anything else is collected and asserted on after each click.
const EXPECTED_JSDOM_ERROR = "Not implemented: navigation to another Document";
const unexpectedJsdomErrors: string[] = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error: Error) => {
  if (error.message === EXPECTED_JSDOM_ERROR) return;
  unexpectedJsdomErrors.push(error.message);
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: `${ORIGIN}/skills`, virtualConsole });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, MouseEvent: dom.window.MouseEvent });

interface OpenCall {
  url: string;
  target: string;
  features: string;
}
const openCalls: OpenCall[] = [];
dom.window.open = (url?: string | URL, target?: string, features?: string): null => {
  openCalls.push({ url: String(url), target: String(target), features: String(features) });
  return null;
};

interface ClickOutcome {
  handled: boolean;
  defaultPrevented: boolean;
  opened: OpenCall[];
}

// Only the MouseEvent fields the handler reads.
interface ClickInit {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

// Mirrors how the views wire it: one listener on the markdown container,
// the click originating somewhere inside the rendered body.
const clickInMarkdownBody = (bodyHtml: string, selector: string, init: ClickInit = {}): ClickOutcome => {
  openCalls.length = 0;
  unexpectedJsdomErrors.length = 0;
  const container = document.createElement("div");
  container.innerHTML = bodyHtml;
  document.body.replaceChildren(container);
  const clickTarget = container.querySelector(selector);
  assert.ok(clickTarget, `fixture selector "${selector}" matched nothing`);
  const outcome: ClickOutcome = { handled: false, defaultPrevented: false, opened: [] };
  container.addEventListener("click", (event) => {
    outcome.handled = handleExternalLinkClick(event);
  });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  clickTarget.dispatchEvent(event);
  assert.deepEqual(unexpectedJsdomErrors, [], "jsdom reported an error other than the expected navigation notice");
  outcome.defaultPrevented = event.defaultPrevented;
  outcome.opened = [...openCalls];
  return outcome;
};

const EXTERNAL_LINK_HTML = '<p>see <a href="https://example.com/docs">the docs</a></p>';

describe("handleExternalLinkClick — external links", () => {
  it("opens a cross-origin link in a new tab and cancels the in-page navigation", () => {
    const outcome = clickInMarkdownBody(EXTERNAL_LINK_HTML, "a");
    assert.equal(outcome.handled, true);
    assert.equal(outcome.defaultPrevented, true);
    assert.deepEqual(outcome.opened, [{ url: "https://example.com/docs", target: "_blank", features: "noopener,noreferrer" }]);
  });

  it("handles a click on an element nested inside the anchor", () => {
    // Markdown renders `[**docs**](…)` as a <strong> inside the <a>,
    // so the event target is usually NOT the anchor itself.
    const outcome = clickInMarkdownBody('<p><a href="https://example.com/docs"><strong>docs</strong></a></p>', "strong");
    assert.equal(outcome.handled, true);
    assert.equal(outcome.opened.length, 1);
  });

  it("treats a different port on the same host as external", () => {
    const outcome = clickInMarkdownBody('<a href="http://localhost:8080/tool">tool</a>', "a");
    assert.equal(outcome.handled, true);
    assert.deepEqual(
      outcome.opened.map((call) => call.url),
      ["http://localhost:8080/tool"],
    );
  });
});

// "Untouched" means all three at once: the caller is told the click was
// not consumed (so plugin-specific routing still runs), the browser's
// default is intact, and no tab was opened.
const UNTOUCHED: ClickOutcome = { handled: false, defaultPrevented: false, opened: [] };

describe("handleExternalLinkClick — links it must leave alone", () => {
  it("ignores a same-origin absolute link", () => {
    assert.deepEqual(clickInMarkdownBody(`<a href="${ORIGIN}/files/notes.md">notes</a>`, "a"), UNTOUCHED);
  });

  it("ignores a relative link (resolves to the current origin)", () => {
    assert.deepEqual(clickInMarkdownBody('<a href="/files/notes.md">notes</a>', "a"), UNTOUCHED);
  });

  it("ignores a hash anchor", () => {
    assert.deepEqual(clickInMarkdownBody('<a href="#section">jump</a>', "a"), UNTOUCHED);
  });

  it("ignores a mailto: link", () => {
    assert.deepEqual(clickInMarkdownBody('<a href="mailto:alice@example.com">mail</a>', "a"), UNTOUCHED);
  });

  it("ignores a click that is not inside any anchor", () => {
    assert.deepEqual(clickInMarkdownBody("<p>plain body text</p>", "p"), UNTOUCHED);
  });

  it("ignores a click on an anchor without an href (in-page target markers)", () => {
    assert.deepEqual(clickInMarkdownBody('<a id="marker">marker</a>', "a"), UNTOUCHED);
  });
});

// These already open a tab / window natively; intercepting them would
// duplicate the tab or break the user's intent.
describe("handleExternalLinkClick — clicks the browser should own", () => {
  it("defers a ctrl-click", () => {
    assert.deepEqual(clickInMarkdownBody(EXTERNAL_LINK_HTML, "a", { ctrlKey: true }), UNTOUCHED);
  });

  it("defers a cmd-click (macOS new tab)", () => {
    assert.deepEqual(clickInMarkdownBody(EXTERNAL_LINK_HTML, "a", { metaKey: true }), UNTOUCHED);
  });

  it("defers a shift-click (new window)", () => {
    assert.deepEqual(clickInMarkdownBody(EXTERNAL_LINK_HTML, "a", { shiftKey: true }), UNTOUCHED);
  });

  it("defers a middle-click", () => {
    assert.deepEqual(clickInMarkdownBody(EXTERNAL_LINK_HTML, "a", { button: 1 }), UNTOUCHED);
  });

  it("defers a right-click", () => {
    assert.deepEqual(clickInMarkdownBody(EXTERNAL_LINK_HTML, "a", { button: 2 }), UNTOUCHED);
  });
});
