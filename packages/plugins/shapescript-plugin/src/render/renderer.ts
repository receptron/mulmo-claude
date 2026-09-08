// Server-side rasterisation of a ShapeScript model, for `renderShapeScript`.
//
// The model is built headlessly with the plugin's own converter (so what is
// rendered is what `presentShapeScript` validated), handed to a headless
// Chromium as `toJSON()`, and screenshotted from several angles onto one
// contact sheet.
//
// The browser is Puppeteer's, declared as an OPTIONAL PEER: both hosts already
// depend on it (MulmoClaude drives it for PDF export, MulmoTerminal likewise), so
// the common case needs no new install, while a host without it is not forced to
// take a browser download for a feature it does not use. It is imported lazily and
// failure is reported as an install hint rather than a crash — a host that set
// `PUPPETEER_SKIP_DOWNLOAD`, or a sandbox that cannot spawn a browser, has no
// Chromium and should hear why.
//
// This module is SERVER-ONLY (`@mulmoclaude/shapescript-plugin/render`): it reads
// files and spawns a process, so it must never reach the browser bundle.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { astToThreeJS } from "../shapescript/toThreeJS";
import { parseShapeScript } from "../shapescript/parser";
import { isRecord } from "../core/contract";
import { buildRenderPage, type ViewAngle } from "./page";

const ONE_SECOND_MS = 1_000;

/** The message of an unknown thrown value. Local rather than imported from a host:
 *  this package is consumed by two of them and depends on neither. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How long one contact sheet may take in the browser before we give up. The
 *  geometry budget already bounds the model; this bounds the rasterisation. */
export const RENDER_TIMEOUT_MS = 60 * ONE_SECOND_MS;

/** How long the browser itself may take to start. Set explicitly rather than
 *  left to Puppeteer's own 30 s default, so the total below is derived from
 *  numbers this file controls instead of one it would silently inherit. */
export const LAUNCH_TIMEOUT_MS = 30 * ONE_SECOND_MS;

/** Worst case for one call, launch plus render. The MCP bridge must outlast
 *  THIS, not just the render — a slow launch followed by a full render is
 *  inside budget, and a bridge sized to the render alone aborts it in transit
 *  while the server carries on and saves an image nobody is waiting for
 *  (CodeRabbit on #3056). Callers add their own headroom for the work either
 *  side of it: serialising the scene, and writing the PNG. */
export const RENDER_BUDGET_MS = LAUNCH_TIMEOUT_MS + RENDER_TIMEOUT_MS;

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
  /** Reported for a fault that did not fail the render — currently only a browser
   *  that would not close. Optional because this package has no logger of its own:
   *  each host passes its own, and one that passes none loses the line rather than
   *  the render. */
  onWarning?: (message: string) => void;
}

/** Thrown when the host cannot rasterise at all — a missing browser, not a bad
 *  model. Separated so the tool reports the install hint instead of implying
 *  the script is at fault. */
export class RenderUnavailableError extends Error {}

/** Report something the host should record, without letting the report become
 *  the outcome. The callback is the HOST's code, and it is called from paths
 *  whose whole purpose is to answer gracefully — the `finally` that releases the
 *  browser after a finished render (CodeRabbit on #3059), and the
 *  browser-unavailable branch that returns install guidance (codex on #3060). A
 *  synchronous throw from a logger must not turn either into a rejection.
 *
 *  Exported because both callers need the same guarantee and one of them lives
 *  in `./tool`; two copies of "wrap the host's logger" is exactly the kind of
 *  thing that ends up guarded in one place and not the other. */
export function safeWarn(onWarning: ((message: string) => void) | undefined, message: string): void {
  try {
    onWarning?.(message);
  } catch {
    // A logger that throws is the host's problem, not this render's.
  }
}

// This module is built twice — ESM and, for hosts running CJS, CommonJS — and the
// two disagree about how a file locates itself. `import.meta` is rewritten to an
// empty object in the CJS output, so resolving three from `import.meta.url` alone
// would throw there; `__filename` is what exists instead, and does not exist in
// ESM. Each branch runs only in the build that has it.
declare const __filename: string | undefined;

function moduleUrl(): string {
  const url = (import.meta as { url?: string } | undefined)?.url;
  if (typeof url === "string" && url.length > 0) return url;
  if (typeof __filename === "string") return pathToFileURL(__filename).href;
  throw new Error("shapescript render: cannot locate this module to resolve three from");
}

const require = createRequire(moduleUrl());

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

/** A `require` anchored at THIS PACKAGE's real install location, however the
 *  calling code got here.
 *
 *  `moduleUrl()` is not enough on its own: MulmoClaude's MCP broker bundles its
 *  whole import graph into one file, so by the time this runs the module's own
 *  URL is the broker's, and resolving `three` from there searches the HOST's
 *  node_modules. That happened to work while the host declared three; it does
 *  not in a nested layout (a version conflict under npx, pnpm, Yarn PnP), where
 *  three exists only under this package — and this change removed the host
 *  declaration that was hiding it (codex on #3059).
 *
 *  Resolving our own `package.json` first re-anchors the search at wherever the
 *  package actually lives. Falling back to the module's own URL keeps a host
 *  that somehow cannot see the package name working exactly as before. */
function packageRequire(): ReturnType<typeof createRequire> {
  try {
    return createRequire(require.resolve("@mulmoclaude/shapescript-plugin/package.json"));
  } catch {
    return require;
  }
}

/** Absolute path of three's ES module build.
 *
 *  three's `exports` map publishes `.` under an `import` / `require` split and
 *  does NOT expose `./build/*`, so the file cannot be named directly. Resolving
 *  the bare specifier under CJS rules yields the CommonJS build — which a
 *  `<script type="module">` cannot run — hence the swap to its ESM sibling. */
function threeModulePath(): string {
  const resolved = packageRequire().resolve("three");
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
 *  keeps the render offline.
 *
 *  The origin is compared as a parsed ORIGIN, never as a string prefix:
 *  `https://shapescript.invalid.example.com/` starts with the origin text but
 *  is a different — and real — host (CodeQL js/incomplete-url-substring-sanitization
 *  on #3056). */
async function assetFor(url: string, html: string, buildDir: string): Promise<{ contentType: string; body: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== RENDER_ORIGIN) return null;
  const name = path.posix.basename(parsed.pathname);
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
        const asset = await assetFor(request.url(), html, buildDir);
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
    browser = await launcher.launch({
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
      args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
    });
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
      const symptom = pageErrors.length > 0 ? `the render page failed: ${pageErrors.join("; ")}` : errorMessage(err);
      throw new Error(symptom, { cause: err });
    }
    const dataUrl = await page.evaluate("window.__shapeSheet");
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("the render page produced no image");
    }
    return dataUrl.slice("data:image/png;base64,".length);
  } finally {
    // A failed close leaks a browser process but does not invalidate the render
    // that just succeeded, so it must not replace the result with an error. The
    // host has the logger; this package reports it through `onWarning` when one
    // was supplied.
    await browser.close().catch((err: unknown) => safeWarn(options.onWarning, `chromium close failed: ${errorMessage(err)}`));
  }
}
