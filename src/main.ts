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

// Runtime-loaded plugins (#1043 C-2). Fetch the install list and
// dynamic-import each plugin's Vue chunk before mount, so the first
// render already sees the workspace-installed tool names. Failures
// log a warning but never block boot — broken plugins are skipped.
await loadRuntimePlugins();

installGuards(router);

const app = createApp(App);
app.use(router);
app.use(i18n);
app.mount("#app");
