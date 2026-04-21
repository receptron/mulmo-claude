import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index";
import { installGuards } from "./router/guards";
import { setAuthToken } from "./utils/api";
import { readAuthTokenFromMeta } from "./utils/dom/authTokenMeta";
import "./index.css";
import "material-icons/iconfont/material-icons.css";

import.meta.glob(["../node_modules/@gui-chat-plugin/*/dist/style.css", "../node_modules/@mulmochat-plugin/*/dist/style.css"], { eager: true });

// Bearer auth bootstrap (#272). The server embeds the per-startup
// token into `<meta name="mulmoclaude-auth" content="...">` when it
// serves index.html. Reading it here and handing to setAuthToken()
// wires every subsequent apiFetch / apiGet / ... to attach an
// `Authorization: Bearer ...` header. A missing or empty token means
// requests will 401 — that's the intended dev-time signal when the
// server isn't running.
setAuthToken(readAuthTokenFromMeta());

installGuards(router);

const app = createApp(App);
app.use(router);
app.mount("#app");
