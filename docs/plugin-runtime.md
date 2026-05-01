# Runtime plugins

Workspace-installed and repo-shipped GUI chat plugins that load at server boot without being part of the build-time bundle. Tracks issue [#1043](https://github.com/receptron/mulmoclaude/issues/1043) C-2.

A runtime plugin is a published npm package that exports a `gui-chat-protocol` `ToolPlugin`: an MCP `TOOL_DEFINITION`, a server-side `execute()` handler, and Vue components (`viewComponent` for the canvas, `previewComponent` for the message preview). The plugin's tarball lives in the workspace (or under `node_modules/` for presets); the boot loader extracts and registers it with the runtime registry, then the frontend dynamic-imports the View when the LLM calls the tool.

There are **two sources** of runtime plugins, both feeding the same registry:

| Source | Where it lives | Who controls it | Use case |
|---|---|---|---|
| **Preset** | `node_modules/<pkg>/`, listed in [`server/plugins/preset-list.ts`](../server/plugins/preset-list.ts) (kept under `server/` so it's available at runtime in Docker, where `config/` is not mounted) | repo / committer | First-launch UX. Plugins that ship with mulmoclaude. |
| **User-installed** | `~/mulmoclaude/plugins/<pkg>.tgz`, listed in `~/mulmoclaude/plugins/plugins.json` | end user | Per-workspace extensions the user installs themselves. |

On tool-name collision the preset wins (loaded first). Static built-in MCP tools win over both.

## User scenarios

### Scenario 1: out-of-the-box (preset)

A fresh checkout of mulmoclaude has [`@gui-chat-plugin/weather`](https://www.npmjs.com/package/@gui-chat-plugin/weather) registered as a preset. After `yarn install && yarn dev`:

1. Server boot logs `[plugins/preset] loaded requested=1 succeeded=1`.
2. Server boot logs `[plugins/runtime] registered runtime plugins presets=1 userInstalled=0 registered=1 collisions=0`.
3. The MCP child exposes `fetchWeather` in `tools/list`.
4. The user opens [http://localhost:5173](http://localhost:5173), sends "東京の天気おしえて", and the LLM calls `fetchWeather`.
5. The toolResult event arrives; the canvas renders the weather plugin's View (⛅ + Tailwind styling).

No manual install. No code edit. The runtime pipeline runs end-to-end on every fresh checkout.

### Scenario 2: user installs a third-party plugin

Phase D (the `yarn plugin:install` CLI) is not yet shipped. Until then, the install path is manual:

```bash
mkdir -p ~/mulmoclaude/plugins
cd "$(mktemp -d)" && npm pack @some/plugin
mv *.tgz ~/mulmoclaude/plugins/
# Append an entry to ~/mulmoclaude/plugins/plugins.json:
# [{"name":"@some/plugin","version":"X.Y.Z","tgz":"some-plugin-X.Y.Z.tgz","installedAt":"<ISO>"}]
# Restart the server.
```

After restart, `[plugins/runtime] registered runtime plugins presets=1 userInstalled=1 …` and the new tool is callable.

### Scenario 3: mix preset + user-installed

Both sources merge into the same registry. The user-installed plugin sees presets and vice versa; on collision the preset wins.

### Scenario 4: collision with a built-in MCP tool

A preset or user-installed plugin whose `TOOL_DEFINITION.name` matches a built-in MCP tool (`notify`, `readXPost`, `searchX`) or a static GUI plugin (everything in [`config/plugins.registry.ts`](../config/plugins.registry.ts)) is **rejected** at registration time. The boot log records this:

```
[plugins/registry] skipping runtime plugin — name collides with static tool plugin=@x/notify-clone tool=notify
```

The user must rename their plugin's tool or uninstall.

## Test scenarios

### Manual smoke (preset only — no setup needed)

```bash
git switch feat/plugin-c2-server
yarn install
yarn dev
```

Expected boot log:

```
[plugins/preset] loaded requested=1 succeeded=1
[plugins/runtime] registered runtime plugins presets=1 userInstalled=0 registered=1 collisions=0
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
   export const PRESET_PLUGINS: readonly PresetPlugin[] = [
     { packageName: "@gui-chat-plugin/weather" },
     { packageName: "@some-org/some-plugin" },
   ];
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
