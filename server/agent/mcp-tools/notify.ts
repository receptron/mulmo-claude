// `notify` MCP tool — exposes the server's notification bus to the
// agent so the user can ask "通知して" / "monitor the build and tell
// me when it's done" and the agent has a direct way to fire.
//
// Calls `publishNotification` with `kind: "push"`, which fans out
// to:
//   - Web bell
//   - Bridge (if a transportId is supplied — N/A from this entry
//     point)
//   - macOS Reminders (#789, on darwin unless the user has set
//     DISABLE_MACOS_REMINDER_NOTIFICATIONS=1)
//
// No active-user gate. If the user asks for a notification, fire it.
//
// `body` is optional and only forwarded when non-empty. `title` is
// required and trimmed.
//
// `publishNotification` is injected via `makeNotifyTool({ publish })`
// (#803) so unit tests can pass a mock and stay free of macOS / bell
// side effects. The default singleton `notify` wires the real
// implementation.

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

// Production singleton wired with the real publishNotification.
export const notify = makeNotifyTool({ publish: publishNotification });
