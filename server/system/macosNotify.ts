// macOS Reminder notification sink (#789).
//
// On darwin, every `publishNotification()` call in
// `server/events/notifications.ts` also creates a reminder in the
// user's default Reminders list. The iCloud Reminders sync then
// mirrors the entry to the user's iPhone, which delivers the
// system notification.
//
// **Opt-out, on by default on darwin.** Set
// `DISABLE_MACOS_REMINDER_NOTIFICATIONS=1` to silence the sink
// (e.g. on a shared dev machine where the iPhone owner shouldn't
// be pinged). On non-darwin platforms the sink is a silent no-op
// regardless of env.
//
// Design notes:
// - Title / body are passed as `argv` (after osascript's `--`
//   separator). Going through argv rather than `system attribute`
//   sidesteps the UTF-8 garbling that `system attribute` exhibits
//   on multi-byte input (#789 follow-up).
// - Failures (osascript not found, Reminders.app permission denied,
//   non-zero exit) log a warn and resolve. They MUST NOT throw —
//   `publishNotification` itself wraps every sink in try/catch but
//   we keep the local guarantee here too so future call-sites can't
//   trip on it.

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { env } from "./env.js";
import { log } from "./logger/index.js";

// Re-declared (instead of `NodeJS.Platform`) so the file doesn't need
// a `NodeJS` global reference, which the no-undef lint rule doesn't
// see in type-only positions. Mirrors the same workaround used in
// `server/agent/config.ts`.
type Platform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";

// AppleScript reads `title` / `body` from the script's `argv` (passed
// after `--` on the osascript command line). Going through argv rather
// than `system attribute "FOO"` avoids the UTF-8 garble that
// `system attribute` exhibits on multi-byte characters — argv is
// always handed to the script as Unicode text.
const SCRIPT = [
  "on run argv",
  "    set t to item 1 of argv",
  "    set b to item 2 of argv",
  '    tell application "Reminders"',
  '        if b is "" then',
  "            make new reminder in default list with properties {name:t, due date:(current date)}",
  "        else",
  "            make new reminder in default list with properties {name:t, body:b, due date:(current date)}",
  "        end if",
  "    end tell",
  "end run",
].join("\n");

export type Spawner = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

interface Deps {
  spawner: Spawner;
  platform: Platform;
  // Opt-out flag (#789): on darwin the sink is enabled by default.
  // Set DISABLE_MACOS_REMINDER_NOTIFICATIONS=1 to silence it.
  disabled: boolean;
}

// Auto-disable inside `node:test`. The runner sets
// `NODE_TEST_CONTEXT` on the child process so we can detect it
// here. Without this gate, any test that goes through
// `publishNotification` (e.g. the route-level scheduleTest tests)
// fires real osascript and pollutes Reminders.app.
function isInsideNodeTest(): boolean {
  return typeof process.env.NODE_TEST_CONTEXT === "string" && process.env.NODE_TEST_CONTEXT.length > 0;
}

const defaultDeps: Deps = {
  spawner: spawn,
  platform: process.platform as Platform,
  disabled: env.disableMacosReminderNotifications || isInsideNodeTest(),
};

export function pushToMacosReminder(title: string, body?: string): Promise<void> {
  return pushToMacosReminderWithDeps(defaultDeps, title, body);
}

// Internal — exposed for tests. Lets the test suite inject a fake
// spawn / platform / disabled triple without touching real env or
// firing real subprocesses.
export function pushToMacosReminderWithDeps(deps: Deps, title: string, body?: string): Promise<void> {
  if (deps.platform !== "darwin") return Promise.resolve();
  if (deps.disabled) return Promise.resolve();

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // Title / body ride on argv so AppleScript receives them as
      // Unicode text. The trailing `--` is osascript's separator
      // between its own options and the script's `argv`.
      child = deps.spawner("osascript", ["-e", SCRIPT, "--", title, body ?? ""], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (err) {
      log.warn("macos-notify", "spawn failed", { error: String(err) });
      resolve();
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      log.warn("macos-notify", "subprocess error", { error: String(err) });
      resolve();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        log.warn("macos-notify", "osascript exited non-zero", {
          code,
          stderr: stderr.trim().slice(0, 500),
        });
      }
      resolve();
    });
  });
}
