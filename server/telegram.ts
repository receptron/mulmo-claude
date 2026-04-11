import { randomUUID } from "crypto";
import { access, appendFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { getRole, loadAllRoles } from "./roles.js";
import { runAgent } from "./agent.js";
import { workspacePath } from "./workspace.js";

interface TelegramChat {
  id: number;
}

interface TelegramUser {
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  from?: TelegramUser;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramChatState {
  chatId: string;
  sessionId: string;
  roleId: string;
  claudeSessionId?: string;
  startedAt: string;
  updatedAt: string;
}

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
const activeChats = new Set<string>();

let started = false;

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

function getDefaultRoleId(): string {
  return getRole(process.env.TELEGRAM_DEFAULT_ROLE_ID ?? "general").id;
}

function getAllowedChatIds(): Set<string> | null {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function getTelegramStateDir(): string {
  return path.join(workspacePath, "telegram", "chats");
}

function getStatePath(chatId: string): string {
  return path.join(getTelegramStateDir(), `${chatId}.json`);
}

function createFreshState(
  chatId: string,
  roleId = getDefaultRoleId(),
): TelegramChatState {
  const now = new Date().toISOString();
  return {
    chatId,
    sessionId: `telegram-${chatId}-${Date.now()}`,
    roleId: getRole(roleId).id,
    startedAt: now,
    updatedAt: now,
  };
}

async function readChatState(chatId: string): Promise<TelegramChatState> {
  const statePath = getStatePath(chatId);
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TelegramChatState>;
    if (
      parsed.chatId &&
      parsed.sessionId &&
      parsed.roleId &&
      parsed.startedAt &&
      parsed.updatedAt
    ) {
      return {
        ...parsed,
        chatId: String(parsed.chatId),
        roleId: getRole(parsed.roleId).id,
      } as TelegramChatState;
    }
  } catch {
    // fall through to create default state
  }
  const state = createFreshState(chatId);
  await writeChatState(state);
  return state;
}

async function writeChatState(state: TelegramChatState): Promise<void> {
  await mkdir(getTelegramStateDir(), { recursive: true });
  await writeFile(getStatePath(state.chatId), JSON.stringify(state, null, 2));
}

function getChatLogPaths(sessionId: string): {
  resultsFilePath: string;
  metaFilePath: string;
} {
  const chatDir = path.join(workspacePath, "chat");
  return {
    resultsFilePath: path.join(chatDir, `${sessionId}.jsonl`),
    metaFilePath: path.join(chatDir, `${sessionId}.json`),
  };
}

async function ensureChatLogFiles(state: TelegramChatState): Promise<void> {
  const chatDir = path.join(workspacePath, "chat");
  await mkdir(chatDir, { recursive: true });
  const { metaFilePath } = getChatLogPaths(state.sessionId);
  try {
    await access(metaFilePath);
  } catch {
    await writeFile(
      metaFilePath,
      JSON.stringify({
        roleId: state.roleId,
        startedAt: state.startedAt,
        transport: "telegram",
        telegramChatId: state.chatId,
      }),
    );
  }
}

async function appendChatEntry(
  sessionId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const { resultsFilePath } = getChatLogPaths(sessionId);
  await appendFile(resultsFilePath, JSON.stringify(entry) + "\n");
}

async function updateChatMeta(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { metaFilePath } = getChatLogPaths(sessionId);
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    await writeFile(metaFilePath, JSON.stringify({ ...meta, ...patch }));
  } catch {
    // Ignore if metadata is unavailable.
  }
}

async function telegramApi<T>(
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const response = await fetch(`${TELEGRAM_API_ORIGIN}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) splitAt = TELEGRAM_MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

async function sendTyping(chatId: string): Promise<void> {
  await telegramApi("sendChatAction", {
    chat_id: chatId,
    action: "typing",
  });
}

function getHelpText(): string {
  return [
    "MulmoClaude Telegram bot",
    "",
    "Commands:",
    "/start - initialize Telegram chat state",
    "/help - show this help",
    "/roles - list available roles",
    "/role <id> - switch role and start a new session",
    "/reset - reset the current conversation session",
    "",
    "Send a normal message to chat with MulmoClaude.",
    "Rich visual plugin output stays in the web UI; Telegram receives text replies.",
  ].join("\n");
}

function getRolesText(): string {
  return [
    "Available roles:",
    ...loadAllRoles().map((role) => `- ${role.id}: ${role.name}`),
  ].join("\n");
}

function getMessageText(message: TelegramMessage): string {
  return message.text?.trim() || message.caption?.trim() || "";
}

function getDisplayName(message: TelegramMessage): string {
  const parts = [message.from?.first_name, message.from?.last_name].filter(
    Boolean,
  );
  return parts.join(" ").trim() || message.from?.username || "Telegram user";
}

async function handleCommand(
  state: TelegramChatState,
  message: TelegramMessage,
  text: string,
): Promise<TelegramChatState> {
  const [command, ...args] = text.split(/\s+/);

  if (command === "/start") {
    const nextState = createFreshState(state.chatId, state.roleId);
    await writeChatState(nextState);
    await sendMessage(
      state.chatId,
      [
        `Started a new session with role: ${nextState.roleId}`,
        "",
        getHelpText(),
      ].join("\n"),
    );
    return nextState;
  }

  if (command === "/help") {
    await sendMessage(state.chatId, getHelpText());
    return state;
  }

  if (command === "/roles") {
    await sendMessage(state.chatId, getRolesText());
    return state;
  }

  if (command === "/reset") {
    const nextState = createFreshState(state.chatId, state.roleId);
    await writeChatState(nextState);
    await sendMessage(
      state.chatId,
      `Started a new session with role: ${nextState.roleId}`,
    );
    return nextState;
  }

  if (command === "/role") {
    const requestedRoleId = args[0];
    if (!requestedRoleId) {
      await sendMessage(state.chatId, `Usage: /role <id>\n\n${getRolesText()}`);
      return state;
    }

    const availableRole = loadAllRoles().find(
      (role) => role.id === requestedRoleId,
    );
    if (!availableRole) {
      await sendMessage(
        state.chatId,
        `Unknown role: ${requestedRoleId}\n\n${getRolesText()}`,
      );
      return state;
    }

    const nextState = createFreshState(state.chatId, availableRole.id);
    await writeChatState(nextState);
    await sendMessage(
      state.chatId,
      `Switched role to ${availableRole.name} (${availableRole.id}) and started a new session.`,
    );
    return nextState;
  }

  await sendMessage(
    state.chatId,
    `Unknown command: ${command}\n\n${getHelpText()}`,
  );
  return state;
}

async function handleAgentMessage(
  state: TelegramChatState,
  message: TelegramMessage,
  port: number,
): Promise<TelegramChatState> {
  await ensureChatLogFiles(state);

  const text = getMessageText(message);
  const userName = getDisplayName(message);

  await appendChatEntry(state.sessionId, {
    source: "user",
    type: "text",
    message: text,
    transport: "telegram",
    telegramMessageId: message.message_id,
    userName,
  });

  await sendTyping(state.chatId);

  let reply = "";
  let nextState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  for await (const event of runAgent(
    text,
    getRole(state.roleId),
    workspacePath,
    randomUUID(),
    port,
    state.claudeSessionId,
  )) {
    if (event.type === "text") {
      reply += event.message;
      continue;
    }

    if (event.type === "claude_session_id") {
      nextState = {
        ...nextState,
        claudeSessionId: event.id,
      };
      await updateChatMeta(state.sessionId, { claudeSessionId: event.id });
      continue;
    }

    if (event.type === "switch_role") {
      nextState = createFreshState(state.chatId, event.roleId);
      await sendMessage(
        state.chatId,
        `Role switched to ${nextState.roleId}. The next message will use a new session.`,
      );
      continue;
    }

    if (event.type === "error") {
      const errorText = event.message || "Unknown agent error";
      await sendMessage(state.chatId, `Error: ${errorText}`);
      return nextState;
    }
  }

  const finalReply =
    reply.trim() ||
    "MulmoClaude completed the request, but there was no plain-text reply to send to Telegram.";

  await appendChatEntry(state.sessionId, {
    source: "assistant",
    type: "text",
    message: finalReply,
    transport: "telegram",
  });

  await writeChatState(nextState);
  await sendMessage(state.chatId, finalReply);
  return nextState;
}

async function handleUpdate(
  update: TelegramUpdate,
  port: number,
): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = String(message.chat.id);
  const allowedChatIds = getAllowedChatIds();
  if (allowedChatIds && !allowedChatIds.has(chatId)) {
    await sendMessage(chatId, "This chat is not allowed to use the bot.");
    return;
  }

  const text = getMessageText(message);
  if (!text) {
    await sendMessage(chatId, "Text messages only for now.");
    return;
  }

  if (activeChats.has(chatId)) {
    await sendMessage(
      chatId,
      "A previous message is still running. Wait for that response before sending the next one.",
    );
    return;
  }

  activeChats.add(chatId);
  try {
    let state = await readChatState(chatId);
    if (text.startsWith("/")) {
      state = await handleCommand(state, message, text);
    } else {
      state = await handleAgentMessage(state, message, port);
    }
    await writeChatState({
      ...state,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Telegram update handling failed:", error);
    await sendMessage(chatId, `Error: ${String(error)}`);
  } finally {
    activeChats.delete(chatId);
  }
}

export async function startTelegramBot(port: number): Promise<void> {
  const token = getBotToken();
  if (!token) {
    console.log("Telegram bot disabled: TELEGRAM_BOT_TOKEN is not configured");
    return;
  }

  if (started) return;
  started = true;

  await mkdir(getTelegramStateDir(), { recursive: true });
  console.log("Telegram bot enabled with long polling");

  let offset = 0;
  for (;;) {
    try {
      const updates = await telegramApi<TelegramUpdate[]>("getUpdates", {
        timeout: 30,
        offset,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update, port);
      }
    } catch (error) {
      console.error("Telegram polling failed:", error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
