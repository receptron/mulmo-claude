// Host binding for the server-side collection engine.
//
// The engine is parameterized over the host's workspace + services, but
// threading those through every call would be invasive. Instead each host
// (MulmoClaude, MulmoTerminal) configures the binding ONCE at startup via
// `configureCollectionHost`, and the engine reads it through the getters
// below. This keeps the existing call sites (which default to the live
// workspace root) unchanged while removing the package's dependency on
// host-only modules (`server/workspace/workspace.ts`, the host logger).

// Type-only: this module must not pull the firebase SDK in at runtime
// (it is an OPTIONAL peer of this package).
import type { FirestoreDocs } from "./firestoreDocs";

/** Logger shape the engine logs through — matches the host `Logger`
 *  (prefix, message, optional structured data). */
export interface CollectionLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

export interface CollectionHost {
  /** Absolute path to the host workspace root (e.g. `~/mulmoclaude`). The
   *  default root for every path/containment check that isn't given an
   *  explicit override. */
  workspaceRoot: string;
  /** Host logger; the engine logs under the `"collections"` prefix. */
  log: CollectionLogger;
  /** Host workspace layout — supplied as the host's own path helpers so the
   *  package owns no layout literals and works against a test/alt root. */
  paths: {
    /** Absolute user-scope skills dir (host-specific, e.g. `~/.claude/skills`). */
    userSkillsDir: string;
    /** Absolute project-scope skills dir for a workspace (`<root>/.claude/skills`). */
    projectSkillsDir: (workspaceRoot: string) => string;
    /** Absolute feeds-registry root for a workspace (`<root>/data/feeds`). */
    feedsRoot: (workspaceRoot: string) => string;
    /** Absolute project-skills *staging* dir for a workspace (`<root>/data/skills`). */
    skillsStagingDir: (workspaceRoot: string) => string;
    /** Workspace-relative archive dir (a removed collection's files move here). */
    archiveDir: string;
    /** Absolute path to the user-supplied extra-registries config file for a
     *  workspace (`<root>/config/collections-registries.json`). Injected so the
     *  registry engine owns no app layout literal and a downstream host can point
     *  it at its own workspace. */
    collectionsRegistriesConfig: (workspaceRoot: string) => string;
  };
  /** True for a preset-skill slug (host-owned naming convention). */
  isPresetSlug: (slug: string) => boolean;
}

/** The authenticated Firestore access plus the uid it is scoped to.
 *
 *  `uid` is what places documents under `users/{uid}/…`, the subtree the
 *  deployed security rules cover — so it must come from the live session,
 *  never from a schema.
 *
 *  `docs` is the narrow document interface rather than a raw `Firestore`
 *  so the backend stays testable: core ships `createFirestoreDocs` over the
 *  real SDK (`firestoreDocs.ts`) and tests inject an in-memory fake. */
export interface FirestoreHandle {
  docs: FirestoreDocs;
  uid: string;
}

/** A collection's records changed on disk. Carries the `slug` so the host can
 *  publish on a per-collection channel; `ids` lists the affected record ids
 *  when known (a consumer may ignore them and refetch the whole collection),
 *  and `op` is advisory. Deliberately carries NO record bodies — this is a
 *  "refetch" ping, not a data feed, so it stays cheap and leaks nothing when a
 *  host relays it into an opaque-origin custom-view iframe. */
export interface CollectionChangePayload {
  slug: string;
  ids?: string[];
  op?: "upsert" | "delete";
}

type CollectionChangePublisher = (payload: CollectionChangePayload) => void;

let current: CollectionHost | null = null;
let changePublisher: CollectionChangePublisher | null = null;
let firestoreAccessor: (() => FirestoreHandle | null) | null = null;

/** Wire the engine to a host. Call once at server startup, before any
 *  collection storage operation. Re-binding to a *different* host throws —
 *  silently redirecting later filesystem operations to another workspace
 *  would be a bug, not a feature. Re-calling with the same host is a no-op. */
export function configureCollectionHost(host: CollectionHost): void {
  if (current !== null && current !== host) {
    throw new Error("@mulmoclaude/core/collection/server: configureCollectionHost() was already called with a different host");
  }
  current = host;
}

/** Wire a publisher that broadcasts record-change events; the host bridges it
 *  to its pubsub. Kept SEPARATE from `configureCollectionHost` because the
 *  host's pubsub instance isn't ready at host-binding time (the binding is set
 *  at the top of server startup, the pubsub later). Optional: left unset, every
 *  write is silent — the default for tests and for a host that doesn't want
 *  live view updates. Pass `null` to detach (test teardown). */
export function setCollectionChangePublisher(publish: CollectionChangePublisher | null): void {
  changePublisher = publish;
}

/** Broadcast a record-change event if a publisher is wired (no-op otherwise).
 *  Called from the write path (`writeItem`/`deleteItem`). The wired publisher is
 *  expected to be fire-and-forget (it wraps its own pubsub call in try/catch),
 *  so this stays a thin pass-through and never throws into the write. */
export function publishCollectionChange(payload: CollectionChangePayload): void {
  changePublisher?.(payload);
}

function requireHost(): CollectionHost {
  if (current === null) {
    throw new Error("@mulmoclaude/core/collection/server: configureCollectionHost() was not called by the host");
  }
  return current;
}

/** The configured workspace root. Throws if the host never configured one. */
export function getWorkspaceRoot(): string {
  return requireHost().workspaceRoot;
}

// Workspace-layout accessors — thin wrappers over the host binding, named to
// match the host helpers they replace so the moved engine modules keep their
// call sites. Each throws (via requireHost) if the host never configured.
export function userSkillsDir(): string {
  return requireHost().paths.userSkillsDir;
}
export function projectSkillsDir(workspaceRoot: string): string {
  return requireHost().paths.projectSkillsDir(workspaceRoot);
}
export function feedsRoot(workspaceRoot: string): string {
  return requireHost().paths.feedsRoot(workspaceRoot);
}
export function skillsStagingDir(workspaceRoot: string): string {
  return requireHost().paths.skillsStagingDir(workspaceRoot);
}
export function archiveDir(): string {
  return requireHost().paths.archiveDir;
}
/** Absolute path to the configured workspace's `collections-registries.json`. */
export function collectionsRegistriesConfigPath(): string {
  const host = requireHost();
  return host.paths.collectionsRegistriesConfig(host.workspaceRoot);
}
export function isPresetSlug(slug: string): boolean {
  return requireHost().isPresetSlug(slug);
}

/** Wire the accessor for the host's authenticated Firestore session.
 *
 *  Separate from `configureCollectionHost` for the same reason
 *  `setCollectionChangePublisher` is: the host binding is set at the top of
 *  server startup, but this session doesn't exist until the user connects
 *  remote-host (and closes again on disconnect), so it cannot be part of a
 *  one-shot binding. Optional — left unwired, only `firestore` collections
 *  are affected, and they report "not connected". Pass `null` to detach. */
export function setFirestoreAccessor(accessor: (() => FirestoreHandle | null) | null): void {
  firestoreAccessor = accessor;
}

/** The host's live Firestore access, or null when there is no session (or
 *  the host never wired one — every non-firestore backend leaves it unset).
 *  Callers MUST surface null as an actionable "connect remote-host first",
 *  never as an empty result: silence would be indistinguishable from a
 *  collection that genuinely has no records. */
export function firestoreHandle(): FirestoreHandle | null {
  return firestoreAccessor?.() ?? null;
}

/** Logger proxy so engine modules can `import { log }` and use it exactly like
 *  the host logger — each call forwards to the live host binding. Logging is
 *  non-critical, so calls before the host configures a binding (e.g. unit tests
 *  that exercise pure logic) are dropped rather than throwing — unlike
 *  `getWorkspaceRoot()`, which fails loudly because the engine cannot operate
 *  without a workspace root. */
export const log: CollectionLogger = {
  error: (prefix, message, data) => current?.log.error(prefix, message, data),
  warn: (prefix, message, data) => current?.log.warn(prefix, message, data),
  info: (prefix, message, data) => current?.log.info(prefix, message, data),
  debug: (prefix, message, data) => current?.log.debug(prefix, message, data),
};
