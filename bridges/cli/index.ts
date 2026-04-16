import * as readline from "readline";
import { io, Socket } from "socket.io-client";

const API_URL = process.env.MULMOCLAUDE_API_URL ?? "http://localhost:3001";
const TRANSPORT_ID = "cli";
const CHAT_ID = "terminal";

interface MessageAck {
  ok: boolean;
  reply?: string;
  error?: string;
  status?: number;
}

function connect(): Socket {
  return io(API_URL, {
    path: "/ws/chat",
    auth: { transportId: TRANSPORT_ID },
    transports: ["websocket"],
  });
}

function send(socket: Socket, text: string): Promise<MessageAck> {
  return new Promise((resolve) => {
    socket
      .timeout(6 * 60 * 1000)
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

function setupSocketLogging(socket: Socket): void {
  socket.on("connect", () => {
    console.log(`Connected (${socket.id}).`);
  });
  socket.on("disconnect", (reason) => {
    console.error(`\nDisconnected: ${reason}`);
  });
  socket.on("connect_error", (err) => {
    console.error(`\nConnect error: ${err.message}`);
  });
}

async function main(): Promise<void> {
  console.log("MulmoClaude CLI bridge");
  console.log(`Connecting to ${API_URL}`);
  console.log("Type /help for commands, Ctrl+C to exit.\n");

  const socket = connect();
  setupSocketLogging(socket);

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
