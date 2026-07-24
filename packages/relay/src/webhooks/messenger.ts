// Facebook Messenger platform plugin.
//
// Required secrets (wrangler secret put):
//   MESSENGER_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//   MESSENGER_PAGE_ACCESS_TOKEN — Page access token
//   MESSENGER_VERIFY_TOKEN      — Arbitrary string for webhook verification

import { extractMessengerMessages } from "@mulmoclaude/common/meta-webhook";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { envSecret, requireEnvSecret } from "../utils/envSecret.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { handleMetaVerification, verifyMetaWebhookSignature } from "./meta.js";
import { postJsonChunks } from "./respond.js";
import { makeRelayMessage } from "./relay-message.js";

const MAX_MESSENGER_TEXT = 2000;

const messengerPlugin: PlatformPlugin = {
  name: PLATFORMS.messenger,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/messenger",

  isConfigured(env: Env): boolean {
    return Boolean(env.MESSENGER_APP_SECRET) && Boolean(env.MESSENGER_PAGE_ACCESS_TOKEN);
  },

  handleVerification(request: Request, env: Env): Response {
    return handleMetaVerification(request, envSecret(env, "MESSENGER_VERIFY_TOKEN") ?? "");
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    await verifyMetaWebhookSignature(request, body, requireEnvSecret(env, "MESSENGER_APP_SECRET"), "Messenger");

    return extractMessengerMessages(JSON.parse(body)).map((msg) =>
      makeRelayMessage({ platform: PLATFORMS.messenger, senderId: msg.senderId, chatId: msg.senderId, text: msg.text }),
    );
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    // Authorization header (not query string) — Graph API supports it, and
    // avoids leaking the token into CDN / proxy access logs and error reports.
    await postJsonChunks({
      text,
      maxTextLength: MAX_MESSENGER_TEXT,
      label: "Messenger",
      endpoint: "https://graph.facebook.com/v21.0/me/messages",
      accessToken: requireEnvSecret(env, "MESSENGER_PAGE_ACCESS_TOKEN"),
      buildBody: (chunk) => ({ recipient: { id: chatId }, message: { text: chunk } }),
    });
  },
};

registerPlatform(messengerPlugin);
