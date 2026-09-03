// Launcher ↔ root package.json sync check (#1920).
//
// The launcher `packages/mulmoclaude/package.json` is the published
// npm metadata; the root `package.json` is the yarn-workspace
// dev/build baseline. Both list runtime deps (`gui-chat-protocol`,
// `firebase`, `express`, all `@mulmoclaude/*` plugins, …). Yarn
// workspaces symlink the launcher into `node_modules/mulmoclaude`
// so local dev never touches the launcher's dep field — a drift
// between the two only manifests at `npx mulmoclaude` time on a
// user's machine (#1920: launcher pinned `gui-chat-protocol@0.4.0`
// but bundled `@mulmoclaude/form-plugin@^0.1.0` had peer dep
// `^0.3.0`, silently overridden at install, handshake fails at
// runtime).
//
// This check enforces two invariants at PR time:
//
//   1. Any dep listed in BOTH the launcher and the root MUST have
//      the same version range in both. Bumping `gui-chat-protocol`
//      in root without bumping it in the launcher (or vice versa)
//      fails the check.
//
//   2. Every launcher dep pointing at a workspace package
//      (`@mulmoclaude/*`, `@mulmobridge/*`) MUST have a semver range
//      that is satisfied by the workspace's current `package.json`
//      version. A range like `^0.1.0` when the workspace source is
//      `0.1.4` still satisfies (npm resolves to `0.1.3` published);
//      a range like `^0.1.0` when workspace is `0.2.0` fails —
//      indicates a published-vs-source drift.
//
//   3. Every workspace-plugin bundle target in the launcher (any
//      `@mulmoclaude/*-plugin`) MUST have a `peerDependencies` entry
//      for each peer dep the launcher pins — with a range that is
//      SATISFIED by the launcher's pinned version. This is the
//      #1920 anti-regression: peer dep `gui-chat-protocol@^0.3.0`
//      vs launcher `0.4.0` → fail.
//
// Runs in <100ms on this repo (no I/O beyond package.json reads).
// No network. Node built-ins only so it works on a fresh clone.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT_DEFAULT = process.cwd();
const LAUNCHER_REL = "packages/mulmoclaude/package.json";
const WORKSPACE_DIRS = ["packages", "packages/plugins", "packages/bridges", "packages/services"];

// Peer deps where a lockstep (major.minor match) is enforced, not just
// "satisfies launcher pin". A protocol contract like gui-chat-protocol has
// semantic version boundaries that map to actual runtime handshake behaviour
// — plugin peers are considered a source-of-truth for "what protocol version
// this plugin was BUILT against", so a stale peer here is a real drift even if
// runtime happens to still work. Non-protocol peers (zod, vue, express) are
// intentionally kept wide by plugin authors and are only checked via the
// looser `peer-dep-violation` invariant.
const LOCKSTEP_PEER_DEPS = new Set(["gui-chat-protocol"]);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

// Walk the yarn-workspace directories and return a map from package
// name → { version, packageJsonPath, peerDependencies }. Skips dirs
// without a package.json.
export async function loadWorkspacePackages({ root = REPO_ROOT_DEFAULT } = {}) {
  const registry = new Map();
  for (const dir of WORKSPACE_DIRS) {
    const parent = path.join(root, dir);
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(parent, entry.name, "package.json");
      let pkg;
      try {
        pkg = await readJson(pkgPath);
      } catch {
        continue;
      }
      if (typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
      registry.set(pkg.name, {
        name: pkg.name,
        version: pkg.version,
        packageJsonPath: pkgPath,
        peerDependencies: pkg.peerDependencies ?? {},
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      });
    }
  }
  return registry;
}

// Parse a semver range's lower bound into [major, minor, patch].
// Handles the subset the launcher actually uses: exact ("0.4.0"),
// caret ("^0.4.0"), tilde ("~0.4.0"), and ">=" ("^0.5.0"-style is
// enough). Returns null for anything unrecognised so the caller can
// skip that entry with a clear reason (URLs, git deps, "*", "next").
function parseLowerBound(range) {
  if (typeof range !== "string") return null;
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed.includes(":") || trimmed.startsWith("workspace")) return null;
  const match = trimmed.match(/^[\^~>=]*\s*(\d+)\.(\d+)\.(\d+)(?:[-+][\w.]*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// The version a range pins to, comparator removed and nothing else
// normalised — `^4.8.0-beta.1` → `4.8.0-beta.1`.
function stripComparator(range) {
  return String(range)
    .trim()
    .replace(/^[\^~>=]*\s*/, "");
}

function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][\w.]*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Returns true when `version` satisfies `range` under caret / tilde /
// exact semantics — the only forms the launcher and workspace pkgs
// actually use. Everything else returns null (skip with reason).
export function satisfies(version, range) {
  const v = parseVersion(version);
  const lb = parseLowerBound(range);
  if (!v || !lb) return null;
  const trimmed = range.trim();
  if (trimmed.startsWith("^")) {
    // ^0.0.x → exact; ^0.y.z → allow minor/patch increases within 0.y; ^x.y.z → allow within x
    if (lb[0] === 0 && lb[1] === 0) return v[0] === 0 && v[1] === 0 && v[2] === lb[2];
    if (lb[0] === 0) return v[0] === 0 && v[1] === lb[1] && (v[2] > lb[2] || v[2] === lb[2]);
    return v[0] === lb[0] && (v[1] > lb[1] || (v[1] === lb[1] && v[2] >= lb[2]));
  }
  if (trimmed.startsWith("~")) {
    return v[0] === lb[0] && v[1] === lb[1] && v[2] >= lb[2];
  }
  if (trimmed.startsWith(">=")) {
    for (let i = 0; i < 3; i++) {
      if (v[i] > lb[i]) return true;
      if (v[i] < lb[i]) return false;
    }
    return true;
  }
  return v[0] === lb[0] && v[1] === lb[1] && v[2] === lb[2];
}

// Every field a manifest can declare an internal dep in. A stale range
// is equally wrong in all three: `dependencies` ships it, `peer` states
// what the host must provide, and `dev` is what the package built and
// tested against.
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

// Invariant 6 applies to every manifest EXCEPT the launcher's
// `dependencies`, which invariant 4 already owns — reporting the same
// drift twice would make one bad release look like two problems.
function isOwnedByInvariant4(manifestPath, field, launcherPath) {
  return manifestPath === launcherPath && field === "dependencies";
}

// One consumer edge: a manifest declaring a range on a workspace
// package. The range's lower bound MUST equal that workspace's current
// version, for the same reason invariant 4 exists — a caret does not
// float a consumer forward, it pins it to the lower bound, so a stale
// range withholds every release since from anyone installing it.
function checkConsumerEdge({ relPath, field, depName, range, workspaceVersion }) {
  const lower = parseLowerBound(range);
  const source = parseVersion(workspaceVersion);
  if (!lower || !source) {
    return { kind: "skipped", message: `${relPath}: ${field}."${depName}"="${range}" unparseable — cannot verify vs workspace ${workspaceVersion}` };
  }
  // Compare the FULL lower bound, prerelease and build metadata included —
  // only the comparator is stripped. Comparing parsed numeric triples instead
  // is wrong in both directions: against the raw version string a correctly
  // swept `^4.8.0-beta.1` reads as drift and blocks its own release commit,
  // and against another triple `^4.8.0-beta.1` passes for a workspace already
  // at `4.8.0-beta.2`, which is the stale range this invariant exists to find.
  if (stripComparator(range) === workspaceVersion.trim()) return null;
  return {
    kind: "consumer-lockstep",
    message: `${relPath}: ${field}."${depName}"="${range}" (lower bound ${lower.join(".")}) is behind workspace source ${workspaceVersion} — sweep this range too`,
  };
}

// Invariant 6: EVERY workspace manifest tracks its internal deps, not
// just the launcher. `launcherSync` used to check the launcher alone, so
// a release that bumped a package and swept only the launcher left every
// plugin's peer/dev range silently stale — 14 such declarations went
// unreported while the gate showed a single finding (#3037 / #3038).
export function auditConsumerLockstep({ root, rootPkg, workspaces }) {
  const launcherPath = path.join(root, LAUNCHER_REL);
  const manifests = [{ manifestPath: path.join(root, "package.json"), pkg: rootPkg }];
  for (const ws of workspaces.values()) {
    manifests.push({ manifestPath: ws.packageJsonPath, pkg: ws });
  }
  const findings = [];
  for (const { manifestPath, pkg } of manifests) {
    const relPath = path.relative(root, manifestPath) || "package.json";
    for (const field of DEP_FIELDS) {
      if (isOwnedByInvariant4(manifestPath, field, launcherPath)) continue;
      for (const [depName, range] of Object.entries(pkg[field] ?? {})) {
        const target = workspaces.get(depName);
        if (!target || depName === pkg.name) continue;
        const finding = checkConsumerEdge({ relPath, field, depName, range, workspaceVersion: target.version });
        if (finding) findings.push(finding);
      }
    }
  }
  return findings;
}

// Emit findings; each finding = { kind, message } and the caller
// decides fail vs warn. Kinds:
//   root-launcher-mismatch  invariant 1 — root ↔ launcher common dep range identical
//   workspace-source-drift  invariant 2 — workspace source satisfies launcher range
//   peer-dep-violation      invariant 3 (#1920) — plugin peer dep satisfied by launcher pin
//   workspace-lockstep      invariant 4 — launcher range lower bound == workspace source (strict ratchet)
//   peer-dep-lockstep       invariant 5 — plugin peer dep lower bound major.minor == launcher pin major.minor
//   consumer-lockstep       invariant 6 — EVERY manifest's internal dep range lower bound == workspace source
//   skipped                 range unparseable → surface for triage
export async function auditLauncherSync({ root = REPO_ROOT_DEFAULT } = {}) {
  const rootPkg = await readJson(path.join(root, "package.json"));
  const launcherPkg = await readJson(path.join(root, LAUNCHER_REL));
  const workspaces = await loadWorkspacePackages({ root });
  const findings = [];

  const rootDeps = { ...(rootPkg.dependencies ?? {}), ...(rootPkg.devDependencies ?? {}) };
  const launcherDeps = launcherPkg.dependencies ?? {};

  // Invariant 1: common dep must have the same range.
  for (const [name, launcherRange] of Object.entries(launcherDeps)) {
    if (!(name in rootDeps)) continue;
    const rootRange = rootDeps[name];
    if (rootRange !== launcherRange) {
      findings.push({
        kind: "root-launcher-mismatch",
        message: `${name}: root=${rootRange} vs launcher=${launcherRange} — bump both in lockstep`,
      });
    }
  }

  // Invariant 2: workspace-source dep must satisfy launcher range.
  // Invariant 4: launcher range lower bound MUST equal workspace source (strict
  // ratchet). If a workspace pkg bumps from 0.1.4 → 0.1.5 without a matching
  // launcher `^0.1.5` bump, npm still resolves the OLDER 0.1.4 for consumers of
  // `mulmoclaude` (since `^0.1.4` accepts 0.1.4 as its lower bound). The strict
  // ratchet forces the launcher to move in lockstep with the workspace so the
  // published tarball always references the newest source.
  for (const [name, launcherRange] of Object.entries(launcherDeps)) {
    const ws = workspaces.get(name);
    if (!ws) continue;
    const result = satisfies(ws.version, launcherRange);
    if (result === null) {
      findings.push({
        kind: "skipped",
        message: `${name}: unparseable range "${launcherRange}" — cannot verify workspace source ${ws.version}`,
      });
      continue;
    }
    if (!result) {
      findings.push({
        kind: "workspace-source-drift",
        message: `${name}: workspace source ${ws.version} does not satisfy launcher range "${launcherRange}" — bump launcher`,
      });
      continue;
    }
    const launcherLower = parseLowerBound(launcherRange);
    if (!launcherLower) continue;
    const wsVersion = parseVersion(ws.version);
    if (!wsVersion) continue;
    if (wsVersion[0] !== launcherLower[0] || wsVersion[1] !== launcherLower[1] || wsVersion[2] !== launcherLower[2]) {
      findings.push({
        kind: "workspace-lockstep",
        message: `${name}: workspace source ${ws.version} is ahead of launcher range "${launcherRange}" (lower bound ${launcherLower.join(".")}) — bump the launcher range to match`,
      });
    }
  }

  // Invariant 3: bundle-target plugin peer deps vs launcher pins (#1920 anti-regression).
  for (const [name] of Object.entries(launcherDeps)) {
    const ws = workspaces.get(name);
    if (!ws) continue;
    if (!name.startsWith("@mulmoclaude/") || !name.endsWith("-plugin")) continue;
    for (const [peerName, peerRange] of Object.entries(ws.peerDependencies)) {
      const launcherPeerRange = launcherDeps[peerName];
      if (typeof launcherPeerRange !== "string") continue;
      const launcherLower = parseLowerBound(launcherPeerRange);
      if (!launcherLower) continue;
      const launcherPinVersion = launcherLower.join(".");
      const ok = satisfies(launcherPinVersion, peerRange);
      if (ok === null) {
        findings.push({
          kind: "skipped",
          message: `${name}: peer "${peerName}"="${peerRange}" unparseable — cannot verify vs launcher "${launcherPeerRange}"`,
        });
        continue;
      }
      if (!ok) {
        findings.push({
          kind: "peer-dep-violation",
          message: `${name}: peerDependency "${peerName}"="${peerRange}" is NOT satisfied by launcher pin "${launcherPeerRange}" — bump the plugin's peer range`,
        });
        continue;
      }
      // Invariant 5: for protocol-critical peer deps (LOCKSTEP_PEER_DEPS —
      // currently just gui-chat-protocol), plugin peer major.minor MUST equal
      // launcher pin major.minor. Satisfying alone (e.g. peer `^0.4.0` vs
      // launcher `0.5.0`) leaves the plugin published against an OUTDATED
      // protocol contract even if runtime happens to work. This is the direct
      // enforcement of the user's "gui-chat-protocol update 時に必ず依存追従"
      // requirement. Non-protocol peers (zod, vue, express) are kept wide by
      // convention and checked only by the looser `peer-dep-violation` rule.
      if (!LOCKSTEP_PEER_DEPS.has(peerName)) continue;
      const peerLower = parseLowerBound(peerRange);
      if (!peerLower) continue;
      if (peerLower[0] !== launcherLower[0] || peerLower[1] !== launcherLower[1]) {
        findings.push({
          kind: "peer-dep-lockstep",
          message: `${name}: peerDependency "${peerName}"="${peerRange}" (lower bound ${peerLower.join(".")}) does not match launcher pin "${launcherPeerRange}" major.minor (${launcherLower[0]}.${launcherLower[1]}) — bump the plugin's peer range in lockstep with the launcher`,
        });
      }
    }
  }

  findings.push(...auditConsumerLockstep({ root, rootPkg, workspaces }));

  return findings;
}

export async function main() {
  const findings = await auditLauncherSync();
  const failing = findings.filter((f) => f.kind !== "skipped");
  const skipped = findings.filter((f) => f.kind === "skipped");
  if (failing.length === 0 && skipped.length === 0) {
    console.log("[mulmoclaude:launcher-sync] OK — root ↔ launcher ↔ every workspace in sync, no peer-dep violations.");
    return 0;
  }
  for (const finding of failing) {
    console.error(`  ✗ [${finding.kind}] ${finding.message}`);
  }
  for (const finding of skipped) {
    console.error(`  · [skipped] ${finding.message}`);
  }
  if (failing.length === 0) {
    console.log("");
    console.log("[mulmoclaude:launcher-sync] OK — some entries could not be parsed (see · lines above).");
    return 0;
  }
  console.error("");
  console.error(`[mulmoclaude:launcher-sync] ${failing.length} failing finding(s).`);
  console.error("Bring root package.json, packages/mulmoclaude/package.json, and EVERY workspace's");
  console.error("dependencies / devDependencies / peerDependencies into sync before merging.");
  console.error("See #1920 for the original class of bug, and #3037 / #3038 for the releases that");
  console.error("swept only the launcher and left 14 plugin declarations stale.");
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await main();
  process.exit(code);
}
