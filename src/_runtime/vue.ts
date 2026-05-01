// Re-export Vue's runtime so a runtime-loaded plugin (#1043 C-2) can
// share the host's Vue instance via importmap. The browser resolves a
// plugin's bare `import "vue"` (after the importmap declared in
// `index.html`) to this file. Vite transforms this module's own
// `from "vue"` to the same Vue chunk the host app uses, so host and
// runtime-loaded plugin component code end up referencing the same
// Vue singleton — reactivity flows across the boundary, and there is
// only one `createApp`, one Composition API, etc.
//
// Why `export *` and not a named re-export: plugin bundles compiled
// against `gui-chat-protocol/vue` import a wide and evolving surface
// of Vue (defineComponent, h, ref, computed, watch, …). Whitelisting
// would force this file to track Vue's API. `export *` gives the
// plugin the full surface it was compiled against.
export * from "vue";
