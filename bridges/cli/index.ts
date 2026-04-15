import * as readline from "readline";

const API_URL = process.env.MULMOCLAUDE_API_URL ?? "http://localhost:3001";
const TRANSPORT_ID = "cli";
const CHAT_ID = "terminal";

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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        },
      );

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
