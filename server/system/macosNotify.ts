// macOS Reminder notification sink (#789).
//
// When `MACOS_REMINDER_NOTIFICATIONS=1` and the host is darwin, every
// `publishNotification()` call in `server/events/notifications.ts`
// also creates a reminder in the user's default Reminders list. The
// iCloud Reminders sync then mirrors the entry to the user's iPhone,
// which delivers the system notification.
//
// Design notes:
// - Title / body are passed via environment variables that the
//   AppleScript reads through `system attribute`. This sidesteps any
//   AppleScript-string escaping concern (no quoting, no backslash
//   handling — the script never sees the literal user text).
// - Failures (osascript not found, Reminders.app permission denied,
//   non-zero exit) log a warn and resolve. They MUST NOT throw —
//   `publishNotification` itself wraps every sink in try/catch but
//   we keep the local guarantee here too so future call-sites can't
//   trip on it.
// - Non-darwin platforms log a single warn at first call, then
//   no-op forever. Spamming once per notification would drown out
//   real logs.

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
  enabled: boolean;
}

const defaultDeps: Deps = {
  spawner: spawn,
  platform: process.platform as Platform,
  enabled: env.macosReminderNotifications,
};

let nonDarwinWarned = false;

export function pushToMacosReminder(title: string, body?: string): Promise<void> {
  return pushToMacosReminderWithDeps(defaultDeps, title, body);
}

// Internal — exposed for tests. Lets the test suite inject a fake
// spawn / platform / enabled triple without touching real env or
// firing real subprocesses.
export function pushToMacosReminderWithDeps(deps: Deps, title: string, body?: string): Promise<void> {
  if (!deps.enabled) return Promise.resolve();
  if (deps.platform !== "darwin") {
    if (!nonDarwinWarned) {
      log.warn("macos-notify", "MACOS_REMINDER_NOTIFICATIONS is set but platform is not darwin — sink is disabled", {
        platform: deps.platform,
      });
      nonDarwinWarned = true;
    }
    return Promise.resolve();
  }

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

// Test-only reset hook for the platform-warn guard.
export function _resetWarnFlagForTest(): void {
  nonDarwinWarned = false;
}
