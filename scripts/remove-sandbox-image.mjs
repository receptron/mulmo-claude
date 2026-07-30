import { spawnSync } from "node:child_process";

const preference = process.env.SANDBOX_RUNTIME;

function live(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

let runtime = preference;
if (runtime !== "docker" && runtime !== "apple-container") {
  runtime = process.platform === "darwin" && live("container", ["system", "status"]) ? "apple-container" : "docker";
}

const command = runtime === "apple-container" ? "container" : "docker";
const args = runtime === "apple-container" ? ["image", "delete", "--force", "mulmoclaude-sandbox"] : ["rmi", "mulmoclaude-sandbox"];
const result = spawnSync(command, args, { stdio: "inherit" });

if (result.error) {
  console.error(`Failed to run ${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
