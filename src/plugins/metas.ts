// Vue-free barrel of every built-in plugin's `META` (the central-
// registry-facing metadata). Host aggregators (src/config/*,
// server/workspace/paths.ts) iterate over `BUILT_IN_PLUGIN_METAS`
// and auto-merge per-dimension records — they never hold
// plugin-specific literals.
//
// Why a separate barrel from `src/plugins/index.ts`?
// `src/plugins/index.ts` exports `BUILT_IN_PLUGINS` (plugin
// REGISTRATIONS, including Vue View / Preview components). Server
// code can't import Vue, so this file gives server-side aggregators
// a Vue-free entry point that still co-locates the per-plugin
// metadata.
//
// **Auto-generated**. The list comes from
// `_generated/metas.ts` which is rewritten by
// `scripts/codegen-plugin-barrels.ts` (run via `predev` / `prebuild`
// hooks). Adding a plugin means dropping a `meta.ts` into the new
// `src/plugins/<name>/` directory; this file does not need editing.

import type { PluginMeta } from "./meta-types";
import { GENERATED_PLUGIN_METAS } from "./_generated/metas";

export const BUILT_IN_PLUGIN_METAS = GENERATED_PLUGIN_METAS;
export type BuiltInPluginMetas = typeof BUILT_IN_PLUGIN_METAS;

// ────────────────────────────────────────────────────────────────
// Collision detection
// ────────────────────────────────────────────────────────────────
//
// Aggregators spread plugin-owned records into host records. Without
// a guard, a plugin claiming a host-reserved key (`apiNamespace:
// "agent"`) or two plugins claiming the same key (both with
// `workspaceDirs.images`) would silently win the merge and route
// real traffic to the wrong handler.
//
// We don't `throw` at module load — that would brick the whole app
// for a single buggy plugin (especially relevant once user-installed
// runtime plugins land). Instead the helpers below are pure,
// returning collision lists; callers decide the policy:
//
//   - Built-in aggregators FILTER colliding plugin keys before merge
//     (host wins / first-registered plugin wins).
//   - `server/plugins/diagnostics.ts` collects the lists at boot,
//     surfaces them via `log.warn` + a system notification, and
//     persists them so a UI mounting later can still display them.

/** A plugin key colliding with a host-owned key in one aggregator. */
export interface HostPluginCollision {
  /** Aggregator label (`"API_ROUTES"`, `"WORKSPACE_DIRS"`, …). */
  label: string;
  /** The key claimed by both host and plugin. */
  key: string;
  /** `toolName` of the plugin claiming it. Empty for legacy callers
   *  that don't pass per-key plugin attribution. */
  plugin: string;
}

/** Two plugins claiming the same key in the same dimension. */
export interface IntraPluginCollision {
  /** Which dimension the duplicate appears in. */
  dimension: "toolName" | "apiNamespace" | "workspaceDirs" | "staticChannels";
  /** The duplicated key. */
  key: string;
  /** `toolName`s of the two plugins claiming it (first-registered, second). */
  plugins: [string, string];
}

/** Pure check — does any plugin key shadow a host key? Returns the
 *  list of colliding keys (empty when clean). Aggregators call this
 *  to decide which plugin keys to drop during the merge. */
export function findHostPluginCollisions(hostRecord: Readonly<Record<string, unknown>>, pluginRecord: Readonly<Record<string, unknown>>): readonly string[] {
  const hostKeys = new Set(Object.keys(hostRecord));
  return Object.keys(pluginRecord).filter((key) => hostKeys.has(key));
}

// `Object.hasOwn` needs the es2022 lib, which this project's frontend config
// does not enable; `hasOwnProperty.call` is the same check and is what the
// collection schema rules already use.
const hasOwnKey = (record: Readonly<Record<string, unknown>>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** The plugin that claimed `key`, or "" when none did. Own-property only: a
 *  key named after an `Object.prototype` member would otherwise attribute the
 *  collision to a function. */
function ownAttribution(pluginByKey: Readonly<Record<string, string>>, key: string): string {
  return hasOwnKey(pluginByKey, key) ? (pluginByKey[key] ?? "") : "";
}

/** Build an attributed collision list — one entry per (key, plugin)
 *  pair, where `pluginAttribution[key]` names the plugin claiming
 *  that key. Used by aggregators that aggregate ACROSS plugins
 *  (workspaceDirs, staticChannels) where each key may come from a
 *  different plugin. */
export function attributeHostPluginCollisions(
  label: string,
  hostRecord: Readonly<Record<string, unknown>>,
  pluginRecord: Readonly<Record<string, unknown>>,
  pluginByKey: Readonly<Record<string, string>>,
): HostPluginCollision[] {
  return findHostPluginCollisions(hostRecord, pluginRecord).map((key) => ({ label, key, plugin: ownAttribution(pluginByKey, key) }));
}

/** Build a first-write-wins aggregate of a per-plugin record across
 *  all plugins. Duplicate keys (= "intra-plugin collision") are
 *  reported in the returned `collisions` list with the first-claiming
 *  plugin AND the offender; the offender's value is dropped — runtime
 *  routes to the first plugin's handler.
 *
 *  This is the fix for Codex review iter-3+: previously each
 *  aggregator used `Object.fromEntries` / `Object.assign` to merge,
 *  which is JS-level last-write-wins. The diagnostic ran AFTER the
 *  merge and could only describe what was already lost, with the
 *  warning text contradicting actual behavior ("second is ignored"
 *  vs runtime's "second wins"). With this builder the merge IS the
 *  detection point — first-write semantics are enforced. */
export function buildPluginAggregate<V>(
  metas: readonly PluginMeta[],
  extract: (meta: PluginMeta) => Readonly<Record<string, V>> | undefined,
  dimension: IntraPluginCollision["dimension"],
): { aggregate: Record<string, V>; owner: Record<string, string>; collisions: IntraPluginCollision[] } {
  // Null-prototype targets: with a plain `{}`, `aggregate["__proto__"] = v`
  // hits the inherited setter — the entry is silently dropped (no collision
  // ever reported) and an object value would replace the prototype.
  const aggregate: Record<string, V> = Object.create(null);
  const owner: Record<string, string> = Object.create(null);
  const collisions: IntraPluginCollision[] = [];
  for (const meta of metas) {
    const record = extract(meta);
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      // Own-property check, not a bare index: a key named `constructor` or
      // `toString` reads an `Object.prototype` member here, so the very first
      // plugin to claim it is reported as colliding with a plugin that does
      // not exist, and its entry is dropped.
      if (hasOwnKey(owner, key)) {
        const priorPlugin = owner[key];
        // Two distinct plugins claim the same key. Keep the first
        // entry; report the offender so diagnostics can warn.
        collisions.push({ dimension, key, plugins: [priorPlugin, meta.toolName] });
        continue;
      }
      aggregate[key] = value;
      owner[key] = meta.toolName;
    }
  }
  // Spread back to plain objects: spread DEFINES own properties (no setter),
  // so a `__proto__` entry survives as a normal own key, while callers get
  // ordinary objects (deep-equal-friendly, normal prototype).
  return { aggregate: { ...aggregate }, owner: { ...owner }, collisions };
}

/** Filter a plugin record so only the keys that survive the merge
 *  policy remain: keys not claimed by the host. Returns the cleaned
 *  record AND the list of (label, key, plugin) drops so diagnostics
 *  can report them.
 *
 *  Intra-plugin collisions are filtered EARLIER by
 *  `buildPluginAggregate`; by the time this function runs the input
 *  is already first-write-wins-clean. */
export function filterPluginKeys<V>(
  label: string,
  hostKeys: ReadonlySet<string>,
  pluginRecord: Readonly<Record<string, V>>,
  pluginByKey: Readonly<Record<string, string>>,
): { cleaned: Record<string, V>; dropped: HostPluginCollision[] } {
  // Null-prototype for the same `__proto__` reason as `buildPluginAggregate`.
  const cleaned: Record<string, V> = Object.create(null);
  const dropped: HostPluginCollision[] = [];
  for (const [key, value] of Object.entries(pluginRecord)) {
    if (hostKeys.has(key)) {
      dropped.push({ label, key, plugin: ownAttribution(pluginByKey, key) });
      continue;
    }
    cleaned[key] = value;
  }
  return { cleaned: { ...cleaned }, dropped };
}

// ────────────────────────────────────────────────────────────────
// Host aggregate facade
// ────────────────────────────────────────────────────────────────
//
// `buildPluginAggregate` + `filterPluginKeys` always come paired:
// gather plugin contributions, drop the ones that collide with host
// keys, spread into the host record. Each of the four aggregator
// files (toolNames, apiRoutes, pubsubChannels, paths.ts) was repeating
// the same ~25-line shape. `defineHostAggregate` collapses the
// runtime half to one call so a new dimension (e.g. featureFlags) is
// one line at the call site, not five copy-pastes.
//
// The TYPE-LEVEL mapped shape stays at the call site — each
// aggregator's literal-preserving type (`PluginWorkspaceDirsMap`,
// `PluginApiRoutesMap`, …) is dimension-specific and would lose
// fidelity if collapsed into a generic helper. The runtime helper
// returns `Record<string, V>` and the call site narrows it.

export interface HostAggregateOptions<V> {
  /** Aggregator label used in `HostPluginCollision.label` (e.g.
   *  `"TOOL_NAMES"`, `"API_ROUTES"`). */
  readonly label: string;
  /** Host-owned record. Plugin keys that collide with these are
   *  dropped from the merge (host wins) and reported in
   *  `hostCollisions`. */
  readonly hostRecord: Readonly<Record<string, V>>;
  /** Per-plugin extractor — returns the contribution this plugin
   *  makes to this dimension, or `undefined` to skip. */
  readonly extract: (meta: PluginMeta) => Readonly<Record<string, V>> | undefined;
  /** Dimension label tagged onto every emitted
   *  `IntraPluginCollision`. */
  readonly dimension: IntraPluginCollision["dimension"];
  /** Extra reserved keys to drop on collision, ON TOP OF
   *  `Object.keys(hostRecord)`. Used when a sibling map shares a
   *  namespace with this aggregate — e.g. `WORKSPACE_DIRS` reserves
   *  `WORKSPACE_FILES` keys so a plugin can't smuggle in
   *  `workspaceDirs: { memory: ... }` and silently disagree with
   *  `WORKSPACE_FILES.memory` (CR review #1125). The reserved keys
   *  are NOT added to `merged` — only used for collision filtering. */
  readonly additionalReservedKeys?: ReadonlySet<string>;
}

export interface HostAggregate<V> {
  /** Merged record: host fields plus every plugin contribution that
   *  survived collision filtering. */
  readonly merged: Record<string, V>;
  /** Plugin keys dropped because a host record claimed the same
   *  key. */
  readonly hostCollisions: readonly HostPluginCollision[];
  /** Two plugins claiming the same key — the second is dropped
   *  (first-write-wins) and reported here. */
  readonly intraCollisions: readonly IntraPluginCollision[];
}

/** Run the standard "build per-plugin aggregate, drop host
 *  collisions, spread into host record" pipeline in one call. The
 *  caller still owns the literal-preserving type cast on `merged`. */
export function defineHostAggregate<V>(metas: readonly PluginMeta[], opts: HostAggregateOptions<V>): HostAggregate<V> {
  const { aggregate, owner, collisions } = buildPluginAggregate(metas, opts.extract, opts.dimension);
  const reserved = new Set<string>(Object.keys(opts.hostRecord));
  if (opts.additionalReservedKeys) {
    for (const key of opts.additionalReservedKeys) reserved.add(key);
  }
  const { cleaned, dropped } = filterPluginKeys(opts.label, reserved, aggregate, owner);
  return {
    merged: { ...opts.hostRecord, ...cleaned },
    hostCollisions: dropped,
    intraCollisions: collisions,
  };
}
