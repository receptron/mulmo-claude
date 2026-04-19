// E2E for the manageSkills plugin — list rendering + Run button
// dispatch. The server's /api/skills endpoint is mocked via
// page.route so tests run without a real ~/.claude/skills/ tree.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

async function setupSkillsSession(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: "skills-session",
        title: "Skills Session",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  // Session transcript with a manageSkills tool_result so the View
  // is reachable by clicking the sidebar entry.
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/sessions/") &&
      url.pathname !== "/api/sessions",
    (route) => {
      return route.fulfill({
        json: [
          {
            type: "session_meta",
            roleId: "general",
            sessionId: "skills-session",
          },
          { type: "text", source: "user", message: "Show my skills" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "skills-result-1",
              toolName: "manageSkills",
              title: "Skills",
              message: "Found 2 skills.",
              data: {
                skills: [
                  {
                    name: "ci_enable",
                    description: "Enable CI for a repository",
                    source: "user",
                  },
                  {
                    name: "publish",
                    description: "Publish an npm package",
                    source: "user",
                  },
                ],
              },
            },
          },
        ],
      });
    },
  );

  // List endpoint used by the plugin execute() — same shape the
  // transcript already has, but the View reads detail from the
  // per-name endpoint below.
  await page.route(urlEndsWith("/api/skills"), (route) =>
    route.fulfill({
      json: {
        skills: [
          {
            name: "ci_enable",
            description: "Enable CI for a repository",
            source: "user",
          },
          {
            name: "publish",
            description: "Publish an npm package",
            source: "user",
          },
        ],
      },
    }),
  );

  // Detail endpoint. Return a different body per name so we can
  // assert the Run message reflects the selected skill.
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/skills/") && url.pathname !== "/api/skills",
    (route: Route) => {
      const name = route.request().url().split("/api/skills/").pop() ?? "";
      const bodies: Record<string, string> = {
        ci_enable: "## CI Enable\n\n1. Add workflow\n2. Open PR",
        publish: "## Publish\n\n1. Bump version\n2. yarn publish",
      };
      const body = bodies[decodeURIComponent(name)];
      if (!body) {
        return route.fulfill({
          status: 404,
          json: { error: `skill not found: ${name}` },
        });
      }
      return route.fulfill({
        json: {
          skill: {
            name: decodeURIComponent(name),
            description: name === "ci_enable" ? "Enable CI" : "Publish",
            body,
            source: "user",
            path: `/fake/${name}/SKILL.md`,
          },
        },
      });
    },
  );
}

test.describe("manageSkills plugin", () => {
  test.beforeEach(async ({ page }) => {
    await setupSkillsSession(page);
  });

  test("sidebar preview renders the skill list count", async ({ page }) => {
    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // Preview renders "2 skills" somewhere in the sidebar.
    await expect(page.getByText("2 skills").first()).toBeVisible();
  });

  test("View renders the full skill list when selected", async ({ page }) => {
    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Click the tool-result preview in the sidebar to open the View.
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-ci_enable")).toBeVisible();

    // Both skills appear in the list pane (data-testid per item).
    await expect(page.getByTestId("skill-item-publish")).toBeVisible();
  });

  test("selecting a skill loads its detail body from the API", async ({
    page,
  }) => {
    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-ci_enable")).toBeVisible();

    // The first skill is auto-selected; its body should be visible.
    await expect(page.getByTestId("skill-body-rendered")).toContainText(
      "CI Enable",
    );

    // Click the second skill → body swaps.
    await page.getByTestId("skill-item-publish").click();
    await expect(page.getByTestId("skill-body-rendered")).toContainText(
      "Publish",
    );
  });

  test("skill body is rendered as formatted HTML, not raw markdown", async ({
    page,
  }) => {
    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-ci_enable")).toBeVisible();

    const rendered = page.getByTestId("skill-body-rendered");
    await expect(rendered).toBeVisible();
    // The `## CI Enable` heading should render as an <h2>, and the
    // ordered list items as <li>. Raw `##` or `1.` shouldn't appear.
    await expect(rendered.locator("h2")).toContainText("CI Enable");
    await expect(rendered.locator("li").first()).toContainText("Add workflow");
  });

  test("Run button sends the skill invocation as a slash command", async ({
    page,
  }) => {
    // Capture the body of the agent POST so we can assert what
    // sendMessage forwarded. Registered AFTER mockAllApis so this
    // route wins (Playwright matches last-registered first).
    const agentPosts: Array<Record<string, unknown>> = [];
    await page.route(urlEndsWith("/api/agent"), async (route: Route) => {
      if (route.request().method() === "POST") {
        agentPosts.push(route.request().postDataJSON());
        return route.fulfill({
          status: 202,
          json: { chatSessionId: "skills-session" },
        });
      }
      return route.fallback();
    });

    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-ci_enable")).toBeVisible();

    // Wait for the detail endpoint to resolve before clicking Run.
    await expect(page.getByTestId("skill-body-rendered")).toContainText(
      "CI Enable",
    );
    await page.getByTestId("skill-run-btn").click();

    // Run button routes through App.vue's sendMessage via the
    // useAppApi() provide/inject contract (#227). The slash command
    // form (`/<name>`) is what Claude CLI resolves against
    // ~/.claude/skills/ natively, so we don't need to ship the body.
    await expect
      .poll(() => agentPosts.length, { timeout: 5000 })
      .toBeGreaterThan(0);
    expect(agentPosts[0]?.message).toBe("/ci_enable");
  });
});

// ---- Delete (phase 1) ----------------------------------------------

async function setupSkillsWithProjectScope(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: "skills-session",
        title: "Skills Session",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await page.route(
    (url) =>
      url.pathname.startsWith("/api/sessions/") &&
      url.pathname !== "/api/sessions",
    (route) => {
      return route.fulfill({
        json: [
          {
            type: "session_meta",
            roleId: "general",
            sessionId: "skills-session",
          },
          { type: "text", source: "user", message: "Show my skills" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "skills-result-1",
              toolName: "manageSkills",
              title: "Skills",
              message: "Found 2 skills.",
              data: {
                skills: [
                  {
                    name: "user-only",
                    description: "Read-only user skill",
                    source: "user",
                  },
                  {
                    name: "my-project-skill",
                    description: "Captured from a chat",
                    source: "project",
                  },
                ],
              },
            },
          },
        ],
      });
    },
  );

  await page.route(
    (url) =>
      url.pathname.startsWith("/api/skills/") && url.pathname !== "/api/skills",
    (route: Route) => {
      const method = route.request().method();
      const name =
        decodeURIComponent(
          route.request().url().split("/api/skills/").pop() ?? "",
        ).split("?")[0] ?? "";
      if (method === "DELETE") {
        // Stubbed delete response — phase 1 server returns
        // { deleted: true, name } on success.
        return route.fulfill({ json: { deleted: true, name } });
      }
      const sources: Record<string, "user" | "project"> = {
        "user-only": "user",
        "my-project-skill": "project",
      };
      const source = sources[name];
      if (!source) {
        return route.fulfill({
          status: 404,
          json: { error: `skill not found: ${name}` },
        });
      }
      return route.fulfill({
        json: {
          skill: {
            name,
            description:
              source === "user"
                ? "Read-only user skill"
                : "Captured from a chat",
            body: `## ${name}\n\nbody`,
            source,
            path: `/fake/${name}/SKILL.md`,
          },
        },
      });
    },
  );
}

test.describe("manageSkills plugin — delete (phase 1)", () => {
  test.beforeEach(async ({ page }) => {
    await setupSkillsWithProjectScope(page);
  });

  test("Delete button is hidden for user-scope skills", async ({ page }) => {
    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-user-only")).toBeVisible();

    // First skill (user-only) is auto-selected on mount; Delete
    // button should not appear.
    await page.getByTestId("skill-item-user-only").click();
    await expect(page.getByTestId("skill-body-rendered")).toContainText(
      "user-only",
    );
    await expect(page.getByTestId("skill-delete-btn")).toHaveCount(0);
  });

  test("Delete button is visible for project-scope skills", async ({
    page,
  }) => {
    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-user-only")).toBeVisible();

    await page.getByTestId("skill-item-my-project-skill").click();
    await expect(page.getByTestId("skill-body-rendered")).toContainText(
      "my-project-skill",
    );
    await expect(page.getByTestId("skill-delete-btn")).toBeVisible();
  });

  test("clicking Delete fires DELETE /api/skills/:name and removes the row", async ({
    page,
  }) => {
    // Auto-accept the native confirm() dialog the View shows.
    page.on("dialog", (d) => d.accept());

    let deletedName: string | null = null;
    await page.route(
      (url) =>
        url.pathname.startsWith("/api/skills/") &&
        url.pathname !== "/api/skills",
      (route: Route) => {
        if (route.request().method() === "DELETE") {
          const name =
            decodeURIComponent(
              route.request().url().split("/api/skills/").pop() ?? "",
            ).split("?")[0] ?? "";
          deletedName = name;
          return route.fulfill({ json: { deleted: true, name } });
        }
        return route.fallback();
      },
    );

    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-user-only")).toBeVisible();

    await page.getByTestId("skill-item-my-project-skill").click();
    await expect(page.getByTestId("skill-delete-btn")).toBeVisible();

    await page.getByTestId("skill-delete-btn").click();

    // The DELETE call landed with the right name.
    await expect.poll(() => deletedName).toBe("my-project-skill");

    // Row is removed from the left list — only the user skill remains.
    await expect(page.getByTestId("skill-item-my-project-skill")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("skill-item-user-only")).toBeVisible();
  });

  test("Edit button opens edit mode, saves changes, and returns to view mode", async ({
    page,
  }) => {
    // Mock PUT /api/skills/my-project-skill to return success.
    await page.route(
      (url) => url.pathname === "/api/skills/my-project-skill",
      (route: Route) => {
        if (route.request().method() === "PUT") {
          return route.fulfill({
            json: { updated: true, path: "/fake/path" },
          });
        }
        return route.fallback();
      },
    );

    await page.goto("/chat/skills-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("2 skills").first().click();
    await expect(page.getByTestId("skill-item-user-only")).toBeVisible();

    // Select the project-scope skill — Edit button should be visible.
    await page.getByTestId("skill-item-my-project-skill").click();
    await expect(page.getByTestId("skill-body-rendered")).toContainText(
      "my-project-skill",
    );
    await expect(page.getByTestId("skill-edit-btn")).toBeVisible();

    // Click Edit → description input + body textarea should appear.
    await page.getByTestId("skill-edit-btn").click();
    await expect(page.getByTestId("skill-edit-description")).toBeVisible();
    await expect(page.getByTestId("skill-edit-body")).toBeVisible();

    // Edit the description.
    await page.getByTestId("skill-edit-description").fill("Updated desc");

    // Click Save.
    await page.getByTestId("skill-save-btn").click();

    // After save: edit mode should close, rendered body should show.
    await expect(page.getByTestId("skill-body-rendered")).toBeVisible();
    await expect(page.getByTestId("skill-edit-description")).toHaveCount(0);
  });
});
