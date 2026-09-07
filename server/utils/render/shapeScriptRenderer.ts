// Server-side rasterisation of a ShapeScript model, for `renderShapeScript`.
//
// The model is built headlessly with the plugin's own converter (so what is
// rendered is what `presentShapeScript` validated), handed to a headless
// Chromium as `toJSON()`, and screenshotted from several angles onto one
// contact sheet.
//
// The browser is Puppeteer's — the same one `server/api/routes/pdf.ts` already
// drives, and a production dependency of the launcher, so an npm-installed host
// can render without installing anything. It is still imported lazily and
// failure is still reported as an install hint rather than a crash: a host that
// set `PUPPETEER_SKIP_DOWNLOAD`, or a sandbox that cannot spawn a browser, has
// no Chromium and should hear why.

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
 *  geometry budget already bounds the model; this bounds the rasterisation.
 *  Exported because the MCP bridge has to outlast it — see the tool's
 *  `bridgeTimeoutMs`. */
export const RENDER_TIMEOUT_MS = 60 * ONE_SECOND_MS;

/** The install step a missing browser needs. Repeated verbatim in
 *  `error-recovery.md` — the agent reads that file before asking the user. */
export const CHROMIUM_HINT =
  "renderShapeScript needs Puppeteer's headless Chromium, which this host does not have. Run `npx puppeteer browsers install chrome`, then retry. Everything else, including presentShapeScript, works without it.";

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

interface LauncherLike {
  launch: (options: object) => Promise<BrowserLike>;
}

/** Narrow the dynamically imported module rather than asserting it: a lazy
 *  import is untyped, so a cast would be a claim about a value nothing checked. */
function isLauncher(value: unknown): value is LauncherLike {
  return isRecord(value) && typeof value.launch === "function";
}

/** Puppeteer's launcher, or null when it cannot be loaded at all. Imported
 *  lazily rather than at module scope: pulling a browser driver into the graph
 *  on every boot costs every other tool startup time for one optional feature. */
async function loadLauncher(): Promise<LauncherLike | null> {
  try {
    const puppeteer: unknown = await import("puppeteer");
    if (isLauncher(puppeteer)) return puppeteer;
    // ESM/CJS interop: the CJS build arrives as `{ default: … }`.
    return isRecord(puppeteer) && isLauncher(puppeteer.default) ? puppeteer.default : null;
  } catch {
    return null;
  }
}

// The slice of Puppeteer's API this module uses. Declared structurally, so the
// lazily-imported package is not a compile-time dependency of the server build
// and the driver stays swappable.
interface RequestLike {
  url: () => string;
  respond: (response: { status: number; contentType: string; body: string }) => Promise<unknown>;
  abort: () => Promise<unknown>;
}
interface PageLike {
  setRequestInterception: (enabled: boolean) => Promise<unknown>;
  setViewport: (viewport: { width: number; height: number }) => Promise<unknown>;
  goto: (url: string, options?: object) => Promise<unknown>;
  on: ((event: "request", handler: (request: RequestLike) => void) => void) & ((event: "pageerror", handler: (error: Error) => void) => void);
  waitForFunction: (expression: string, options?: object) => Promise<unknown>;
  evaluate: (expression: string) => Promise<unknown>;
}
interface BrowserLike {
  newPage: () => Promise<PageLike>;
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

/** The body for one intercepted request, or null to refuse it. Only the page
 *  itself and three's own build files are served: a model can carry no URLs, so
 *  any other request is a bug rather than a resource, and failing closed is what
 *  keeps the render offline. */
async function assetFor(url: string, html: string, buildDir: string): Promise<{ contentType: string; body: string } | null> {
  const name = path.posix.basename(new URL(url).pathname);
  if (name === "render.html") return { contentType: "text/html; charset=utf-8", body: html };
  if (!/^three[\w.-]*\.js$/.test(name)) return null;
  return { contentType: "text/javascript; charset=utf-8", body: await readFile(path.join(buildDir, name), "utf-8") };
}

/** Answer the page's requests from disk. Puppeteer's interception is per-page
 *  and synchronous in registration, so the handler resolves its own promise. */
async function serveRenderAssets(page: PageLike, html: string): Promise<void> {
  const buildDir = path.dirname(threeModulePath());
  await page.setRequestInterception(true);
  page.on("request", (request: RequestLike) => {
    void (async () => {
      // An aborted request whose page has already closed rejects; the render
      // either finished (nothing left to serve) or failed for its own reason.
      try {
        const asset = request.url().startsWith(RENDER_ORIGIN) ? await assetFor(request.url(), html, buildDir) : null;
        await (asset ? request.respond({ status: 200, ...asset }) : request.abort());
      } catch {
        // Nothing to do — the wait below reports the real failure.
      }
    })();
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
  const launcher = await loadLauncher();
  if (!launcher) throw new RenderUnavailableError(CHROMIUM_HINT);

  // Build + serialise before launching a browser: a bad script should cost a
  // parse, not a browser start.
  const model = astToThreeJS(parseShapeScript(options.script));
  const sceneJson: unknown = model.toJSON();
  const html = buildRenderPage({ ...options, threeUrl: THREE_URL, sceneJson });

  let browser: BrowserLike;
  try {
    // SwiftShader is Chromium's software GL: CI and headless servers have no
    // GPU, and without this the WebGL context creation fails outright.
    browser = await launcher.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"] });
  } catch (err) {
    throw new RenderUnavailableError(`${CHROMIUM_HINT} (launch failed: ${errorMessage(err)})`);
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    // A script error leaves `__shapeSheet` unset, and the wait below would then
    // report only a timeout. Surfacing the real message is the difference
    // between a diagnosable failure and a mystery.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await serveRenderAssets(page, html);
    await page.goto(PAGE_URL, { waitUntil: "load" });
    try {
      await page.waitForFunction("typeof window.__shapeSheet === 'string'", { timeout: RENDER_TIMEOUT_MS });
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
