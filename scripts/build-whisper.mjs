#!/usr/bin/env node
//
// Builds whisper.cpp's `whisper-server` from source and links it onto
// PATH, so local voice input (Settings → Voice) works. We build from
// source rather than `brew install whisper-cpp` because the Homebrew
// formula ships with `-DWHISPER_BUILD_SERVER=OFF` — it provides only
// `whisper-cli`, not the warm-model HTTP server the app spawns. See
// plans/done/feat-voice-input.md.
//
// macOS / Apple Silicon only (Metal acceleration). The build links the
// dylibs with an absolute rpath into `.whisper/dist/lib`, so the
// symlink we drop on PATH resolves its libraries from anywhere.
//
// Usage:
//   node scripts/build-whisper.mjs [--link-dir=<dir>] [--ref=<git-ref>]
//
//   --link-dir   where to symlink the binaries (default: /opt/homebrew/bin
//                on Apple Silicon — user-owned and on PATH). Pass a dir you
//                control if you don't use Homebrew.
//   --ref        whisper.cpp git tag/branch to build (default: v1.9.1,
//                matching the Homebrew stable).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, rmSync, accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WHISPER_DIR = path.join(REPO_ROOT, ".whisper");
const SRC_DIR = path.join(WHISPER_DIR, "src");
const BUILD_DIR = path.join(SRC_DIR, "build");
const DIST_DIR = path.join(WHISPER_DIR, "dist");
const REPO_URL = "https://github.com/ggml-org/whisper.cpp.git";

const BINARIES = ["whisper-server", "whisper-cli"];

function parseArgs(argv) {
  let linkDir = os.arch() === "arm64" ? "/opt/homebrew/bin" : "/usr/local/bin";
  let ref = "v1.9.1";
  for (const arg of argv) {
    if (arg.startsWith("--link-dir=")) linkDir = arg.slice("--link-dir=".length);
    else if (arg.startsWith("--ref=")) ref = arg.slice("--ref=".length);
  }
  return { linkDir, ref };
}

function fail(message) {
  console.error(`[build-whisper] ${message}`);
  process.exit(1);
}

// Run a command, inheriting stdio, and abort the script on failure.
function run(cmd, args, cwd) {
  console.log(`[build-whisper] $ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) fail(`failed to spawn ${cmd}: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} exited with code ${result.status}`);
}

function hasOnPath(cmd) {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function checkPrerequisites() {
  if (process.platform !== "darwin") {
    fail("voice input is macOS-only; whisper-server build is not supported on this platform.");
  }
  if (os.arch() !== "arm64") {
    console.warn("[build-whisper] not on Apple Silicon — building anyway, but Metal acceleration may be unavailable.");
  }
  if (!hasOnPath("git")) fail("git is required but not found on PATH.");
  if (!hasOnPath("cmake")) fail("cmake is required but not found. Install it with: brew install cmake");
}

function fetchSource(ref) {
  mkdirSync(WHISPER_DIR, { recursive: true });
  if (existsSync(path.join(SRC_DIR, ".git"))) {
    console.log(`[build-whisper] source present — checking out ${ref}`);
    run("git", ["fetch", "--tags", "--depth", "1", "origin", ref], SRC_DIR);
    run("git", ["checkout", "--force", ref], SRC_DIR);
  } else {
    rmSync(SRC_DIR, { recursive: true, force: true });
    run("git", ["clone", "--depth", "1", "--branch", ref, REPO_URL, SRC_DIR]);
  }
}

function buildAndInstall() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  // SERVER on, SDL2 off (we don't need the binary's own mic capture),
  // tests off. Absolute install rpath so a symlink on PATH still finds
  // the dylibs in dist/lib.
  run(
    "cmake",
    [
      "-S",
      SRC_DIR,
      "-B",
      BUILD_DIR,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DWHISPER_BUILD_EXAMPLES=ON",
      "-DWHISPER_BUILD_SERVER=ON",
      "-DWHISPER_SDL2=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      `-DCMAKE_INSTALL_PREFIX=${DIST_DIR}`,
      `-DCMAKE_INSTALL_RPATH=${path.join(DIST_DIR, "lib")}`,
    ],
    REPO_ROOT,
  );
  run("cmake", ["--build", BUILD_DIR, "-j", "--config", "Release"], REPO_ROOT);
  run("cmake", ["--install", BUILD_DIR], REPO_ROOT);
}

function canWrite(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function linkBinaries(linkDir) {
  const distBin = path.join(DIST_DIR, "bin");
  const server = path.join(distBin, "whisper-server");
  if (!existsSync(server)) fail(`build finished but ${server} is missing — check the cmake output above.`);

  if (!existsSync(linkDir) || !canWrite(linkDir)) {
    console.log("");
    console.log(`[build-whisper] could not write to ${linkDir}. Add the built binaries to PATH manually, e.g.:`);
    console.log(`  export PATH="${distBin}:$PATH"`);
    return distBin;
  }
  for (const name of BINARIES) {
    const target = path.join(distBin, name);
    const link = path.join(linkDir, name);
    if (!existsSync(target)) continue;
    rmSync(link, { force: true });
    symlinkSync(target, link);
    console.log(`[build-whisper] linked ${link} -> ${target}`);
  }
  return linkDir;
}

function main() {
  const { linkDir, ref } = parseArgs(process.argv.slice(2));
  checkPrerequisites();
  fetchSource(ref);
  buildAndInstall();
  const where = linkBinaries(linkDir);
  console.log("");
  console.log("[build-whisper] done. Verify with:");
  console.log("  whisper-server --help | head -n 1");
  console.log("");
  console.log(`[build-whisper] whisper-server is in ${where}. Restart 'yarn dev', then enable voice input in Settings → Voice (the model downloads on first enable).`);
}

main();
