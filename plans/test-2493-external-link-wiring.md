# test: guard the manageSkills external-link click wiring

Closes #2493.

## Problem

#2471 fixed "external links don't work in the catalog detail pane" by adding
`@click="handleExternalLinkClick"` to the markdown `v-html` div. #2472 then
extracted that DOM region into `src/plugins/manageSkills/CatalogDetailPane.vue`;
resolving the conflict the natural way ("keep mine") would have silently
reverted the fix, and **no test would have gone red**. The active-skill body in
`src/plugins/manageSkills/View.vue` carries the same binding and the same
exposure.

Coverage today:

| Layer                                                          | Covered? |
| -------------------------------------------------------------- | -------- |
| `isCrossOriginHttpUrl` (pure predicate)                         | yes — `test/utils/dom/test_externalLink.ts` |
| `handleExternalLinkClick` (DOM wrapper: preventDefault + open)  | **no**   |
| Handler attached to the `v-html` element in the two SFCs        | **no**   |

## Plan

1. **Pure layer** — extend `test/utils/dom/test_externalLink.ts` with a
   `handleExternalLinkClick` block driven by real jsdom DOM + dispatched
   `MouseEvent`s (`window.open` stubbed, jsdom URL pinned so `location.origin`
   is deterministic). Cases: external anchor, nested element inside an external
   anchor, same-origin anchor, hash anchor, relative href, `mailto:`, click on a
   non-anchor node, modifier-key clicks (ctrl / meta / shift), middle-click.
2. **Wiring layer** — `test/helpers/vueTemplateProbe.ts`: parse the SFC with the
   real Vue compiler (`vue/compiler-sfc`) and return, for every element that
   carries `v-html`, the `v-on:click` expressions **on that same element**. A
   substring grep would pass when the binding drifts onto a parent / sibling;
   walking the template AST cannot.
3. `test/plugins/manageSkills/test_externalLinkWiring.ts`: negative-control
   fixtures pinning the probe's discrimination (binding on parent / sibling /
   second v-html element / renamed handler), then the real assertions over
   `CatalogDetailPane.vue` and `View.vue` — plus the `@mulmoclaude/markdown-utils/dom/externalLink`
   import, so a same-named local stub can't satisfy the check.

## Mutation verification (the point of the issue)

Each test must be shown red with the code it guards broken, then restored:

- remove `@click` from `CatalogDetailPane.vue` → catalog wiring test red
- remove `@click` from `View.vue` → active-body wiring test red
- drop `event.preventDefault()` / `window.open` from the handler → pure tests red
  (rebuild `@mulmoclaude/markdown-utils` first — root tests import the package
  name, which resolves to `dist/`, not `src/`)

## Verification

`yarn format && yarn lint && yarn typecheck && yarn build`, plus the
manageSkills + markdown-utils test files. No version bumps.
