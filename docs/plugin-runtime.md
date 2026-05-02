# Runtime plugins

Workspace-installed and repo-shipped GUI chat plugins that load at server boot without being part of the build-time bundle. Tracks issue [#1043](https://github.com/receptron/mulmoclaude/issues/1043) C-2.

A runtime plugin is a published npm package that exports a `gui-chat-protocol` `ToolPlugin`: an MCP `TOOL_DEFINITION`, a server-side `execute()` handler, and Vue components (`viewComponent` for the canvas, `previewComponent` for the message preview). The plugin's tarball lives in the workspace (or under `node_modules/` for presets); the boot loader extracts and registers it with the runtime registry, then the frontend dynamic-imports the View when the LLM calls the tool.

There are **two sources** of runtime plugins, both feeding the same registry:

| Source             | Where it lives                                                                                                                                                                                     | Who controls it  | Use case                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| **Preset**         | `node_modules/<pkg>/`, listed in [`server/plugins/preset-list.ts`](../server/plugins/preset-list.ts) (kept under `server/` so it's available at runtime in Docker, where `config/` is not mounted) | repo / committer | First-launch UX. Plugins that ship with mulmoclaude.   |
| **User-installed** | `~/mulmoclaude/plugins/<pkg>.tgz`, listed in `~/mulmoclaude/plugins/plugins.json`                                                                                                                  | end user         | Per-workspace extensions the user installs themselves. |

`PRESET_PLUGINS` is currently empty — the framework is in place but no preset ships by default. Past attempts to preset `@gui-chat-plugin/weather` produced "name collides with already-loaded runtime plugin" warnings on every boot for users who had also installed it via the workspace ledger; until that double-source state is handled cleanly, presets stay empty and `@gui-chat-plugin/weather` is just one of the packages a user can install themselves.

On tool-name collision the preset wins (loaded first). Static built-in MCP tools win over both.

## User scenarios

### Scenario 1: user installs a plugin (walkthrough with `@gui-chat-plugin/weather`)

[`@gui-chat-plugin/weather`](https://www.npmjs.com/package/@gui-chat-plugin/weather) is a good first plugin to install — it exports `fetchWeather` (Japan Meteorological Agency, free public API, no key required) and ships both the server-side handler and a Vue View, so it exercises the whole runtime pipeline (MCP dispatch + canvas render).

Phase D (the `yarn plugin:install` CLI) is not yet shipped. Until then, the install path is manual:

```bash
mkdir -p ~/mulmoclaude/plugins
cd "$(mktemp -d)" && npm pack @gui-chat-plugin/weather
mv gui-chat-plugin-weather-*.tgz ~/mulmoclaude/plugins/

# Append an entry to ~/mulmoclaude/plugins/plugins.json
# (create the file with `[]` first if it doesn't exist):
#   [
#     {
#       "name": "@gui-chat-plugin/weather",
#       "version": "0.1.0",
#       "tgz": "gui-chat-plugin-weather-0.1.0.tgz",
#       "installedAt": "2026-05-02T00:00:00.000Z"
#     }
#   ]
```

Restart the server. Boot log:

```
[plugins/runtime] loaded requested=1 succeeded=1
[plugins/runtime] registered runtime plugins presets=0 userInstalled=1 registered=1 collisions=0
```

Then in the browser:

1. Open a chat session at [http://localhost:5173](http://localhost:5173).
2. Send "東京の天気おしえて".
3. The LLM calls `fetchWeather`; the canvas renders the weather View (⛅ + Tailwind styling) with the JMA forecast for Tokyo.

Substitute any other `gui-chat-protocol`-shaped package the same way — the steps above are not weather-specific.

### Scenario 2: mix preset + user-installed

Both sources merge into the same registry. The user-installed plugin sees presets and vice versa; on collision the preset wins. (Currently no presets ship — see the table above — so the practical layout is "user-installed only".)

### Scenario 3: collisions

There are three flavours of collision and the behaviour differs by source:

1. **Runtime plugin name collides with a manifest-listed GUI plugin or a pure MCP tool** (everything fed into `MCP_PLUGIN_NAMES` plus `mcpToolDefs` keys: `notify`, `readXPost`, `searchX`, plus the manifest entries in [`config/plugins.registry.ts`](../config/plugins.registry.ts)). The runtime loader **rejects** the entry at registration time. The boot log records this:

   ```
   [plugins/registry] skipping runtime plugin — name collides with static tool plugin=@x/notify-clone tool=notify
   ```

2. **Runtime plugin name collides with a build-time-bundled GUI plugin that is NOT in the manifest** (the legacy entries in [`src/tools/index.ts`](../src/tools/index.ts) under keys like `"text-response"`, `manageScheduler`, etc. that aren't agent-callable). The runtime loader does NOT see these names; it accepts the runtime entry. The frontend's `getPlugin(name)` lookup checks the static map first, so the build-time entry shadows the runtime one for rendering. The runtime entry is still listed by `getAllPluginNames()` and visible to MCP, so this state is best avoided — use a different `TOOL_DEFINITION.name` for runtime plugins.

3. **Runtime-vs-runtime collision** (preset and user-installed both register the same `TOOL_DEFINITION.name`, or two user-installed plugins do). First-loaded wins; presets are loaded before user-installed, so a preset always wins. The skipped entry is logged with `reason=runtime`.

Future work (out of scope for this PR): reject case 2 at registration time too, by feeding the static-map keys into `MCP_PLUGIN_NAMES`-equivalent collision sets server-side.

## Test scenarios

### Manual smoke (user-installed plugin)

Install `@gui-chat-plugin/weather` (or any other `gui-chat-protocol`-shaped plugin) into the workspace ledger first — see _Scenario 1_ above — then:

```bash
yarn install
yarn dev
```

Expected boot log (with weather installed in the ledger):

```
[plugins/runtime] loaded requested=1 succeeded=1
[plugins/runtime] registered runtime plugins presets=0 userInstalled=1 registered=1 collisions=0
```

Then in the browser at [http://localhost:5173](http://localhost:5173):

1. Open a chat session.
2. Send "東京の天気おしえて".
3. Verify the canvas renders the weather View with current Tokyo weather.

If the View does not render, check devtools Network for the dynamic-import of `/api/plugins/runtime/%40gui-chat-plugin%2Fweather/<version>/dist/vue.js` (should be 200) and `/dist/style.css`.

### Manual: encoded traversal is blocked

```bash
TOKEN=$(cat ~/mulmoclaude/.session-token)
curl -s -o /dev/null -w '%{http_code}\n' -H "Origin: http://localhost:5173" \
  "http://localhost:3001/api/plugins/runtime/%2E%2E%2F%2E%2E%2Fetc/passwd/dist/index.js"
# expect: 404
```

The asset endpoint is unauthenticated (browsers can't attach `Authorization` to a `<script type="module">` fetch). The trust boundary is the runtime registry: only `(pkg, version)` pairs the server registered itself can resolve. An attacker-controlled URL never reaches `path.join` with a server-controlled root.

### Automated: Playwright end-to-end (browser side)

```bash
yarn dev          # server + vite must be up
npx tsx scripts/verify-phase-c.mts
```

Asserts:

- `/api/plugins/runtime/list` returns the preset (and any user-installed) entries.
- Each plugin's `dist/vue.js` and `dist/style.css` fetch as 200.
- Dynamic-importing `dist/vue.js` resolves the bare `import "vue"` (via importmap) to the host's Vue instance — `HostVue === PluginVue`.
- The plugin module exports a `viewComponent` and a `previewComponent` that the runtime registry can index.

### Automated: server-side unit tests

```bash
npx tsx --test test/plugins/test_preset_loader.ts
npx tsx --test test/plugins/test_runtime_loader.ts
npx tsx --test test/plugins/test_runtime_registry.ts
npx tsx --test test/api/routes/test_runtimePluginRoot.ts
```

Cover:

- `loadPresetPlugins` reads every entry from `server/plugins/preset-list.ts`, resolves it against `node_modules/<pkg>/`, and produces `RuntimePlugin` records with non-empty version + valid `TOOL_DEFINITION`.
- `loadPluginFromCacheDir` (used by both loader paths) handles missing `package.json`, malformed JSON, missing `TOOL_DEFINITION`, wrong shape, missing entry file, and the legacy `main` fallback.
- `registerRuntimePlugins` enforces the collision policy: static names win, runtime first-loaded wins on intra-runtime collision, repeated registration replaces the set.
- `resolvePluginRoot` returns the realpath of a registered plugin's cachePath; encoded `../` in either segment never matches a registered name.

### Automated: Docker MCP smoke

```bash
npx tsx --test test/agent/test_mcp_docker_smoke.ts
```

Verifies the MCP child process boots inside the Docker sandbox (the runtime loader runs in a `runtimeReady` Promise instead of top-level await because the container's tsx output target is cjs).

## How to add a preset

1. Add the package as a dep:

   ```bash
   yarn add @some-org/some-plugin
   ```

2. Append an entry to [`server/plugins/preset-list.ts`](../server/plugins/preset-list.ts):

   ```ts
   export const PRESET_PLUGINS: readonly PresetPlugin[] = [{ packageName: "@gui-chat-plugin/weather" }, { packageName: "@some-org/some-plugin" }];
   ```

3. Restart the server.

The plugin's tool name must NOT collide with any static MCP tool or any other runtime plugin (the registration log will reject collisions).

## How to write a plugin

Use [`gui-chat-protocol`](https://www.npmjs.com/package/gui-chat-protocol) — see [`@gui-chat-plugin/weather`](https://www.npmjs.com/package/@gui-chat-plugin/weather) for a reference shape:

- `TOOL_DEFINITION` (the MCP tool schema)
- `executeWeather` (server-side handler — runs when the LLM calls the tool)
- `plugin.viewComponent` / `plugin.previewComponent` (Vue components for the canvas / message preview)

The package's `dist/index.js` is what the server dynamic-imports for `TOOL_DEFINITION`; `dist/vue.js` is what the browser dynamic-imports for the components. Both must be pre-bundled (no bare imports beyond `vue`, which is resolved via importmap to the host's Vue instance).

## Related

- [`docs/manual-testing.md`](manual-testing.md) — broader manual test scenarios for the app
- [`plans/feat-plugin-c2-impl.md`](../plans/feat-plugin-c2-impl.md) — the rollout plan
- Issue [#1043](https://github.com/receptron/mulmoclaude/issues/1043) — plugin SDK / dynamic install / marketplace umbrella
