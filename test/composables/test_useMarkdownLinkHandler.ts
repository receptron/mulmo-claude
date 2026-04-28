import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { useMarkdownLinkHandler } from "../../src/composables/useMarkdownLinkHandler.ts";

// Minimal Element stub: `closest(selector)` walks a parent chain we
// pre-build in each test; `getAttribute` reads a map. useMarkdownLinkHandler
// only touches these two methods plus the `instanceof Element` check
// which we satisfy by stubbing `globalThis.Element`.

interface FakeAnchor {
  getAttribute(name: string): string | null;
}

interface FakeElement {
  tag: string;
  parent: FakeElement | null;
  href?: string;
  closest(selector: string): FakeAnchor | null;
}

function makeAnchor(href: string | null): FakeElement {
  const anchor: FakeElement = {
    tag: "a",
    parent: null,
    href: href ?? undefined,
    closest(selector) {
      if (selector !== "a") return null;
      return {
        getAttribute: (name: string) => (name === "href" ? (href ?? null) : null),
      };
    },
  };
  return anchor;
}

function makeSpanInsideAnchor(href: string | null): FakeElement {
  // Span whose `closest("a")` walks up to the anchor.
  const anchorAttrs = href;
  return {
    tag: "span",
    parent: null,
    closest(selector) {
      if (selector !== "a") return null;
      return {
        getAttribute: (name: string) => (name === "href" ? (anchorAttrs ?? null) : null),
      };
    },
  };
}

interface FakeMouseEvent {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: FakeElement | null | Record<string, unknown>;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function makeEvent(opts: Partial<FakeMouseEvent> = {}): FakeMouseEvent {
  const event: FakeMouseEvent = {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.propagationStopped = true;
    },
    ...opts,
  };
  return event;
}

// Install a minimal Element constructor so `instanceof Element` passes
// for anything whose prototype chain includes our base. An empty class
// is the only way to get a constructor function that supports
// `instanceof` checks; a const-bound function or module isn't usable
// here.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- need a real constructor for `instanceof` checks
class FakeElementBase {}
const originalElement = (globalThis as { Element?: unknown }).Element;

function installFakeElement(): void {
  (globalThis as { Element: unknown }).Element = FakeElementBase;
}
function restoreElement(): void {
  if (originalElement === undefined) {
    delete (globalThis as { Element?: unknown }).Element;
  } else {
    (globalThis as { Element: unknown }).Element = originalElement;
  }
}

function makeReal(fake: FakeElement): FakeElement {
  Object.setPrototypeOf(fake, FakeElementBase.prototype);
  return fake;
}

interface CapturedCalls {
  navigate: string[];
  session: string[];
}

function setup(selectedPath: string | null = "notes/a.md") {
  const captured: CapturedCalls = { navigate: [], session: [] };
  const path = ref<string | null>(selectedPath);
  const { handleMarkdownLinkClick } = useMarkdownLinkHandler(path, {
    onNavigate: (target) => captured.navigate.push(target),
    onLoadSession: (sessionId) => captured.session.push(sessionId),
  });
  return { path, handleMarkdownLinkClick, captured };
}

describe("useMarkdownLinkHandler", () => {
  beforeEach(installFakeElement);
  afterEach(restoreElement);

  it("navigates to a resolved workspace path for relative links", () => {
    const { handleMarkdownLinkClick, captured } = setup("notes/a.md");
    const event = makeEvent({ target: makeReal(makeAnchor("./b.md")) });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.deepEqual(captured.navigate, ["notes/b.md"]);
    assert.equal(captured.session.length, 0);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
  });

  it("walks up via closest('a') when the click target is a nested element", () => {
    const { handleMarkdownLinkClick, captured } = setup("notes/a.md");
    const event = makeEvent({
      target: makeReal(makeSpanInsideAnchor("./b.md")),
    });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.deepEqual(captured.navigate, ["notes/b.md"]);
  });

  it("emits loadSession (not navigate) for chat/<id>.jsonl links", () => {
    // resolveWorkspaceLink joins "notes/a.md" + "../chat/abc-123.jsonl"
    // → "chat/abc-123.jsonl", which extractSessionIdFromPath recognises.
    const { handleMarkdownLinkClick, captured } = setup("notes/a.md");
    const event = makeEvent({
      target: makeReal(makeAnchor("../chat/abc-123.jsonl")),
    });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.deepEqual(captured.session, ["abc-123"]);
    assert.equal(captured.navigate.length, 0);
  });

  it("ignores external http(s) links (lets browser handle)", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    const event = makeEvent({
      target: makeReal(makeAnchor("https://example.com")),
    });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.equal(captured.navigate.length, 0);
    assert.equal(event.defaultPrevented, false);
  });

  it("ignores anchor-only (#section) links", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    const event = makeEvent({ target: makeReal(makeAnchor("#heading")) });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.equal(captured.navigate.length, 0);
    assert.equal(event.defaultPrevented, false);
  });

  it("ignores right/middle button clicks", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    for (const button of [1, 2]) {
      const event = makeEvent({
        button,
        target: makeReal(makeAnchor("./b.md")),
      });
      handleMarkdownLinkClick(event as unknown as MouseEvent);
    }
    assert.equal(captured.navigate.length, 0);
  });

  it("ignores modifier-key clicks (ctrl/meta/shift open in new tab)", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    for (const mod of ["ctrlKey", "metaKey", "shiftKey"] as const) {
      const event = makeEvent({
        [mod]: true,
        target: makeReal(makeAnchor("./b.md")),
      });
      handleMarkdownLinkClick(event as unknown as MouseEvent);
    }
    assert.equal(captured.navigate.length, 0);
  });

  it("does nothing when event.target isn't an Element (regression: instanceof guard)", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    // A plain object that does NOT inherit from FakeElementBase.
    const event = makeEvent({
      target: { closest: () => makeAnchor("./b.md") },
    });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.equal(captured.navigate.length, 0);
  });

  it("does nothing when the target has no surrounding anchor", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    const targetWithNoAnchor: FakeElement = {
      tag: "p",
      parent: null,
      closest: () => null,
    };
    const event = makeEvent({ target: makeReal(targetWithNoAnchor) });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.equal(captured.navigate.length, 0);
  });

  it("does nothing when href is missing", () => {
    const { handleMarkdownLinkClick, captured } = setup();
    const event = makeEvent({ target: makeReal(makeAnchor(null)) });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.equal(captured.navigate.length, 0);
  });

  it("does nothing when no file is selected (selectedPath is null)", () => {
    const { handleMarkdownLinkClick, captured } = setup(null);
    const event = makeEvent({ target: makeReal(makeAnchor("./b.md")) });
    handleMarkdownLinkClick(event as unknown as MouseEvent);
    assert.equal(captured.navigate.length, 0);
  });
});
