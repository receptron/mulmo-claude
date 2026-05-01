import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index";
import { installGuards } from "./router/guards";
import i18n from "./lib/vue-i18n";
import { setAuthToken } from "./utils/api";
import { readAuthTokenFromMeta } from "./utils/dom/authTokenMeta";
import { loadRuntimePlugins } from "./tools/runtimeLoader";
import "./index.css";
import "material-icons/iconfont/material-icons.css";
import "material-symbols/outlined.css";

import.meta.glob(["../node_modules/@gui-chat-plugin/*/dist/style.css", "../node_modules/@mulmochat-plugin/*/dist/style.css"], { eager: true });

// Bearer auth bootstrap (#272). The server embeds the per-startup
// token into `<meta name="mulmoclaude-auth" content="...">` when it
// serves index.html. Reading it here and handing to setAuthToken()
// wires every subsequent apiFetch / apiGet / ... to attach an
// `Authorization: Bearer ...` header. A missing or empty token means
// requests will 401 — that's the intended dev-time signal when the
// server isn't running.
setAuthToken(readAuthTokenFromMeta());

// Runtime-loaded plugins (#1043 C-2). Fire-and-forget: kick off the
// list fetch + dynamic imports immediately but do NOT block mount.
// Static plugins are bundled and ready synchronously; runtime
// plugins fill in over the next ~100ms while the app is rendering
// its first paint. By the time the LLM actually calls a runtime
// tool (which requires at least one user message round-trip), the
// registry is fully populated.
//
// Awaiting here would delay first paint even when there are no
// runtime plugins installed (every workspace today), and it shifted
// the timing of `page.goto("/chat")` enough to break the
// today-journal-button E2E spec, which captured the URL before
// app mount completed.
loadRuntimePlugins().catch((err: unknown) => {
  console.warn("[runtime-plugin] boot loader threw", err);
});

installGuards(router);

const app = createApp(App);
app.use(router);
app.use(i18n);
app.mount("#app");
