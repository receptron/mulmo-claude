import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import { resolve as resolvePath } from "path";
import { log } from "./logger/index.js";
import { env } from "./env.js";
import { SUBPROCESS_PROBE_TIMEOUT_MS } from "../utils/time.js";
import { claudeConfigDir, claudeConfigJson } from "../utils/claudeConfigPath.js";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = "mulmoclaude-sandbox";
const DOCKERFILE = "Dockerfile.sandbox";
const LABEL_KEY = "mulmoclaude.dockerfile.sha256";

export type SandboxRuntime = "docker" | "apple-container";

let _runtime: SandboxRuntime | null | undefined;
let _runtimeProbe: Promise<SandboxRuntime | null> | null = null;

function assertClaudeFiles(): void {
  const claudeDir = claudeConfigDir();
  const claudeJson = claudeConfigJson();
  const overrideHint = "Set CLAUDE_CONFIG_DIR / CLAUDE_CONFIG_JSON to point at your install if it lives elsewhere.";

  try {
    if (!statSync(claudeDir).isDirectory()) {
      log.error("sandbox", `${claudeDir} exists but is not a directory. ${overrideHint}`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeDir} not found. Run 'claude' once to initialize. ${overrideHint}`);
    process.exit(1);
  }

  try {
    if (!statSync(claudeJson).isFile()) {
      log.error("sandbox", `${claudeJson} exists but is not a file. ${overrideHint}`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeJson} not found. Run 'claude' once to initialize. ${overrideHint}`);
    process.exit(1);
  }
}

/** Pure daemon-liveness probe: `docker ps -q` succeeds only when the
 *  client is installed AND the daemon is reachable. No config or
 *  caching concerns — the optional-deps registry owns the PATH check
 *  and caching; this is just the liveness half. */
export async function isDockerLive(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["ps", "-q"], {
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/** Apple container liveness probe. `system status` only succeeds when
 *  the CLI and its system service are both usable. */
export async function isAppleContainerLive(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await execFileAsync("container", ["system", "status"], {
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

function runtimeCandidates(): readonly SandboxRuntime[] {
  if (env.sandboxRuntime === "docker") return ["docker"];
  if (env.sandboxRuntime === "apple-container") return ["apple-container"];
  return process.platform === "darwin" ? ["apple-container", "docker"] : ["docker"];
}

async function probeRuntime(runtime: SandboxRuntime): Promise<boolean> {
  return runtime === "docker" ? isDockerLive() : isAppleContainerLive();
}

/** Detect the configured container runtime without checking Claude
 *  credentials. Used by optional-dependency diagnostics. */
export async function detectLiveSandboxRuntime(): Promise<SandboxRuntime | null> {
  for (const runtime of runtimeCandidates()) {
    if (await probeRuntime(runtime)) return runtime;
  }
  return null;
}

/** Resolve and cache the runtime used for this process. Apple container
 *  is preferred on macOS in auto mode; Docker remains the fallback and
 *  the only runtime on other platforms. */
export async function resolveSandboxRuntime(): Promise<SandboxRuntime | null> {
  if (env.disableSandbox) return null;
  if (_runtime !== undefined) return _runtime;
  if (_runtimeProbe) return _runtimeProbe;
  _runtimeProbe = (async () => {
    const detected = await detectLiveSandboxRuntime();
    if (detected) assertClaudeFiles();
    _runtime = detected;
    return detected;
  })();
  try {
    return await _runtimeProbe;
  } finally {
    _runtimeProbe = null;
  }
}

/** Backward-compatible boolean for code that only needs to know whether
 *  the agent is isolated. */
export async function isDockerAvailable(): Promise<boolean> {
  return (await resolveSandboxRuntime()) !== null;
}

function getDockerfileSha256(): string {
  const content = readFileSync(resolvePath(process.cwd(), DOCKERFILE));
  return createHash("sha256").update(content).digest("hex");
}

export function sandboxRuntimeCommand(runtime: SandboxRuntime): "docker" | "container" {
  return runtime === "docker" ? "docker" : "container";
}

export function appleContainerImageLabel(inspectJson: string, labelKey: string): string | undefined {
  try {
    const images = JSON.parse(inspectJson) as {
      variants?: { config?: { config?: { Labels?: Record<string, string> } } }[];
    }[];
    for (const image of images) {
      for (const variant of image.variants ?? []) {
        const value = variant.config?.config?.Labels?.[labelKey];
        if (typeof value === "string") return value;
      }
    }
  } catch {
    // A malformed or version-incompatible response simply forces a rebuild.
  }
  return undefined;
}

async function buildImage(runtime: SandboxRuntime, sha: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args =
      runtime === "docker"
        ? ["build", "-t", IMAGE_NAME, "--label", `${LABEL_KEY}=${sha}`, "-f", DOCKERFILE, "--load", "."]
        : ["build", "-t", IMAGE_NAME, "--label", `${LABEL_KEY}=${sha}`, "-f", DOCKERFILE, "."];
    const proc = spawn(sandboxRuntimeCommand(runtime), args, {
      cwd: process.cwd(),
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${sandboxRuntimeCommand(runtime)} build exited with code ${code}`));
    });
  });
}

async function imageLabel(runtime: SandboxRuntime): Promise<string | undefined> {
  if (runtime === "docker") {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", IMAGE_NAME, "--format", `{{index .Config.Labels "${LABEL_KEY}"}}`]);
    return stdout.trim();
  }
  const { stdout } = await execFileAsync("container", ["image", "inspect", IMAGE_NAME]);
  return appleContainerImageLabel(stdout, LABEL_KEY);
}

export async function ensureSandboxImage(runtime?: SandboxRuntime): Promise<void> {
  const selected = runtime ?? (await resolveSandboxRuntime());
  if (!selected) throw new Error("No live sandbox runtime");
  const expectedSha = getDockerfileSha256();

  let needsBuild = false;
  try {
    if ((await imageLabel(selected)) !== expectedSha) {
      log.info("sandbox", "Dockerfile.sandbox changed, rebuilding sandbox image...", { runtime: selected });
      needsBuild = true;
    }
  } catch {
    log.info("sandbox", "Building sandbox image (first time only, may take a minute)...", { runtime: selected });
    needsBuild = true;
  }

  if (needsBuild) {
    await buildImage(selected, expectedSha);
    log.info("sandbox", "Sandbox image built.", { runtime: selected });
  }
}
