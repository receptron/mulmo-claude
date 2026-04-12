import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index";
import { installGuards } from "./router/guards";
import "./index.css";
import "material-icons/iconfont/material-icons.css";

import.meta.glob(
  [
    "../node_modules/@gui-chat-plugin/*/dist/style.css",
    "../node_modules/@mulmochat-plugin/*/dist/style.css",
  ],
  { eager: true },
);

installGuards(router);

const app = createApp(App);
app.use(router);
app.mount("#app");
