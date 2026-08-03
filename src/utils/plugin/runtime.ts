// Browser-side plugin runtime construction (#1110). The host's runtime
// plugin loader provides one of these per plugin via Vue's
// `provide(PLUGIN_RUNTIME_KEY, ...)`; the plugin's components fetch
// it via `useRuntime()` from `gui-chat-protocol/vue`.
//
// Every helper closes over `pkgName` so the plugin's pubsub channel
// and notify call cannot leak into another plugin's namespace.

import { computed, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserPluginRuntime } from "gui-chat-protocol/vue";
import { usePubSub } from "../../composables/usePubSub";
import { apiPost } from "../api";
import { API_ROUTES } from "../../config/apiRoutes";
import { isSupportedLocale } from "../../lang/index";

/** Build the channel name for a plugin's event. Must stay in lockstep
 *  with `server/plugins/runtime.ts:pluginChannelName`. */
export function pluginChannelName(pkgName: string, eventName: string): string {
  return `plugin:${pkgName}:${eventName}`;
}

/** The `subscribe` options bag, written out rather than imported from the
 *  protocol: this repo runs ESLint without `projectService` (lint speed), so a
 *  type followed across a package boundary resolves to `any` and every use of
 *  `parse` reads as an unsafe call. Structurally identical to the compiler. */
interface ParseOptions<T> {
  parse: (raw: unknown) => T | null;
}

/** Wrap a plugin's `parse` + handler into the raw-frame callback the host
 *  pubsub takes.
 *
 *  Two rules the protocol puts on the HOST, both of which are drops rather
 *  than failures — extracted so they can be exercised without a socket:
 *
 *  - A `parse` that THROWS drops the frame. The documented idiom is
 *    `parse: (raw) => Schema.parse(raw)` and zod's `parse` throws, so a
 *    rethrow here would take down a channel shared with every other
 *    subscriber over one malformed frame.
 *  - A `parse` returning `null` drops it too; that is the cheap path the
 *    protocol prefers (`safeParse(raw).data ?? null`). */
export function parsedFrameDelivery<T>(parse: (raw: unknown) => T | null, handler: ((payload: T) => void) | undefined): (raw: unknown) => void {
  return (raw: unknown) => {
    let parsed: T | null;
    try {
      parsed = parse(raw);
    } catch {
      return;
    }
    if (parsed !== null && handler) handler(parsed);
  };
}

function makeScopedPubSub(pkgName: string): BrowserPluginRuntime["pubsub"] {
  const { subscribe } = usePubSub();
  // Two arities (protocol 2.0.0): `(name, handler)` delivers raw frames as
  // `unknown`; `(name, { parse }, handler)` delivers `parse`'s return type.
  // The plugin used to name that type with a generic, which checked nothing —
  // the host fans out untyped frames.
  function scoped(eventName: string, handler: (payload: unknown) => void): () => void;
  function scoped<T>(eventName: string, opts: ParseOptions<T>, handler: (payload: T) => void): () => void;
  function scoped<T>(eventName: string, optsOrHandler: ParseOptions<T> | ((payload: unknown) => void), maybeHandler?: (payload: T) => void): () => void {
    const channel = pluginChannelName(pkgName, eventName);
    if (typeof optsOrHandler === "function") return subscribe(channel, optsOrHandler);
    return subscribe(channel, parsedFrameDelivery(optsOrHandler.parse, maybeHandler));
  }
  return { subscribe: scoped };
}

function makeScopedLogger(pkgName: string): BrowserPluginRuntime["log"] {
  // Frontend logger maps to `console.*` in v1. The host's central
  // logger lives server-side; routing browser logs there is a future
  // enhancement that doesn't change this surface.
  const tag = `[plugin/${pkgName}]`;
  return {
    debug: (msg, data) => console.debug(tag, msg, data),
    info: (msg, data) => console.info(tag, msg, data),
    warn: (msg, data) => console.warn(tag, msg, data),
    error: (msg, data) => console.error(tag, msg, data),
  };
}

/** Allowlisted URL schemes for `runtime.openUrl`. The two http schemes
 *  cover the legitimate "open this external page" use case; everything
 *  else (`javascript:`, `data:`, `vbscript:`, `file:`, custom schemes)
 *  is rejected. The `noopener,noreferrer` flags on `window.open`
 *  prevent the opened tab from snooping the opener but do NOT stop
 *  `javascript:` execution — that's why scheme filtering is the actual
 *  XSS guard. CodeRabbit review caught this on PR #1124. */
const OPEN_URL_ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

function makeOpenUrl(pkgName: string): BrowserPluginRuntime["openUrl"] {
  return (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      console.warn(`[plugin/${pkgName}] openUrl rejected unparseable URL`, { url });
      return;
    }
    if (!OPEN_URL_ALLOWED_SCHEMES.has(parsed.protocol)) {
      console.warn(`[plugin/${pkgName}] openUrl rejected non-http(s) scheme`, { scheme: parsed.protocol });
      return;
    }
    // `noopener` prevents the opened tab from accessing `window.opener`
    // and snooping; `noreferrer` strips the Referer header so the
    // destination can't see what page sent the user. Forced at the
    // platform level so individual plugin links can't drop them.
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      // Popup blocker engaged.
      console.warn(`[plugin/${pkgName}] window.open returned null`, { url });
    }
  };
}

export function makeDispatch(pkgName: string): BrowserPluginRuntime["dispatch"] {
  // Substitute `:pkg` in the contracted dispatch route. encodeURIComponent
  // collapses scoped names (`@org/pkg`) into one URL path segment;
  // the parameter pattern `:pkg` matches any segment.
  const url = API_ROUTES.plugins.runtimeDispatch.replace(":pkg", encodeURIComponent(pkgName));
  // Both arities (protocol 2.0.0). The reader is the ONLY thing that checks a
  // response: the old single generic let a caller name the type of bytes
  // nobody had looked at. Accepting `parse` in the signature but ignoring it
  // here would be worse than not migrating — every call site would read as
  // validated while nothing ran (Codex review on #2783).
  //
  // A throwing `parse` propagates, unlike `subscribe`'s: the protocol
  // documents that idiom for `dispatch`, and the caller's own try/catch is
  // where a bad response belongs.
  function dispatch(args: object): Promise<unknown>;
  function dispatch<T>(args: object, parse: (raw: unknown) => T): Promise<T>;
  async function dispatch<T>(args: object, parse?: (raw: unknown) => T): Promise<T | unknown> {
    const result = await apiPost<unknown>(url, args);
    if (!result.ok) {
      throw new Error(`plugin/${pkgName} dispatch failed (${result.status}): ${result.error}`);
    }
    return parse ? parse(result.data) : result.data;
  }
  return dispatch;
}

export interface MakeBrowserPluginRuntimeDeps {
  /** npm package name. Used both as the namespace prefix for
   *  pubsub channels and as the log prefix. */
  pkgName: string;
  /** Optional URL map exposed via `runtime.endpoints` for multi-URL
   *  built-in plugins. Runtime-loaded plugins (the common
   *  single-dispatch shape) leave this undefined. Built-in plugins
   *  (#1141) hand `{ method, url }` records; host-shared scopes hand
   *  plain string URLs — kept opaque here, narrowed at the consumer
   *  via `pluginEndpoints<E>(scope)`. See `BrowserPluginRuntime.endpoints`
   *  in `gui-chat-protocol@>=0.3.1` for the contract. */
  endpoints?: Readonly<Record<string, unknown>> | undefined;
}

export function makeBrowserPluginRuntime(deps: MakeBrowserPluginRuntimeDeps): BrowserPluginRuntime {
  const { pkgName, endpoints } = deps;
  // `useI18n()` exposes `locale` as `WritableComputedRef<Locales>`. A
  // writable passthrough widens it to `Ref<string>` for plugin authors
  // (so they don't need to import the host's locale union) while
  // preserving reactivity in both directions.
  const { locale: hostLocale } = useI18n();
  const locale: Ref<string> = computed({
    get: () => String(hostLocale.value),
    set: (next) => {
      if (isSupportedLocale(next)) hostLocale.value = next;
    },
  });
  return {
    pubsub: makeScopedPubSub(pkgName),
    locale,
    log: makeScopedLogger(pkgName),
    openUrl: makeOpenUrl(pkgName),
    dispatch: makeDispatch(pkgName),
    // `BrowserPluginRuntime.endpoints` is now typed as the runtime's
    // `E` type parameter (gui-chat-protocol@>=0.3.2, default
    // `Readonly<Record<string, unknown>>`). Plugin authors pin the
    // shape via `useRuntime<TheirShape>()` and read `runtime.endpoints!`
    // without a cast. No coercion needed at this construction site —
    // the host populates the field opaquely; each consumer narrows.
    // A plugin with no endpoint group leaves the key absent.
    ...(endpoints !== undefined ? { endpoints } : {}),
  };
}
