import * as readline from "readline";
import { readBridgeToken, TOKEN_FILE_PATH } from "./token.js";

const API_URL = process.env.MULMOCLAUDE_API_URL ?? "http://localhost:3001";
const TRANSPORT_ID = "cli";
const CHAT_ID = "terminal";

const token = readBridgeToken();
if (token === null) {
  console.error(
    `No bearer token found. The MulmoClaude server writes one to\n` +
      `  ${TOKEN_FILE_PATH}\n` +
      `at startup (mode 0600). Start the server with \`yarn dev\` (or\n` +
      `\`npm run dev\`) first, or set MULMOCLAUDE_AUTH_TOKEN to the\n` +
      `same value the server is using.`,
  );
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): void {
  rl.question("You: ", async (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/api/chat/${TRANSPORT_ID}/${CHAT_ID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text: trimmed }),
        },
      );

      if (res.status === 401) {
        // Almost always means the server was restarted after this
        // bridge started — the stale in-memory token no longer
        // matches the fresh one on disk. Tell the user how to
        // recover instead of silently failing every subsequent
        // prompt.
        console.error(
          "\nError (401): server rejected the bearer token. The\n" +
            "server was likely restarted since this bridge started.\n" +
            "Re-run `yarn cli` to pick up the new token.\n",
        );
        prompt();
        return;
      }

      if (!res.ok) {
        const body = await res.text();
        console.error(`\nError (${res.status}): ${body}\n`);
        prompt();
        return;
      }

      const data: { reply: string } = await res.json();
      console.log(`\nAssistant: ${data.reply}\n`);
    } catch (err) {
      console.error(
        `\nConnection error: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error("Is the MulmoClaude server running? (yarn dev)\n");
    }

    prompt();
  });
}

console.log("MulmoClaude CLI bridge");
console.log(`Connecting to ${API_URL}`);
console.log("Type /help for commands, Ctrl+C to exit.\n");
prompt();
