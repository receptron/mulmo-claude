// E2E for the /collections Map tab (phase 2 of
// plans/done/collection-ontology.md step ①, plan
// plans/done/feat-collection-ontology-graph.md): the tab renders the
// workspace-ontology graph canvas from the /api/collections/ontology
// entries, and shows the dedicated empty state when there is nothing
// to map. The graph itself is an ECharts canvas, so assertions stay at
// the container level (canvas presence, not pixel content).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const COLLECTIONS_LIST = {
  collections: [
    { slug: "clients", title: "Clients", icon: "group", source: "user" },
    { slug: "invoices", title: "Invoices", icon: "receipt_long", source: "user" },
  ],
};

const ONTOLOGY = {
  entries: [
    {
      slug: "clients",
      title: "Clients",
      icon: "group",
      primaryKey: "clientId",
      displayField: "name",
      recordCount: 3,
      relations: [{ field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "clientId" }],
    },
    {
      slug: "invoices",
      title: "Invoices",
      icon: "receipt_long",
      primaryKey: "invoiceId",
      displayField: "invoiceId",
      recordCount: 7,
      relations: [{ field: "clientId", kind: "ref", to: "clients" }],
    },
  ],
};

async function mockCollections(page: Page, entries: object): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections",
    (route) => route.fulfill({ json: COLLECTIONS_LIST }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/ontology",
    (route) => route.fulfill({ json: entries }),
  );
}

test.describe("collections Map tab", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("renders the ontology graph canvas for ref-linked collections", async ({ page }) => {
    await mockCollections(page, ONTOLOGY);
    await page.goto("/collections");

    await expect(page.getByTestId("collections-tab-map")).toBeVisible();
    await page.getByTestId("collections-tab-map").click();

    await expect(page.getByTestId("collections-map-canvas")).toBeVisible();
    // ECharts mounted an actual canvas inside the container.
    await expect(page.getByTestId("collections-map-canvas").locator("canvas")).toHaveCount(1);
    // The Installed grid is replaced, not stacked under the map.
    await expect(page.getByTestId("collections-index-card-clients")).toBeHidden();
  });

  test("shows the empty state when the workspace has no collections", async ({ page }) => {
    await mockCollections(page, { entries: [] });
    await page.goto("/collections");

    await page.getByTestId("collections-tab-map").click();

    await expect(page.getByTestId("collections-map-empty")).toBeVisible();
    await expect(page.getByTestId("collections-map-canvas")).toHaveCount(0);
  });
});
