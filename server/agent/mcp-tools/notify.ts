// `publishNotification` is injected (#803) so tests can mock the macOS /
// bell side effects.

import { publishNotification } from "../../events/notifications.js";
import { NOTIFICATION_KINDS } from "../../../src/types/notification.js";

export type NotifyPublishFn = typeof publishNotification;

export interface NotifyToolDeps {
  publish: NotifyPublishFn;
}

export function makeNotifyTool(deps: NotifyToolDeps) {
  return {
    definition: {
      name: "notify",
      description:
        "Send the user a push-style notification (web bell + macOS Reminders if MACOS_REMINDER_NOTIFICATIONS=1 + bridge). Use to report completion of long-running tasks, surface monitoring results, or proactively notify the user when they may be away from the keyboard.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short notification headline. Keep it concise — emojis OK.",
          },
          body: {
            type: "string",
            description: "Optional longer detail line. Omit when the title is self-explanatory.",
          },
        },
        required: ["title"],
      },
    },

    prompt:
      "Use the `notify` MCP tool — NOT a user-installed `/notify` skill — when the user asks for a notification ('通知して' / 'remind me' / 'tell me when …') or when reporting completion of a long-running task / monitoring summary / scheduled reminder firing. " +
      "This is the canonical built-in notification path: it fans out to the web bell, any active bridge transport, and macOS Reminders (when MACOS_REMINDER_NOTIFICATIONS=1 + darwin), and has NO active-user suppression — if the user asks for a notification, fire one. " +
      "After firing, briefly tell the user you sent the notification.",

    async handler(args: Record<string, unknown>): Promise<string> {
      const title = typeof args.title === "string" ? args.title.trim() : "";
      if (!title) return "notify: `title` is required (non-empty string).";
      const bodyRaw = typeof args.body === "string" ? args.body.trim() : "";
      const body = bodyRaw.length > 0 ? bodyRaw : undefined;

      deps.publish({
        kind: NOTIFICATION_KINDS.push,
        title,
        body,
      });
      return body ? `Notification sent: ${title}\n${body}` : `Notification sent: ${title}`;
    },
  };
}

export const notify = makeNotifyTool({ publish: publishNotification });
