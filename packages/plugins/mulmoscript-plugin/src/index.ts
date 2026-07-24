// `.` entry — phase-1 server-facing core (definition + types + save/update
// executes against the generic gui-chat-protocol `files.artifacts`
// capability). The Vue View lands in a `./vue` entry in phase 2, heavy render
// backends in phase 3 (see plans/done/feat-mulmoscript-plugin.md).
export * from "./core/index";
