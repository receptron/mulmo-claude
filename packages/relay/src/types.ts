// Relay message format — normalized from platform-specific webhooks.

export const PLATFORMS = {
  line: "line",
  telegram: "telegram",
  slack: "slack",
  discord: "discord",
  messenger: "messenger",
  mattermost: "mattermost",
  zulip: "zulip",
  whatsapp: "whatsapp",
  matrix: "matrix",
  irc: "irc",
  googleChat: "google-chat",
} as const;

export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

export interface RelayMessage {
  id: string;
  platform: Platform;
  senderId: string;
  chatId: string;
  text: string;
  attachments?: RelayAttachment[];
  receivedAt: string;
  replyToken?: string;
}

export interface RelayAttachment {
  type: "image" | "file";
  url?: string;
  mimeType?: string;
}

export interface RelayResponse {
  platform: Platform;
  chatId: string;
  text: string;
  replyToken?: string;
}

// Env uses Record<string, unknown> as a base so platform plugins
// can access their own secrets without extending this interface.
// Each plugin checks for its own keys via `env.KEY_NAME`.
export interface Env {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RELAY: any;
  RELAY_TOKEN: string;
  // Platform-specific secrets are accessed dynamically.
  // Known keys for reference (not exhaustive):
  //   LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN
  //   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
  //   SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN
  //   DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN
  //   MESSENGER_APP_SECRET, MESSENGER_PAGE_ACCESS_TOKEN
  [key: string]: unknown;
}
