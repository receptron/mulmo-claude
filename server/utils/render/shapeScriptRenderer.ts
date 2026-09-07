// Server-side rasterisation of a ShapeScript model, for `renderShapeScript`.
//
// The model is built headlessly with the plugin's own converter (so what is
// rendered is what `presentShapeScript` validated), handed to a headless
// Chromium as `toJSON()`, and screenshotted from several angles onto one
// contact sheet. Chromium is Playwright's, which is a DEV dependency: an
// npm-installed host has no browser, and this module says so in a form the
// agent can act on rather than failing obscurely.

import { readFile } from "fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { astToThreeJS, parseShapeScript } from "@mulmoclaude/shapescript-plugin";
import { errorMessage } from "../errors.js";
import { isRecord } from "../types.js";
import { log } from "../../system/logger/index.js";
import { ONE_SECOND_MS } from "../time.js";
import { buildRenderPage, type ViewAngle } from "./shapeScriptPage.js";

/** How long one contact sheet may take in the browser before we give up. The
 *  geometry budget already bounds the model; this bounds the rasterisation. */
const RENDER_TIMEOUT_MS = 60 * ONE_SECOND_MS;

/** The install step a missing browser needs. Repeated verbatim in
 *  `error-recovery.md` — the agent reads that file before asking the user. */
export const CHROMIUM_HINT =
  "renderShapeScript needs Playwright's Chromium, which is not installed. Run `yarn ensure:playwright-browsers` in the MulmoClaude checkout (or `npx playwright install chromium`), then retry. Everything else, including presentShapeScript, works without it.";

export interface RenderShapeScriptOptions {
  script: string;
  views: readonly ViewAngle[];
  width: number;
  height: number;
  zoom: number;
  projection: "perspective" | "orthographic";
}

/** Thrown when the host cannot rasterise at all — a missing browser, not a bad
 *  model. Separated so the tool reports the install hint instead of implying
 *  the script is at fault. */
export class RenderUnavailableError extends Error {}

const require = createRequire(import.meta.url);

interface ChromiumLike {
  launch: (options: object) => Promise<BrowserLike>;
}

/** Narrow the dynamically imported module rather than asserting it: the import
 *  is untyped by design (the package may not be installed at all), so a cast
 *  would be a claim about a value nothing checked. */
function isChromium(value: unknown): value is ChromiumLike {
  return isRecord(value) && typeof value.launch === "function";
}

/** Playwright's chromium launcher, or null when the package is absent.
 *  Imported lazily: it is a dev dependency, so a static import would crash an
 *  npm-installed host at boot rather than when the tool is called. */
async function loadChromium(): Promise<ChromiumLike | null> {
  try {
    const playwright: unknown = await import("@playwright/test");
    if (!isRecord(playwright)) return null;
    return isChromium(playwright.chromium) ? playwright.chromium : null;
  } catch {
    return null;
  }
}

// The slice of Playwright's API this module uses. Declared structurally so the
// dev-only package is never a compile-time dependency of the server build.
interface RouteLike {
  request: () => { url: () => string };
  fulfill: (response: { status: number; contentType: string; body: string }) => Promise<unknown>;
  abort: () => Promise<unknown>;
}
interface PageLike {
  route: (pattern: string, handler: (route: RouteLike) => Promise<unknown>) => Promise<unknown>;
  goto: (url: string, options?: object) => Promise<unknown>;
  on: (event: "pageerror", handler: (error: Error) => void) => void;
  waitForFunction: (expression: string, arg?: unknown, options?: object) => Promise<unknown>;
  evaluate: (expression: string) => Promise<unknown>;
}
interface BrowserLike {
  newPage: (options?: object) => Promise<PageLike>;
  close: () => Promise<void>;
}

/** Absolute path of three's ES module build.
 *
 *  three's `exports` map publishes `.` under an `import` / `require` split and
 *  does NOT expose `./build/*`, so the file cannot be named directly. Resolving
 *  the bare specifier under CJS rules yields the CommonJS build — which a
 *  `<script type="module">` cannot run — hence the swap to its ESM sibling. */
function threeModulePath(): string {
  const resolved = require.resolve("three");
  return resolved.endsWith("three.cjs") ? resolved.replace(/three\.cjs$/, "three.module.js") : resolved;
}

// The page is served from a fake origin the driver intercepts, so three's own
// relative imports (`three.module.js` re-exports `./three.core.js`) resolve as
// ordinary module requests — and nothing ever leaves the machine. `.invalid` is
// reserved by RFC 2606: it can never become a real host.
const RENDER_ORIGIN = "https://shapescript.invalid";
const PAGE_URL = `${RENDER_ORIGIN}/render.html`;
const THREE_URL = "./three.module.js";

/** Serve the render page and three's build directory, and refuse everything
 *  else — a model can carry no URLs of its own, so any other request is a bug
 *  rather than a resource, and failing it closed keeps the render offline. */
async function serveRenderAssets(page: PageLike, html: string): Promise<void> {
  const buildDir = path.dirname(threeModulePath());
  await page.route(`${RENDER_ORIGIN}/**`, async (route: RouteLike) => {
    const name = path.posix.basename(new URL(route.request().url()).pathname);
    if (name === "render.html") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
      return;
    }
    if (/^three[\w.-]*\.js$/.test(name)) {
      const body = await readFile(path.join(buildDir, name), "utf-8");
      await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body });
      return;
    }
    await route.abort();
  });
}

/**
 * Render `script` to a PNG contact sheet, returned base64-encoded.
 *
 * Throws `RenderUnavailableError` when no browser is installed, and a plain
 * Error when the script itself fails to parse / build (the same diagnostics
 * `presentShapeScript` returns) or the page never produces an image.
 */
export async function renderShapeScriptSheet(options: RenderShapeScriptOptions): Promise<string> {
  const chromium = await loadChromium();
  if (!chromium) throw new RenderUnavailableError(CHROMIUM_HINT);

  // Build + serialise before launching a browser: a bad script should cost a
  // parse, not a browser start.
  const model = astToThreeJS(parseShapeScript(options.script));
  const sceneJson: unknown = model.toJSON();
  const html = buildRenderPage({ ...options, threeUrl: THREE_URL, sceneJson });

  let browser: BrowserLike;
  try {
    // SwiftShader is Chromium's software GL: CI and headless servers have no
    // GPU, and without this the WebGL context creation fails outright.
    browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"] });
  } catch (err) {
    throw new RenderUnavailableError(`${CHROMIUM_HINT} (launch failed: ${errorMessage(err)})`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    // A script error leaves `__shapeSheet` unset, and the wait below would then
    // report only a timeout. Surfacing the real message is the difference
    // between a diagnosable failure and a mystery.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await serveRenderAssets(page, html);
    await page.goto(PAGE_URL, { waitUntil: "load" });
    try {
      await page.waitForFunction("typeof window.__shapeSheet === 'string'", undefined, { timeout: RENDER_TIMEOUT_MS });
    } catch (err) {
      throw new Error(pageErrors.length > 0 ? `the render page failed: ${pageErrors.join("; ")}` : errorMessage(err));
    }
    const dataUrl = await page.evaluate("window.__shapeSheet");
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("the render page produced no image");
    }
    return dataUrl.slice("data:image/png;base64,".length);
  } finally {
    await browser.close().catch((err: unknown) => log.warn("render", "chromium close failed", { error: errorMessage(err) }));
  }
}
