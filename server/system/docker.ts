import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve as resolvePath } from "path";
import { log } from "./logger/index.js";
import { env } from "./env.js";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = "mulmoclaude-sandbox";
const DOCKERFILE = "Dockerfile.sandbox";
const LABEL_KEY = "mulmoclaude.dockerfile.sha256";

let _dockerEnabled: boolean | null = null;

function assertClaudeFiles(): void {
  const claudeDir = join(homedir(), ".claude");
  const claudeJson = join(homedir(), ".claude.json");

  try {
    if (!statSync(claudeDir).isDirectory()) {
      log.error("sandbox", `${claudeDir} exists but is not a directory.`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeDir} not found. Run 'claude' once to initialize.`);
    process.exit(1);
  }

  try {
    if (!statSync(claudeJson).isFile()) {
      log.error("sandbox", `${claudeJson} exists but is not a file.`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeJson} not found. Run 'claude' once to initialize.`);
    process.exit(1);
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  if (env.disableSandbox) return false;
  if (_dockerEnabled !== null) return _dockerEnabled;
  assertClaudeFiles();
  try {
    await execFileAsync("docker", ["ps", "-q"], { timeout: 5000 });
    _dockerEnabled = true;
  } catch {
    _dockerEnabled = false;
  }
  return _dockerEnabled;
}

function getDockerfileSha256(): string {
  const content = readFileSync(resolvePath(process.cwd(), DOCKERFILE));
  return createHash("sha256").update(content).digest("hex");
}

async function buildImage(sha: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["build", "-t", IMAGE_NAME, "--label", `${LABEL_KEY}=${sha}`, "-f", DOCKERFILE, "--load", "."], {
      cwd: process.cwd(),
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker build exited with code ${code}`));
    });
  });
}

export async function ensureSandboxImage(): Promise<void> {
  const expectedSha = getDockerfileSha256();

  let needsBuild = false;
  try {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", IMAGE_NAME, "--format", `{{index .Config.Labels "${LABEL_KEY}"}}`]);
    if (stdout.trim() !== expectedSha) {
      log.info("sandbox", "Dockerfile.sandbox changed, rebuilding sandbox image...");
      needsBuild = true;
    }
  } catch {
    log.info("sandbox", "Building sandbox image (first time only, may take a minute)...");
    needsBuild = true;
  }

  if (needsBuild) {
    await buildImage(expectedSha);
    log.info("sandbox", "Sandbox image built.");
  }
}

/**
 * Return the IPv4 gateway address of Docker's default bridge network,
 * or null if it cannot be determined. Docker containers using
 * `--add-host host.docker.internal:host-gateway` resolve to this IP,
 * so the server must listen on it for MCP server → host HTTP calls.
 *
 * We query the Docker daemon directly rather than reading
 * `os.networkInterfaces()` because Node skips the `docker0` interface
 * when its link state is DOWN (which it is whenever no containers are
 * running — exactly when we need the IP at server startup).
 */
export async function getDockerBridgeIp(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]);
    const ip = stdout.trim();
    // Sanity-check: must look like an IPv4 address
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null;
  } catch {
    return null;
  }
}
