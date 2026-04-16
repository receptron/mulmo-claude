import * as readline from "readline";
import { io, Socket } from "socket.io-client";
import { readBridgeToken, TOKEN_FILE_PATH } from "./token.js";

const API_URL = process.env.MULMOCLAUDE_API_URL ?? "http://localhost:3001";
const TRANSPORT_ID = "cli";
const CHAT_ID = "terminal";
// 6 min > the server's REPLY_TIMEOUT_MS (5 min) so the server's
// timeout surfaces as a reply, not a client-side cancellation.
const REPLY_TIMEOUT_MS = 6 * 60 * 1000;

interface MessageAck {
  ok: boolean;
  reply?: string;
  error?: string;
  status?: number;
}

function requireToken(): string {
  const token = readBridgeToken();
  if (token !== null) return token;
  console.error(
    `No bearer token found. The MulmoClaude server writes one to\n` +
      `  ${TOKEN_FILE_PATH}\n` +
      `at startup (mode 0600). Start the server with \`yarn dev\` (or\n` +
      `\`npm run dev\`) first, or set MULMOCLAUDE_AUTH_TOKEN to the\n` +
      `same value the server is using.`,
  );
  process.exit(1);
}

function connect(token: string): Socket {
  return io(API_URL, {
    path: "/ws/chat",
    auth: { transportId: TRANSPORT_ID, token },
    transports: ["websocket"],
  });
}

function installSocketLogging(socket: Socket): void {
  socket.on("connect", () => {
    console.log(`Connected (${socket.id}).`);
  });
  socket.on("disconnect", (reason) => {
    console.error(`\nDisconnected: ${reason}`);
  });
  socket.on("connect_error", (err) => {
    const msg = err.message;
    // Token-mismatch recovery: the server rewrites its token on
    // every restart, so an old bridge will see "invalid token"
    // right after the server bounces. Tell the user how to fix it
    // instead of spinning on reconnects silently.
    if (msg === "invalid token" || msg === "server auth not ready") {
      console.error(
        "\nConnect error: bearer token rejected. The server likely\n" +
          "restarted since this bridge started — re-run `yarn cli` to\n" +
          "pick up the new token.\n",
      );
      return;
    }
    console.error(`\nConnect error: ${msg}`);
  });
}

function send(socket: Socket, text: string): Promise<MessageAck> {
  return new Promise((resolve) => {
    socket
      .timeout(REPLY_TIMEOUT_MS)
      .emit(
        "message",
        { externalChatId: CHAT_ID, text },
        (err: Error | null, ack: MessageAck | undefined) => {
          if (err) {
            resolve({ ok: false, error: `timeout: ${err.message}` });
            return;
          }
          resolve(ack ?? { ok: false, error: "no ack from server" });
        },
      );
  });
}

async function main(): Promise<void> {
  console.log("MulmoClaude CLI bridge");
  console.log(`Connecting to ${API_URL}`);
  console.log("Type /help for commands, Ctrl+C to exit.\n");

  const token = requireToken();
  const socket = connect(token);
  installSocketLogging(socket);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askOnce = (): Promise<string> =>
    new Promise((resolve) => rl.question("You: ", resolve));

  for (;;) {
    const line = (await askOnce()).trim();
    if (!line) continue;

    const ack = await send(socket, line);
    if (ack.ok) {
      console.log(`\nAssistant: ${ack.reply ?? ""}\n`);
    } else {
      const statusSuffix = ack.status ? ` (${ack.status})` : "";
      const reason = ack.error ?? "unknown";
      console.error(`\nError${statusSuffix}: ${reason}\n`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
