// E2E for #895 PR A — markdown frontmatter handling in the
// FileContentRenderer. The user-visible contract: a markdown file
// with `---\n...\n---` frontmatter renders the body without the
// raw `---` fences and surfaces the YAML keys in a properties
// panel above the rendered body.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { API_ROUTES } from "../../src/config/apiRoutes";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const FRONTMATTER_FILE = {
  path: "wiki/with-frontmatter.md",
  content: [
    "---",
    "title: Sample Doc",
    "tags: [demo, frontmatter]",
    "created: 2026-04-27",
    "---",
    "",
    "# Body Heading",
    "",
    "This is the body, not the frontmatter.",
    "",
  ].join("\n"),
};

async function mockMarkdownFile(page: Page) {
  await page.route(
    (url) => url.pathname === API_ROUTES.files.dir,
    (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      if (path === "") {
        return route.fulfill({
          json: {
            name: "",
            path: "",
            type: "dir",
            children: [{ name: "wiki", path: "wiki", type: "dir" }],
          },
        });
      }
      if (path === "wiki") {
        return route.fulfill({
          json: {
            name: "wiki",
            path: "wiki",
            type: "dir",
            children: [
              {
                name: "with-frontmatter.md",
                path: FRONTMATTER_FILE.path,
                type: "file",
                size: FRONTMATTER_FILE.content.length,
              },
            ],
          },
        });
      }
      return route.fulfill({ json: { name: path, path, type: "dir", children: [] } });
    },
  );

  await page.route(
    (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === FRONTMATTER_FILE.path,
    (route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: FRONTMATTER_FILE.path,
          content: FRONTMATTER_FILE.content,
          size: FRONTMATTER_FILE.content.length,
          modifiedMs: Date.now(),
        },
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
  await mockMarkdownFile(page);
});

test.describe("FileContentRenderer — frontmatter (#895 PR A)", () => {
  test("renders a frontmatter properties panel + body without `---` fences", async ({ page }) => {
    await page.goto(`/files/${FRONTMATTER_FILE.path}`);

    // Body content is visible (the H1 rendered by marked).
    await expect(page.getByText("Body Heading")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Properties panel surfaces every YAML key as `<key>:` text.
    // The panel sits above the rendered body in FileContentRenderer's
    // markdown branch — see src/components/FileContentRenderer.vue:29.
    await expect(page.getByText("title:", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sample Doc", { exact: true })).toBeVisible();
    await expect(page.getByText("tags:", { exact: true })).toBeVisible();
    await expect(page.getByText("created:", { exact: true })).toBeVisible();
    await expect(page.getByText("2026-04-27", { exact: true })).toBeVisible();

    // Tags render as chips (one chip per array entry). The chips are
    // the spans inside the `tags` row, so they share `bg-white`.
    await expect(page.getByText("demo", { exact: true })).toBeVisible();
    await expect(page.getByText("frontmatter", { exact: true })).toBeVisible();

    // Nested object values must NOT render as `[object Object]` —
    // `formatScalarField` JSON-stringifies them (codex iter-2 #902).
    // The fixture doesn't include nested objects directly, so we
    // assert the absence of the placeholder string here as a
    // regression guard for future fixtures.
    expect(await page.locator("body").innerText()).not.toContain("[object Object]");

    // The raw `---` fence must NOT appear as text in the rendered
    // body. (marked turns a stray `---` line into an `<hr>` element,
    // and the `title: Sample Doc` line would render as plain text
    // — both are pre-#895 regressions we want to lock out.)
    const renderedBody = page.locator(".min-h-0").last();
    await expect(renderedBody).toBeVisible();
    // `title: Sample Doc` should NOT appear in the rendered body
    // text (it's only in the properties panel above). Match the
    // body container specifically so the panel's own copy doesn't
    // count.
    const bodyText = await renderedBody.innerText();
    expect(bodyText).not.toContain("title: Sample Doc");
    expect(bodyText).not.toMatch(/^---$/m);
  });

  test("a header-less markdown file renders without a properties panel (no regression)", async ({ page }) => {
    // Override the file content for a header-less .md to confirm the
    // pre-frontmatter behaviour still works. The properties panel is
    // suppressed when `fields.length === 0` (no `<div v-if=...>`),
    // so we assert the absence of any `field-key:` text and that the
    // body still renders.
    await page.unrouteAll();
    await mockAllApis(page);
    await page.route(
      (url) => url.pathname === API_ROUTES.files.dir,
      (route) => {
        const path = new URL(route.request().url()).searchParams.get("path") ?? "";
        if (path === "") {
          return route.fulfill({
            json: {
              name: "",
              path: "",
              type: "dir",
              children: [{ name: "wiki", path: "wiki", type: "dir" }],
            },
          });
        }
        if (path === "wiki") {
          return route.fulfill({
            json: {
              name: "wiki",
              path: "wiki",
              type: "dir",
              children: [{ name: "plain.md", path: "wiki/plain.md", type: "file", size: 18 }],
            },
          });
        }
        return route.fulfill({ json: { name: path, path, type: "dir", children: [] } });
      },
    );
    await page.route(
      (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === "wiki/plain.md",
      (route) =>
        route.fulfill({
          json: { kind: "text", path: "wiki/plain.md", content: "# Plain\n\nNo frontmatter here.\n", size: 28, modifiedMs: Date.now() },
        }),
    );

    await page.goto("/files/wiki/plain.md");
    await expect(page.getByText("No frontmatter here.")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    // Properties panel must be absent — the `created:` / `title:`
    // labels would only exist if the panel rendered.
    await expect(page.getByText("created:", { exact: true })).toHaveCount(0);
    await expect(page.getByText("title:", { exact: true })).toHaveCount(0);
  });
});
