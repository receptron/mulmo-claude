// Platform plugin interface for the relay.
//
// Each messaging platform implements this interface. The relay
// auto-discovers enabled platforms at startup and routes messages
// accordingly. Adding a new platform = one file + register.
//
// Platforms connect in different ways:
//   - webhook: LINE, Messenger, Google Chat (HTTP POST from platform)
//   - polling: Telegram (relay fetches updates from API)
//   - websocket: Slack Socket Mode, Discord Gateway, Mattermost
//   - long-polling: Zulip
//
// The plugin interface accommodates all patterns via the `mode` field.

import type { RelayMessage, Platform, Env } from "./types.js";

// ── Connection modes ────────────────────────────────────────────

export const CONNECTION_MODES = {
  /** Platform sends HTTP POST to our webhook URL */
  webhook: "webhook",
  /** We poll the platform's API for new messages */
  polling: "polling",
  /** We maintain a WebSocket/SSE connection to the platform */
  persistent: "persistent",
} as const;

export type ConnectionMode = (typeof CONNECTION_MODES)[keyof typeof CONNECTION_MODES];

// ── Plugin interface ────────────────────────────────────────────

export interface PlatformPlugin {
  /** Platform identifier — used in routing and message tagging. */
  readonly name: Platform;

  /** How this platform delivers messages to the relay. */
  readonly mode: ConnectionMode;

  /** Webhook pathname (e.g., "/webhook/line"). Only for mode=webhook. */
  readonly webhookPath: string | null;

  /** Check if this platform is configured (env secrets present). */
  isConfigured(env: Env): boolean;

  /**
   * Handle an incoming webhook request.
   * Only called when mode=webhook. Parse + verify → RelayMessage[].
   */
  handleWebhook?(request: Request, body: string, env: Env): Promise<RelayMessage[]>;

  /**
   * Start a persistent connection or polling loop.
   * Only called when mode=polling or mode=persistent.
   * The callback enqueues messages to the Durable Object.
   * Returns a cleanup function to stop the loop/connection.
   */
  startIngestion?(env: Env, onMessage: (msg: RelayMessage) => Promise<void>): Promise<() => void>;

  /** Send a response back to the platform. */
  sendResponse(chatId: string, text: string, env: Env, replyToken?: string): Promise<void>;
}

// ── Plugin registry ─────────────────────────────────────────────

const plugins = new Map<string, PlatformPlugin>();

export function registerPlatform(plugin: PlatformPlugin): void {
  const key = plugin.webhookPath ?? plugin.name;
  if (plugins.has(key)) {
    throw new Error(`platform already registered: ${key}`);
  }
  plugins.set(key, plugin);
}

export function getPlatformByPath(path: string): PlatformPlugin | undefined {
  return plugins.get(path);
}

export function getPlatformByName(name: Platform): PlatformPlugin | undefined {
  for (const p of plugins.values()) {
    if (p.name === name) return p;
  }
  return undefined;
}

export function getConfiguredPlatforms(env: Env): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const p of plugins.values()) {
    result[p.name] = p.isConfigured(env);
  }
  return result;
}

export function getAllPlugins(): readonly PlatformPlugin[] {
  return [...plugins.values()];
}
