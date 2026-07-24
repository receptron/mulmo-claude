// E2E for the collection view's related-collections pulldown
// (plans/done/feat-collection-related-dropdown.md). The header trigger appears
// on the standalone page (this host binds `fetchOntology`); opening it
// lazily fetches the workspace ontology, derives the active collection's
// neighbors, and lists them — one click hops to the target's detail page.
// An unrelated collection falls back to the disabled empty-state row.
//
// Modeled on collection-ontology-map.spec.ts (same ontology fixtures) and
// collection-add-view-menu.spec.ts (same standalone header-menu harness).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const INVOICES = {
  collection: {
    slug: "invoices",
    title: "Invoices",
    icon: "receipt_long",
    source: "user",
    schema: {
      title: "Invoices",
      icon: "receipt_long",
      dataPath: "data/invoices/items",
      primaryKey: "invoiceId",
      fields: {
        invoiceId: { type: "string", label: "ID", primary: true },
        clientId: { type: "ref", label: "Client", to: "clients" },
      },
    },
  },
  items: [{ invoiceId: "inv-1", clientId: "acme" }],
};

const CLIENTS = {
  collection: {
    slug: "clients",
    title: "Clients",
    icon: "group",
    source: "user",
    schema: {
      title: "Clients",
      icon: "group",
      dataPath: "data/clients/items",
      primaryKey: "clientId",
      fields: {
        clientId: { type: "string", label: "ID", primary: true },
        name: { type: "string", label: "Name" },
      },
    },
  },
  items: [{ clientId: "acme", name: "Acme Co" }],
};

const NOTES = {
  collection: {
    slug: "notes",
    title: "Notes",
    icon: "sticky_note_2",
    source: "user",
    schema: {
      title: "Notes",
      icon: "sticky_note_2",
      dataPath: "data/notes/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true }, body: { type: "string", label: "Body" } },
    },
  },
  items: [{ id: "n1", body: "hello" }],
};

// invoices --ref--> clients, with clients declaring the backlinks reverse:
// the graph collapses the pair, so each side sees ONE bidirectional neighbor.
// notes stands alone (no relations) → the empty-state row.
const ONTOLOGY = {
  entries: [
    {
      slug: "clients",
      title: "Clients",
      icon: "group",
      primaryKey: "clientId",
      displayField: "name",
      recordCount: 1,
      relations: [{ field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "clientId" }],
    },
    {
      slug: "invoices",
      title: "Invoices",
      icon: "receipt_long",
      primaryKey: "invoiceId",
      displayField: "invoiceId",
      recordCount: 1,
      relations: [{ field: "clientId", kind: "ref", to: "clients" }],
    },
    { slug: "notes", title: "Notes", icon: "sticky_note_2", primaryKey: "id", displayField: "id", recordCount: 1, relations: [] },
  ],
};

async function setup(page: Page): Promise<void> {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/ontology",
    (route) => route.fulfill({ json: ONTOLOGY }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/invoices",
    (route) => route.fulfill({ json: INVOICES }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/clients",
    (route) => route.fulfill({ json: CLIENTS }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/notes",
    (route) => route.fulfill({ json: NOTES }),
  );
}

test.describe("collection related-collections pulldown", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("opens the menu, lists the related collection, and navigates on click", async ({ page }) => {
    await page.goto("/collections/invoices");

    const trigger = page.getByTestId("collections-related-menu");
    await expect(trigger).toBeVisible();

    await trigger.click();
    await expect(page.getByTestId("collections-related-menu-panel")).toBeVisible();

    const item = page.getByTestId("collections-related-item-clients");
    await expect(item).toBeVisible();
    await expect(item).toContainText("Clients");

    await item.click();
    await expect(page).toHaveURL(/\/collections\/clients$/);
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    // The menu closes on navigation.
    await expect(page.getByTestId("collections-related-menu-panel")).toHaveCount(0);
  });

  test("shows the empty-state row for a collection with no relations", async ({ page }) => {
    await page.goto("/collections/notes");

    await page.getByTestId("collections-related-menu").click();
    await expect(page.getByTestId("collections-related-empty")).toBeVisible();
    await expect(page.getByTestId("collections-related-item-invoices")).toHaveCount(0);
  });
});
