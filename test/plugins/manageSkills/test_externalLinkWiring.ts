// Regression guard for #2493: the rendered-markdown bodies of the
// manageSkills plugin must route clicks through
// `handleExternalLinkClick`, or external links in a skill body silently
// stop opening (#2471).
//
// The binding was nearly lost for good when #2472 extracted the catalog
// detail pane into its own SFC — "keep my side" of that conflict would
// have dropped the `@click`, and CI would have stayed green because
// nothing asserted it. So: assert the handler sits on the SAME element
// as `v-html`, via the template AST (see `test/helpers/vueTemplateProbe.ts`
// for why a source grep can't tell that apart from the handler drifting
// onto a wrapper element).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findVHtmlBindings, type VHtmlBinding } from "../../helpers/vueTemplateProbe.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXTERNAL_LINK_HANDLER = "handleExternalLinkClick";
const EXTERNAL_LINK_MODULE = "@mulmoclaude/markdown-utils/dom/externalLink";

const CATALOG_DETAIL_PANE = path.join("src", "plugins", "manageSkills", "CatalogDetailPane.vue");
const MANAGE_SKILLS_VIEW = path.join("src", "plugins", "manageSkills", "View.vue");

// A component could satisfy the AST check below with a same-named local
// stub, so the import is pinned too — the handler has to be the shared one.
const SHARED_IMPORT = new RegExp(`import\\s*\\{[^}]*\\b${EXTERNAL_LINK_HANDLER}\\b[^}]*\\}\\s*from\\s*["']${EXTERNAL_LINK_MODULE}["']`);

const readComponent = (relativePath: string): string => readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");

// Every markdown body these components render carries links, so the
// invariant is "no `v-html` element here without the external-link
// handler ON THAT ELEMENT" — not "the handler appears somewhere".
const markdownBodiesMissingHandler = (relativePath: string): VHtmlBinding[] =>
  findVHtmlBindings(readComponent(relativePath)).filter((binding) => !binding.clickHandlers.some((handler) => handler.includes(EXTERNAL_LINK_HANDLER)));

const markdownBodyCount = (relativePath: string): number => findVHtmlBindings(readComponent(relativePath)).length;

const wiringMessage = (relativePath: string): string =>
  `${relativePath}: every v-html markdown body must carry @click="${EXTERNAL_LINK_HANDLER}" on the SAME element (#2471 / #2493)`;

const movedMessage = (relativePath: string): string =>
  `${relativePath} no longer renders a v-html markdown body — re-point this guard at wherever the body moved`;

describe("manageSkills catalog detail pane — external link wiring", () => {
  it("binds handleExternalLinkClick on the v-html markdown body element", () => {
    assert.ok(markdownBodyCount(CATALOG_DETAIL_PANE) > 0, movedMessage(CATALOG_DETAIL_PANE));
    assert.deepEqual(markdownBodiesMissingHandler(CATALOG_DETAIL_PANE), [], wiringMessage(CATALOG_DETAIL_PANE));
  });

  it("imports the shared handler from markdown-utils", () => {
    assert.match(readComponent(CATALOG_DETAIL_PANE), SHARED_IMPORT, `${CATALOG_DETAIL_PANE} must import ${EXTERNAL_LINK_HANDLER} from ${EXTERNAL_LINK_MODULE}`);
  });
});

describe("manageSkills active skill body — external link wiring", () => {
  it("binds handleExternalLinkClick on the v-html markdown body element", () => {
    assert.ok(markdownBodyCount(MANAGE_SKILLS_VIEW) > 0, movedMessage(MANAGE_SKILLS_VIEW));
    assert.deepEqual(markdownBodiesMissingHandler(MANAGE_SKILLS_VIEW), [], wiringMessage(MANAGE_SKILLS_VIEW));
  });

  it("imports the shared handler from markdown-utils", () => {
    assert.match(readComponent(MANAGE_SKILLS_VIEW), SHARED_IMPORT, `${MANAGE_SKILLS_VIEW} must import ${EXTERNAL_LINK_HANDLER} from ${EXTERNAL_LINK_MODULE}`);
  });
});
