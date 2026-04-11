import { execFile } from "child_process";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * Extract the current OAuth credentials from the macOS Keychain and write them
 * to ~/.claude/.credentials.json so that the Docker-based sandbox can read them.
 *
 * Returns true if credentials were successfully refreshed, false otherwise.
 * Only works on macOS (darwin).
 */
export async function refreshCredentials(): Promise<boolean> {
  if (process.platform !== "darwin") return false;

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ]);
    const credentials = stdout.trim();
    if (!credentials) return false;

    await writeFile(CREDENTIALS_PATH, credentials + "\n");
    console.log("[sandbox] Credentials refreshed from macOS Keychain.");
    return true;
  } catch (err) {
    console.error(
      "[sandbox] Failed to refresh credentials from Keychain:",
      err,
    );
    return false;
  }
}
