// Regressions guard for two file-explorer content-rendering bugs
// fixed together:
//
//   1. Chart.js-style HTML (inline <script>, canvas-drawn charts)
//      opened via the Files view was rendered in an iframe with
//      `sandbox=""`, blocking ALL scripts. Now `allow-scripts` +
//      a CSP whitelist for trusted CDNs.
//   2. `![alt](images/foo.png)` in markdown files / wiki pages
//      rendered via the Files view fell back to the SPA route URL
//      (e.g. `/chat/.../images/foo.png`) and 404'd. Now rewritten
//      to `/api/files/raw?path=...` pre-marked.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

async function mockFileContent(
  page: Page,
  pathMatch: string,
  body: { kind: "text" | "image"; content?: string },
): Promise<void> {
  await page.route(
    (url) =>
      url.pathname === "/api/files/content" &&
      url.searchParams.get("path") === pathMatch,
    (route: Route) =>
      route.fulfill({
        json: {
          kind: body.kind,
          path: pathMatch,
          content: body.content ?? "",
          size: 100,
          modifiedMs: Date.now(),
        },
      }),
  );
}

test.describe("Files view — HTML iframe sandbox + CSP", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("HTML preview iframe allows scripts (Chart.js would run)", async ({
    page,
  }) => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Chart</title></head>
<body>
<canvas id="c"></canvas>
<script>/* inline */</script>
</body>
</html>`;
    await mockFileContent(page, "HTMLs/chart.html", {
      kind: "text",
      content: html,
    });

    await page.goto("/chat?view=files&path=HTMLs/chart.html");
    const iframe = page.locator('iframe[title="HTML preview"]');
    await expect(iframe).toBeVisible();

    // Sandbox must include `allow-scripts` so Chart.js / inline JS
    // can actually run — without it LLM-generated chart HTMLs
    // render as blank canvases.
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    // But NOT `allow-same-origin` — keeps the iframe null-origin so
    // it can't read parent cookies / localStorage.
    expect(sandbox).not.toContain("allow-same-origin");
  });

  test("HTML preview injects a CSP meta tag narrowing scripts to whitelisted CDNs", async ({
    page,
  }) => {
    const html = `<!DOCTYPE html><html><head></head><body>x</body></html>`;
    await mockFileContent(page, "HTMLs/x.html", {
      kind: "text",
      content: html,
    });

    await page.goto("/chat?view=files&path=HTMLs/x.html");
    const iframe = page.locator('iframe[title="HTML preview"]');
    await expect(iframe).toBeVisible();

    const srcdoc = await iframe.getAttribute("srcdoc");
    expect(srcdoc).toBeTruthy();
    expect(srcdoc).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'`,
    );
    expect(srcdoc).toContain(`https://cdn.jsdelivr.net`);
    expect(srcdoc).toContain(`connect-src 'none'`);
  });
});

test.describe("Files view — markdown image path rewrite", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("`![](images/foo.png)` renders as an `<img src=/api/files/raw?...>`", async ({
    page,
  }) => {
    const md = `# Page\n\n![chart](images/foo.png)\n`;
    await mockFileContent(page, "markdowns/sample.md", {
      kind: "text",
      content: md,
    });

    await page.goto("/chat?view=files&path=markdowns/sample.md");
    // Wait for the rendered markdown to surface a real <img>.
    await expect(page.locator("img[alt='chart']")).toBeVisible();
    const src = await page.locator("img[alt='chart']").getAttribute("src");
    // Exact shape varies a bit with encoding; just assert the API
    // route + the filename landed.
    expect(src).toContain("/api/files/raw");
    expect(src).toContain("foo.png");
  });

  test("`![](../../images/foo.png)` with relative-up prefix also resolves", async ({
    page,
  }) => {
    const md = `![two](../../images/two.png)`;
    await mockFileContent(page, "wiki/pages/a.md", {
      kind: "text",
      content: md,
    });

    await page.goto("/chat?view=files&path=wiki/pages/a.md");
    await expect(page.locator("img[alt='two']")).toBeVisible();
    const src = await page.locator("img[alt='two']").getAttribute("src");
    expect(src).toContain("/api/files/raw");
    expect(src).toContain("two.png");
    // Relative prefix stripped — workspace-rooted path expected.
    expect(src).not.toContain("..");
  });

  test("data: URIs and http URLs pass through untouched", async ({ page }) => {
    const md = `
![data](data:image/png;base64,AAA=)
![cdn](https://cdn.example.com/x.png)
`;
    await mockFileContent(page, "markdowns/pass.md", {
      kind: "text",
      content: md,
    });
    await page.goto("/chat?view=files&path=markdowns/pass.md");
    const dataSrc = await page.locator("img[alt='data']").getAttribute("src");
    expect(dataSrc).toBe("data:image/png;base64,AAA=");
    const cdnSrc = await page.locator("img[alt='cdn']").getAttribute("src");
    expect(cdnSrc).toBe("https://cdn.example.com/x.png");
  });
});
