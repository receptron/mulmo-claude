import { log } from "../logger/index.js";
import { getRole } from "../roles.js";
import { DEFAULT_ROLE_ID } from "../../src/config/roles.js";
import { startChat } from "../routes/agent.js";
import { onSessionEvent } from "../session-store/index.js";
import { getChatState, setChatState, resetChatState } from "./chat-state.js";
import { handleCommand } from "./commands.js";
import { EVENT_TYPES } from "../../src/types/events.js";

// Shared core of the bridge chat flow. HTTP and socket handlers both
// call this — the only difference between them is how the result is
// serialised back to the caller.

export type RelayResult =
  | { kind: "ok"; reply: string }
  | { kind: "error"; status: number; message: string };

export interface RelayParams {
  transportId: string;
  externalChatId: string;
  text: string;
}

const REPLY_TIMEOUT_MS = 5 * 60 * 1000;

export async function relayMessage(params: RelayParams): Promise<RelayResult> {
  const { transportId, externalChatId, text } = params;

  log.info("chat-service", "message received", {
    transportId,
    externalChatId,
    textLength: text.length,
  });

  let chatState = await getChatState(transportId, externalChatId);
  if (!chatState) {
    const defaultRole = getRole(DEFAULT_ROLE_ID);
    chatState = await resetChatState(
      transportId,
      externalChatId,
      defaultRole.id,
    );
  }

  const commandResult = await handleCommand(text, transportId, chatState);
  if (commandResult) {
    return { kind: "ok", reply: commandResult.reply };
  }

  const result = await startChat({
    message: text,
    roleId: chatState.roleId,
    chatSessionId: chatState.sessionId,
  });

  if (result.kind === "error") {
    const status = result.status ?? 500;
    if (status === 409) {
      return {
        kind: "ok",
        reply: "A previous message is still being processed. Please wait.",
      };
    }
    log.error("chat-service", "startChat failed", {
      transportId,
      externalChatId,
      error: result.error,
    });
    return {
      kind: "error",
      status,
      message: `Error: ${result.error}`,
    };
  }

  try {
    const reply = await collectAgentReply(chatState.sessionId);
    await setChatState(transportId, {
      ...chatState,
      updatedAt: new Date().toISOString(),
    });
    return { kind: "ok", reply };
  } catch (err) {
    log.error("chat-service", "reply collection failed", {
      transportId,
      externalChatId,
      error: String(err),
    });
    return {
      kind: "error",
      status: 500,
      message: "Error: failed to collect agent reply",
    };
  }
}

function collectAgentReply(chatSessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const textChunks: string[] = [];

    const timer = setTimeout(() => {
      unsubscribe();
      resolve(
        textChunks.join("") ||
          "The request timed out before a reply was generated.",
      );
    }, REPLY_TIMEOUT_MS);

    const unsubscribe = onSessionEvent(chatSessionId, (event) => {
      const type = event.type as string;

      if (type === EVENT_TYPES.text) {
        textChunks.push(event.message as string);
      }

      if (type === EVENT_TYPES.error) {
        clearTimeout(timer);
        unsubscribe();
        resolve(`Error: ${event.message as string}`);
      }

      if (type === EVENT_TYPES.sessionFinished) {
        clearTimeout(timer);
        unsubscribe();
        resolve(
          textChunks.join("") ||
            "The assistant completed the request but produced no text reply.",
        );
      }
    });
  });
}
