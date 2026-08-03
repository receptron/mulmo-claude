<script setup lang="ts">
// Debug-plugin View — three modes, branched on URL query.
//
//   /debug                                — button panel (default)
//   /debug?mode=auto-clear&notificationId=…  — clear on mount
//   /debug?mode=manual-clear&notificationId=…  — clear on Done click
//
// The first two URLs are fired by the host's notifier-debug popup
// when an action notification's `navigateTarget` points back here.
// The popup appends `?notificationId=<uuid>` automatically.
//
// No i18n, by design: this page is dev-only chrome behind
// `VITE_DEV_MODE=1`. Strings stay literal English in this file.
//
// URL reactivity: the host's router fires a
// `mulmoclaude:routechange` CustomEvent on every navigation
// (`src/router/index.ts`). We listen for it (plus popstate for
// back/forward) and re-read `window.location.search` on each fire.
// This works around the runtime-plugin sandbox not having direct
// access to vue-router — adding `vue-router` to the host's plugin
// importmap is a separate, larger change, and the custom-event
// bridge keeps this PR's scope contained to the debug surface.

import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { z } from "zod";

// `dispatch` hands back `unknown` unless given a reader (protocol 2.0.0):
// naming the result type at the call site never checked anything. These
// readers throw, which is the documented idiom — each caller already
// reports through its own try/catch.
const PublishResult = z.object({ ok: z.boolean(), id: z.string().optional() });
const ChatResult = z.object({ ok: z.boolean(), chatId: z.string() });
const ChatAndStoreResult = z.object({ ok: z.boolean(), chatId: z.string(), pendingId: z.string() });
const TickToggleResult = z.object({ ok: z.boolean(), on: z.boolean() });

// Contract pinned to the host's `HOST_EVENTS.routeChange` in
// `src/config/hostEvents.ts`. Runtime plugins can't import host
// internals, so the literal is duplicated here — but only once per
// package, behind a name that's greppable from both sides. If the
// host renames the event, this constant has to move in lockstep.
const HOST_ROUTE_CHANGE_EVENT = "mulmoclaude:routechange";

interface PublishArgs {
  kind: "publish";
  severity: "info" | "nudge" | "urgent";
  lifecycle: "fyi" | "action";
  title: string;
  body?: string;
  navigateTarget?: string;
}

interface ClearArgs {
  kind: "clear";
  id: string;
}

// Phase 1 of the Encore plan — exercises the new `runtime.tasks` and
// `runtime.chat` host extensions through the same dispatch path the
// notifier scenarios above use.
interface ChatStartArgs {
  kind: "chat-start";
  initialMessage: string;
  role?: string;
}

interface TickToggleArgs {
  kind: "tick-toggle";
  on: boolean;
}

// `chat-start-and-store` is the Encore-style flow where the plugin
// (a) writes a pending-clear ticket to its data dir keyed by an
// opaque pendingId, (b) seeds a chat whose initial message embeds
// the pendingId and tells the LLM to call `confirm-and-clear` on
// user confirmation. Survives reboot — the ticket is on disk.
interface ChatStartAndStoreArgs {
  kind: "chat-start-and-store";
  notificationId: string;
  role?: string;
}

const runtime = useRuntime();

const mode = ref<string | null>(null);
const notificationId = ref<string | null>(null);
const status = ref<string>("");
const autoClearedAt = ref<string | null>(null);
const manualClearedAt = ref<string | null>(null);
// `ask-user` mode (Phase 1 of the Encore plan): the target page of an
// action notification dispatches `chat-start` with a canned message,
// then redirects to the new chat. Tracks the started timestamp +
// chatId so a re-mount during the redirect window doesn't re-fire.
const askUserStartedAt = ref<string | null>(null);
const askUserChatId = ref<string | null>(null);
// `ask-user-store` mode: same shape, but stores a pending-clear
// ticket on disk and seeds the chat with a prompt instructing the
// LLM to call `confirm-and-clear` when the user confirms. The
// notification is NOT cleared on navigation — the LLM clears it.
const askUserStoreStartedAt = ref<string | null>(null);
const askUserStoreChatId = ref<string | null>(null);
const askUserStorePendingId = ref<string | null>(null);

function readUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const nextMode = params.get("mode");
  const nextId = params.get("notificationId");
  // Clear the per-mode confirmation state when the URL changes shape.
  // Without this, a user who flips between modes sees stale "cleared
  // at <time>" lines from the previous flow.
  if (nextMode !== mode.value || nextId !== notificationId.value) {
    autoClearedAt.value = null;
    manualClearedAt.value = null;
    askUserStartedAt.value = null;
    askUserChatId.value = null;
    askUserStoreStartedAt.value = null;
    askUserStoreChatId.value = null;
    askUserStorePendingId.value = null;
    status.value = "";
  }
  mode.value = nextMode;
  notificationId.value = nextId;
}

const view = computed<"default" | "auto-clear" | "manual-clear" | "ask-user" | "ask-user-store">(() => {
  if (mode.value === "auto-clear") return "auto-clear";
  if (mode.value === "manual-clear") return "manual-clear";
  if (mode.value === "ask-user") return "ask-user";
  if (mode.value === "ask-user-store") return "ask-user-store";
  return "default";
});

async function publish(args: Omit<PublishArgs, "kind">): Promise<void> {
  status.value = `firing ${args.lifecycle}/${args.severity}…`;
  try {
    const result = await runtime.dispatch({ kind: "publish", ...args } satisfies PublishArgs, (raw) => PublishResult.parse(raw));
    status.value = result.id ? `published ${result.id.slice(0, 8)}` : `published`;
  } catch (err) {
    status.value = `publish failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function clearById(id: string): Promise<string> {
  await runtime.dispatch({ kind: "clear", id } satisfies ClearArgs);
  return new Date().toISOString();
}

async function maybeAutoClear(): Promise<void> {
  if (view.value !== "auto-clear" || !notificationId.value || autoClearedAt.value) return;
  try {
    autoClearedAt.value = await clearById(notificationId.value);
    status.value = `auto-cleared on mount`;
  } catch (err) {
    status.value = `auto-clear failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function manualClear(): Promise<void> {
  if (!notificationId.value) return;
  try {
    manualClearedAt.value = await clearById(notificationId.value);
    status.value = `cleared by Done`;
  } catch (err) {
    status.value = `clear failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Encore-style flow: action notification → click → this mode dispatches
// `chat-start` with a canned message → redirects to the new chat. The
// seed message is fixed (this is a demo button, not a free-form input)
// — Encore's tick handler would build the message from obligation data
// instead. Best-effort clear: navigation continues even if clearing the
// source notification fails.
const ASK_USER_INITIAL_MESSAGE = "Ask the user if the user gets a notification or not";

async function maybeStartAskUserChat(): Promise<void> {
  if (view.value !== "ask-user" || askUserStartedAt.value) return;
  status.value = "creating Claude question chat…";
  try {
    const result = await runtime.dispatch(
      {
        kind: "chat-start",
        initialMessage: ASK_USER_INITIAL_MESSAGE,
      } satisfies ChatStartArgs,
      (raw) => ChatResult.parse(raw),
    );
    askUserChatId.value = result.chatId;
    askUserStartedAt.value = new Date().toISOString();
    if (notificationId.value) {
      try {
        await clearById(notificationId.value);
      } catch {
        // best-effort; the redirect still happens.
      }
    }
    status.value = `chat created — redirecting to /chat/${result.chatId}`;
    // Full navigation: the seeded user turn is already on disk with
    // `origin = plugin:@mulmoclaude/debug-plugin`, so the chat view
    // renders the "from <pkg>" chip on first paint.
    window.location.href = `/chat/${result.chatId}`;
  } catch (err) {
    status.value = `ask-user start failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// LLM-cleared variant: the source notification is NOT cleared here;
// the plugin's server-side `chat-start-and-store` action writes a
// pending-clear ticket on disk, the seed prompt embeds the ticket
// id, and the LLM calls `confirm-and-clear` when the user confirms.
// Survives reboot — the ticket is on disk under the plugin's data
// dir.
async function maybeStartAskUserStoreChat(): Promise<void> {
  if (view.value !== "ask-user-store" || askUserStoreStartedAt.value || !notificationId.value) return;
  status.value = "creating Claude question chat (LLM-cleared)…";
  try {
    const result = await runtime.dispatch(
      {
        kind: "chat-start-and-store",
        notificationId: notificationId.value,
      } satisfies ChatStartAndStoreArgs,
      (raw) => ChatAndStoreResult.parse(raw),
    );
    askUserStoreChatId.value = result.chatId;
    askUserStorePendingId.value = result.pendingId;
    askUserStoreStartedAt.value = new Date().toISOString();
    status.value = `chat created — redirecting to /chat/${result.chatId}`;
    window.location.href = `/chat/${result.chatId}`;
  } catch (err) {
    status.value = `ask-user-store start failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function onRouteChange(): void {
  readUrl();
  void maybeAutoClear();
  void maybeStartAskUserChat();
  void maybeStartAskUserStoreChat();
}

onMounted(() => {
  readUrl();
  window.addEventListener(HOST_ROUTE_CHANGE_EVENT, onRouteChange);
  window.addEventListener("popstate", onRouteChange);
  void maybeAutoClear();
  void maybeStartAskUserChat();
  void maybeStartAskUserStoreChat();
});

onUnmounted(() => {
  window.removeEventListener(HOST_ROUTE_CHANGE_EVENT, onRouteChange);
  window.removeEventListener("popstate", onRouteChange);
});

// ── Default-mode button scenarios ─────────────────────────────────

interface Scenario {
  label: string;
  args: Omit<PublishArgs, "kind">;
}

const scenarios: Scenario[] = [
  // fyi covers all three severities — the engine has no fyi/severity
  // restriction, so info/nudge/urgent are all valid.
  { label: "fyi / info", args: { severity: "info", lifecycle: "fyi", title: "Backup completed" } },
  { label: "fyi / nudge", args: { severity: "nudge", lifecycle: "fyi", title: "Disk usage 85%" } },
  { label: "fyi / urgent", args: { severity: "urgent", lifecycle: "fyi", title: "Service degraded" } },
  // action only pairs with `nudge` or `urgent` (info is rejected by
  // the engine + HTTP layer). Whether to auto-clear on open or wait
  // for an explicit Done click is an application-level choice — the
  // debug page surfaces both modes for both severities so the
  // landing flow can be eyeballed for each combination.
  {
    label: "action / nudge — clears on open",
    args: {
      severity: "nudge",
      lifecycle: "action",
      title: "Daily digest is ready",
      body: "Auto-clears when you open this page",
      navigateTarget: "/debug?mode=auto-clear",
    },
  },
  {
    label: "action / nudge — clears on Done",
    args: {
      severity: "nudge",
      lifecycle: "action",
      title: "News digest ready",
      body: "Stays in Active until you press Done on the landing page",
      navigateTarget: "/debug?mode=manual-clear",
    },
  },
  {
    label: "action / urgent — clears on open",
    args: {
      severity: "urgent",
      lifecycle: "action",
      title: "Service incident report ready",
      body: "Auto-clears when you open this page",
      navigateTarget: "/debug?mode=auto-clear",
    },
  },
  {
    label: "action / urgent — clears on Done",
    args: {
      severity: "urgent",
      lifecycle: "action",
      title: "Pay property tax",
      body: "Stays in Active until you press Done on the landing page",
      navigateTarget: "/debug?mode=manual-clear",
    },
  },
  // Phase 1 of the Encore plan — action notification whose target
  // page seeds a new Claude chat. Demonstrates the full end-to-end
  // flow: tasks (or a button click) → notifier.publish action →
  // user clicks → target page calls chat.start → user lands in a
  // chat already primed with the question Claude should ask.
  {
    label: "action / nudge — opens a Claude question",
    args: {
      severity: "nudge",
      lifecycle: "action",
      title: "Did you get a notification?",
      body: "Click to chat with Claude about it",
      navigateTarget: "/debug?mode=ask-user",
    },
  },
  // Same shape, but the source notification is cleared by the LLM
  // via `manageDebug({ kind: "confirm-and-clear", pendingId })` —
  // the plugin stores a pending-clear ticket on disk, embeds the
  // ticket id in the seed prompt, and tells Claude to call the
  // tool when the user confirms. Survives reboot.
  {
    label: "action / nudge — opens a Claude question (LLM clears via stored id)",
    args: {
      severity: "nudge",
      lifecycle: "action",
      title: "Did you get this one?",
      body: "Claude will clear it after you confirm yes",
      navigateTarget: "/debug?mode=ask-user-store",
    },
  },
];

async function fireMixed(): Promise<void> {
  for (const scenario of scenarios) {
    await publish(scenario.args);
  }
}

// ── Phase 1 of Encore plan — tasks + chat extensions ──────────────

const tickOn = ref(false);
const tickStatus = ref<string>("");

async function setTick(on: boolean): Promise<void> {
  tickStatus.value = on ? "enabling…" : "disabling…";
  try {
    const result = await runtime.dispatch({ kind: "tick-toggle", on } satisfies TickToggleArgs, (raw) => TickToggleResult.parse(raw));
    tickOn.value = result.on;
    tickStatus.value = result.on ? "ON — fyi notification every minute (watch the bell)" : "OFF";
  } catch (err) {
    tickStatus.value = `tick toggle failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const chatInitialMessage = ref<string>("Ask me what day it is.");
const chatRole = ref<string>("");
const chatStartedId = ref<string | null>(null);
const chatStatus = ref<string>("");

async function startSeededChat(): Promise<void> {
  if (!chatInitialMessage.value.trim()) {
    chatStatus.value = "initialMessage is required";
    return;
  }
  chatStatus.value = "starting chat…";
  chatStartedId.value = null;
  try {
    const args: ChatStartArgs = {
      kind: "chat-start",
      initialMessage: chatInitialMessage.value,
      ...(chatRole.value.trim() ? { role: chatRole.value.trim() } : {}),
    };
    const result = await runtime.dispatch(args, (raw) => ChatResult.parse(raw));
    chatStartedId.value = result.chatId;
    chatStatus.value = `chat started — open the chat to see the seeded turn marked "from @mulmoclaude/debug-plugin"`;
  } catch (err) {
    chatStatus.value = `chat-start failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
</script>

<!-- eslint-disable @intlify/vue-i18n/no-raw-text --
  Dev-only debug page, gated by `VITE_DEV_MODE=1` at the host.
  Strings stay literal English by design (see file header). -->
<template>
  <div class="h-full bg-white text-gray-900 flex flex-col overflow-hidden">
    <header class="flex items-center gap-3 px-3 py-2 border-b border-gray-200">
      <h2 class="text-lg font-semibold text-gray-800">Debug</h2>
      <span class="text-xs text-gray-400">{{ status }}</span>
    </header>

    <div v-if="view === 'default'" class="flex-1 overflow-y-auto p-4">
      <p class="text-sm text-gray-600 mb-3">
        Click a button below to fire a test notification. Watch the bug-icon popup next to the bell — it shows the new Active / History UX.
      </p>
      <div class="flex flex-col gap-2">
        <button
          v-for="scenario in scenarios"
          :key="scenario.label"
          type="button"
          class="text-left px-3 py-2 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 text-sm"
          :data-testid="`debug-fire-${scenario.label.replace(/[^a-z]+/gi, '-')}`"
          @click="publish(scenario.args)"
        >
          Fire {{ scenario.label }}
        </button>
        <button
          type="button"
          class="text-left px-3 py-2 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-sm"
          data-testid="debug-fire-mixed"
          @click="fireMixed"
        >
          Fire mixed batch (6 entries)
        </button>
      </div>

      <hr class="my-6 border-gray-200" />

      <section data-testid="debug-tasks-section">
        <h3 class="text-sm font-semibold text-gray-800 mb-2">Tick (runtime.tasks.register)</h3>
        <p class="text-sm text-gray-600 mb-3">
          One-minute heartbeat registered at plugin setup time. When ON, every tick posts a fyi notification — watch the bell icon to confirm the host task
          manager is firing the plugin's run() callback.
        </p>
        <div class="flex items-center gap-2 mb-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-sm"
            :class="tickOn ? 'opacity-50 cursor-not-allowed' : ''"
            :disabled="tickOn"
            data-testid="debug-tick-on"
            @click="setTick(true)"
          >
            Tick ON
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-sm"
            :class="!tickOn ? 'opacity-50 cursor-not-allowed' : ''"
            :disabled="!tickOn"
            data-testid="debug-tick-off"
            @click="setTick(false)"
          >
            Tick OFF
          </button>
          <span class="text-xs text-gray-500">{{ tickStatus }}</span>
        </div>
      </section>

      <hr class="my-6 border-gray-200" />

      <section data-testid="debug-chat-section">
        <h3 class="text-sm font-semibold text-gray-800 mb-2">Seeded chat (runtime.chat.start)</h3>
        <p class="text-sm text-gray-600 mb-3">
          Opens a new chat seeded with the initial message below. Claude treats it as a user turn and responds — the chat history renders the seeded turn with a
          "from @mulmoclaude/debug-plugin" chip so you can tell it came from a plugin, not from you.
        </p>
        <div class="flex flex-col gap-2 mb-2">
          <label class="text-xs text-gray-600">
            initialMessage
            <textarea
              v-model="chatInitialMessage"
              rows="2"
              class="mt-1 w-full px-2 py-1 rounded border border-gray-300 text-sm font-mono"
              data-testid="debug-chat-initial-message"
            />
          </label>
          <label class="text-xs text-gray-600">
            role (optional, defaults to "general")
            <input
              v-model="chatRole"
              type="text"
              placeholder="general"
              class="mt-1 w-full px-2 py-1 rounded border border-gray-300 text-sm font-mono"
              data-testid="debug-chat-role"
            />
          </label>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-sm"
              data-testid="debug-chat-start"
              @click="startSeededChat"
            >
              Start seeded chat
            </button>
            <span class="text-xs text-gray-500">{{ chatStatus }}</span>
          </div>
          <p v-if="chatStartedId" class="text-xs text-gray-500">
            chatId =
            <a :href="`/chat/${chatStartedId}`" class="text-blue-600 hover:underline font-mono" data-testid="debug-chat-link">{{ chatStartedId }}</a>
          </p>
        </div>
      </section>
    </div>

    <div v-else-if="view === 'auto-clear'" class="flex-1 overflow-y-auto p-4">
      <h3 class="text-base font-semibold mb-2">Auto-clear on open</h3>
      <p class="text-sm text-gray-700 mb-2">
        This page cleared the notification automatically when it mounted. The "read-once" pattern: viewing the target IS the close.
      </p>
      <p v-if="autoClearedAt" class="text-sm text-green-700 mb-3">✓ Cleared at {{ autoClearedAt }}</p>
      <p v-else class="text-sm text-amber-600 mb-3">(clearing…)</p>
      <p class="text-xs text-gray-400 font-mono mb-3">id = {{ notificationId }}</p>
      <a href="/debug" class="text-blue-600 hover:underline text-sm">← back to test panel</a>
    </div>

    <div v-else-if="view === 'ask-user'" class="flex-1 overflow-y-auto p-4" data-testid="debug-ask-user-mode">
      <h3 class="text-base font-semibold mb-2">Opening Claude question chat</h3>
      <p class="text-sm text-gray-700 mb-2">
        Calling
        <code class="font-mono text-xs bg-gray-100 px-1 rounded"
          >runtime.chat.start({ initialMessage: "Ask the user if the user gets a notification or not" })</code
        >
        and redirecting to the new chat.
      </p>
      <p v-if="askUserStartedAt && askUserChatId" class="text-sm text-green-700 mb-3">
        ✓ Chat created at {{ askUserStartedAt }} — redirecting to /chat/{{ askUserChatId }}…
      </p>
      <p v-else class="text-sm text-amber-600 mb-3">(starting chat…)</p>
      <p class="text-xs text-gray-400 font-mono mb-3">notificationId = {{ notificationId }}</p>
      <a href="/debug" class="text-blue-600 hover:underline text-sm">← back to test panel</a>
    </div>

    <div v-else-if="view === 'ask-user-store'" class="flex-1 overflow-y-auto p-4" data-testid="debug-ask-user-store-mode">
      <h3 class="text-base font-semibold mb-2">Opening Claude question chat (LLM-cleared)</h3>
      <p class="text-sm text-gray-700 mb-2">
        Calling
        <code class="font-mono text-xs bg-gray-100 px-1 rounded">manageDebug({ kind: "chat-start-and-store", notificationId })</code>. The plugin writes a
        pending-clear ticket to disk, seeds the chat with the ticket id, and the LLM will call
        <code class="font-mono text-xs bg-gray-100 px-1 rounded">manageDebug({ kind: "confirm-and-clear", pendingId })</code>
        once you confirm yes — clearing the source notification.
      </p>
      <p v-if="askUserStoreStartedAt && askUserStoreChatId" class="text-sm text-green-700 mb-3">
        ✓ Chat created at {{ askUserStoreStartedAt }} — redirecting to /chat/{{ askUserStoreChatId }}…
      </p>
      <p v-else class="text-sm text-amber-600 mb-3">(starting chat…)</p>
      <p class="text-xs text-gray-400 font-mono mb-1">notificationId = {{ notificationId }}</p>
      <p v-if="askUserStorePendingId" class="text-xs text-gray-400 font-mono mb-3">pendingId = {{ askUserStorePendingId }}</p>
      <a href="/debug" class="text-blue-600 hover:underline text-sm">← back to test panel</a>
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4">
      <h3 class="text-base font-semibold mb-2">Manual clear on Done</h3>
      <p class="text-sm text-gray-700 mb-2">
        Press the button below to clear the notification. The "act-on" pattern: opening the page does not by itself satisfy the obligation.
      </p>
      <p v-if="manualClearedAt" class="text-sm text-green-700 mb-3">✓ Cleared at {{ manualClearedAt }}</p>
      <p class="text-xs text-gray-400 font-mono mb-3">id = {{ notificationId }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!notificationId || manualClearedAt !== null"
        data-testid="debug-manual-clear-done"
        @click="manualClear"
      >
        Done
      </button>
      <div class="mt-4">
        <a href="/debug" class="text-blue-600 hover:underline text-sm">← back to test panel</a>
      </div>
    </div>
  </div>
</template>
<!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
