// WhatsApp Cloud API platform plugin.
//
// Required secrets (wrangler secret put):
//   WHATSAPP_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//   WHATSAPP_ACCESS_TOKEN      — Permanent access token
//   WHATSAPP_PHONE_NUMBER_ID   — Phone number ID from Meta dashboard
//   WHATSAPP_VERIFY_TOKEN      — Arbitrary string for webhook verification

import { extractWhatsAppMessages } from "@mulmoclaude/common/meta-webhook";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { envSecret, requireEnvSecret } from "../utils/envSecret.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { handleMetaVerification, verifyMetaWebhookSignature } from "./meta.js";
import { postJsonChunks } from "./respond.js";
import { makeRelayMessage } from "./relay-message.js";

const WHATSAPP_API_VERSION = "v21.0";
const MAX_WA_TEXT = 4096;

const whatsappPlugin: PlatformPlugin = {
  name: PLATFORMS.whatsapp,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/whatsapp",

  isConfigured(env: Env): boolean {
    return Boolean(env.WHATSAPP_APP_SECRET) && Boolean(env.WHATSAPP_ACCESS_TOKEN);
  },

  handleVerification(request: Request, env: Env): Response {
    return handleMetaVerification(request, envSecret(env, "WHATSAPP_VERIFY_TOKEN") ?? "");
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    await verifyMetaWebhookSignature(request, body, requireEnvSecret(env, "WHATSAPP_APP_SECRET"), "WhatsApp");

    return extractWhatsAppMessages(JSON.parse(body)).map((msg) =>
      makeRelayMessage({ platform: PLATFORMS.whatsapp, senderId: msg.from, chatId: msg.from, text: msg.text.body }),
    );
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    const phoneNumberId = requireEnvSecret(env, "WHATSAPP_PHONE_NUMBER_ID");
    await postJsonChunks({
      text,
      maxTextLength: MAX_WA_TEXT,
      label: "WhatsApp",
      endpoint: `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
      accessToken: requireEnvSecret(env, "WHATSAPP_ACCESS_TOKEN"),
      buildBody: (chunk) => ({ messaging_product: "whatsapp", to: chatId, type: "text", text: { body: chunk } }),
    });
  },
};

registerPlatform(whatsappPlugin);
