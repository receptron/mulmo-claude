import * as readline from "readline";
import { createBridgeClient } from "../_lib/client.js";

const TRANSPORT_ID = "cli";
const CHAT_ID = "terminal";

async function main(): Promise<void> {
  const apiUrl = process.env.MULMOCLAUDE_API_URL ?? "http://localhost:3001";
  console.log("MulmoClaude CLI bridge");
  console.log(`Connecting to ${apiUrl}`);
  console.log("Type /help for commands, Ctrl+C to exit.\n");

  const client = createBridgeClient({ transportId: TRANSPORT_ID });

  // Server → bridge async push (Phase B of #268). For Telegram this
  // would call sendMessage; the CLI just prints so the operator can
  // see scheduled / event-driven pushes arrive.
  client.onPush((ev) => {
    console.log(`\n[push] ${ev.chatId}: ${ev.message}\n`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const askOnce = (): Promise<string> =>
    new Promise((resolve) => rl.question("You: ", resolve));

  for (;;) {
    const line = (await askOnce()).trim();
    if (!line) continue;

    const ack = await client.send(CHAT_ID, line);
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
