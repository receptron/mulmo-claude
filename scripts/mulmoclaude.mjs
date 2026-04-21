#!/usr/bin/env node
import { spawn } from "node:child_process";

const SERVER_START_DELAY_MS = 2000;

const spawnProcess = (name, command, args) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${name}] exited via signal ${signal}`);
      return;
    }

    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
};

const server = spawnProcess("server", "npx", ["tsx", "server/index.ts"]);
let client;

const startClient = () => {
  client = spawnProcess("client", "npx", ["vite"]);
};

const shutdown = () => {
  server?.kill("SIGTERM");
  client?.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.on("exit", () => {
  client?.kill("SIGTERM");
  process.exit();
});

setTimeout(startClient, SERVER_START_DELAY_MS);
