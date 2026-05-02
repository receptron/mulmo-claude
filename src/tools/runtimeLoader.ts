// Runtime plugin loader — frontend half (#1043 C-2).
//
// At app boot, before `app.mount(...)`, ask the server which plugins
// the user has installed (`/api/plugins/runtime/list`), then dynamic-
// import each plugin's `dist/vue.js` and register the resulting
// `viewComponent` / `previewComponent` into a runtime overlay that
// `getPlugin()` consults.
//
// CSS handling: each plugin ships its own bundled `dist/style.css`
// (Tailwind utility classes the plugin author chose). We inject a
// `<link rel="stylesheet">` per plugin so canvas-rendered Views look
// the same as the build-time-bundled external plugins.
//
// Failures don't abort boot — a single broken plugin logs a warning
// and the rest of the app starts normally.

import { reactive } from "vue";
import type { Component } from "vue";
import type { ToolDefinition } from "gui-chat-protocol";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import type { PluginEntry } from "./types";

interface RuntimePluginListing {
  name: string;
  version: string;
  toolName: string;
  description: string;
  /** Absolute URL prefix; the dist files live under it. */
  assetBase: string;
}

interface ToolPluginExport {
  toolDefinition?: ToolDefinition;
  viewComponent?: Component;
  previewComponent?: Component;
}

interface PluginVueModule {
  plugin?: ToolPluginExport;
  default?: { plugin?: ToolPluginExport };
}

/** Tool name → PluginEntry. Reactive so callers reading via
 *  `getRuntimePluginEntry(name)` / `getRuntimeToolNames()` from a
 *  template, computed, or watch automatically re-evaluate when the
 *  loader populates the registry post-mount. Without this, a
 *  component that snapshots plugin names in `setup()` (RolesView,
 *  manageRoles/View, App.vue's tool-result render path) would never
 *  see workspace-installed plugins because the loader is fire-and-
 *  forget — by the time the list fetch resolves, those components
 *  have already cached their initial reads.
 *
 *  Vue 3's `reactive(new Map())` tracks `.get()`, `.has()`, and
 *  iteration (`.keys()`, `for…of`) so the call sites don't need to
 *  change shape — they just need to be inside a reactive context. */
const runtimeRegistry = reactive(new Map<string, PluginEntry>());

export function getRuntimePluginEntry(toolName: string): PluginEntry | null {
  return runtimeRegistry.get(toolName) ?? null;
}

export function getRuntimeToolNames(): string[] {
  return Array.from(runtimeRegistry.keys());
}

function injectStyle(href: string): void {
  // Skip if a previous boot already added it (HMR / re-mount).
  if (document.querySelector(`link[data-runtime-plugin-css="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.runtimePluginCss = href;
  document.head.appendChild(link);
}

async function loadOne(listing: RuntimePluginListing): Promise<void> {
  const moduleUrl = `${listing.assetBase}/dist/vue.js`;
  const cssUrl = `${listing.assetBase}/dist/style.css`;
  injectStyle(cssUrl);

  let mod: PluginVueModule;
  try {
    mod = (await import(/* @vite-ignore */ moduleUrl)) as PluginVueModule;
  } catch (err) {
    console.warn(`[runtime-plugin] dynamic import failed: ${listing.name}@${listing.version}`, err);
    return;
  }
  const plugin = mod.plugin ?? mod.default?.plugin;
  if (!plugin?.toolDefinition) {
    console.warn(`[runtime-plugin] plugin export missing toolDefinition: ${listing.name}`);
    return;
  }
  const entry: PluginEntry = {
    toolDefinition: plugin.toolDefinition,
    viewComponent: plugin.viewComponent,
    previewComponent: plugin.previewComponent,
  };
  runtimeRegistry.set(listing.toolName, entry);
}

/** Fetch the install list and dynamic-import each plugin in parallel.
 *  Resolves once every load attempt has settled (success or failure);
 *  the caller `awaits` it before mounting the app so the first render
 *  already sees the runtime tool names. */
export async function loadRuntimePlugins(): Promise<void> {
  const result = await apiGet<{ plugins: RuntimePluginListing[] }>(API_ROUTES.plugins.runtimeList);
  if (!result.ok) {
    console.warn(`[runtime-plugin] list fetch failed: ${result.error}`);
    return;
  }
  const listings = result.data.plugins;
  if (listings.length === 0) return;
  await Promise.allSettled(listings.map(loadOne));
}
