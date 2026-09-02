// The chat modal's `options` slot, and the one rule that makes it correct: it is forwarded on the
// STANDALONE path only.
//
// A host that starts these chats as one of several agents (MulmoTerminal) needs to say which one
// is about to start, at the moment the button is pressed — the modal covers the whole page, so
// anything the host draws behind it is not on screen. But with `sendTextMessage` set the modal is
// inside a chat card and `submitChat` sends into the session already running, so no new chat is
// started and such a control would change nothing.
//
// The repo has no Vue component unit-test infrastructure (e2e/ covers that surface), so this
// parses the sources — the same lightweight guard test_stackview_googlemap_wiring.ts uses. A
// restructure that drops the slot, or drops the gate, trips here ahead of the e2e run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN = "packages/plugins/collection-plugin/src/vue/components";

const readSource = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf-8");

test("CollectionChatModal exposes an `options` slot in its footer", () => {
  const src = readSource(`${PLUGIN}/CollectionChatModal.vue`);
  assert.match(src, /<slot\s+name="options"\s*\/>/, 'CollectionChatModal must render `<slot name="options" />` for host controls');
  const footer = src.slice(src.indexOf("<footer"), src.indexOf("</footer>"));
  assert.ok(footer.includes('<slot name="options" />'), "the slot belongs in the FOOTER, beside the buttons it qualifies — not in the header or the body");
});

test("CollectionView forwards `chat-modal-options` into the modal", () => {
  const src = readSource(`${PLUGIN}/CollectionView.vue`);
  assert.match(
    src,
    /#options><slot name="chat-modal-options" \/><\/template>/,
    "CollectionView must pass its own `chat-modal-options` slot through to the modal's `options` slot",
  );
});

test("CollectionView withholds the slot on the embedded path", () => {
  const src = readSource(`${PLUGIN}/CollectionView.vue`);
  // The gate and the slot must be on the SAME template element: a `v-if` that drifted onto
  // another node would leave the control showing inside a chat card, where pressing it changes
  // nothing (useCollectionChat's dispatchSeed takes the `sendTextMessage` branch).
  assert.match(
    src,
    /<template\s+v-if="!sendTextMessage"\s+#options>/,
    'the `#options` template must carry v-if="!sendTextMessage" — embedded chats send into the current session, so a "which chat starts" control does not apply there',
  );
});
