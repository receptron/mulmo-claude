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
      // A manifest with no name cannot be referenced, so it is genuinely not a
      // workspace. A BAD VERSION is different: dropping it here removed every
      // consumer edge pointing at it from the audit, so a workspace with
      // `version: 47` silently exempted all of its consumers. Keep it and let
      // the invariants report it.
      if (typeof pkg.name !== "string") continue;
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

// A full SemVer tail: an OPTIONAL prerelease and an OPTIONAL build, in that
// order. The earlier `(?:[-+][\w.]*)?` allowed one or the other, so a valid
// `4.8.0-beta.2+build.9` failed to parse — and an unparseable version yields a
// `skipped` finding, which `main()` excludes from failure. A stale range
// against such a version therefore walked straight through the gate.
// SemVer 2.0.0, spelled out rather than approximated. `\d+` and `[\w.-]`
// were close enough to look right and wrong where it counts: they accept
// `04.7.0`, `4.7.0-01` and `4.7.0-beta_1`, all of which npm rejects — so a
// declaration npm cannot resolve compared equal to its workspace and the
// gate reported nothing. Numeric identifiers carry no leading zero;
// prerelease identifiers are alphanumeric-or-hyphen (no `_`); build
// metadata is the same set but may keep leading zeros.
const NUM_ID = String.raw`0|[1-9]\d*`;
const PRE_ID = String.raw`(?:${NUM_ID}|\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const BUILD_ID = String.raw`[0-9a-zA-Z-]+`;
const SEMVER_CORE = String.raw`(${NUM_ID})\.(${NUM_ID})\.(${NUM_ID})(?:-${PRE_ID}(?:\.${PRE_ID})*)?(?:\+${BUILD_ID}(?:\.${BUILD_ID})*)?`;
const SEMVER_RE = new RegExp(`^${SEMVER_CORE}$`);
// Only the comparators `satisfies()` below can actually evaluate. The old
// `[\^~>=]*` accepted any repetition or mixture, so `====4.7.0` and `>4.7.0`
// both read as lower bound 4.7.0 — the first is not a range npm accepts at
// all, and the second EXCLUDES 4.7.0. Both compared equal to a workspace at
// 4.7.0 and produced no finding.
const COMPARATOR = String.raw`(?:\^|~|>=)?\s*`;
const SEMVER_TAIL_RE = new RegExp(`^${COMPARATOR}${SEMVER_CORE}$`);
const COMPARATOR_PREFIX_RE = new RegExp(`^${COMPARATOR}`);

// Parse a semver range's lower bound into [major, minor, patch].
// Handles the subset the launcher actually uses: exact ("0.4.0"),
// caret ("^0.4.0"), tilde ("~0.4.0"), and ">=" ("^0.5.0"-style is
// enough). Returns null for anything unrecognised so the caller can
// skip that entry with a clear reason (URLs, git deps, "*", "next").
// `main()` drops skipped findings from the failure count, so routing an input
// to `skipped` approves it. That makes the set deliberately CLOSED: a
// specifier is skipped only when npm resolves it by a route that names no
// version — the `*` wildcard, or a scheme-prefixed specifier (`workspace:`,
// `npm:`, `file:`, `git+ssh:`, an https tarball). Anything else that fails to
// parse is a malformed declaration and must FAIL, not slip through the same
// door. Stating the rule this way rather than listing bad inputs is what
// keeps `""`, `"workspacefoo"` and a non-string value out of it.
// An ALLOW-LIST, not a pattern. `^[a-z][a-z0-9+.-]*:` looked like the same
// idea and was not: it matched any word followed by a colon, so
// `totally-invalid:4.6.0` was classified as a versionless route and skipped.
// The protocols are a finite set the package managers define, so name them;
// the malformed inputs are infinite, so never try to name those.
const VERSIONLESS_PROTOCOLS = new Set([
  "workspace",
  "npm",
  "file",
  "link",
  "portal",
  "patch",
  "git",
  "git+ssh",
  "git+http",
  "git+https",
  "git+file",
  "http",
  "https",
  "github",
  "gitlab",
  "bitbucket",
]);

// `workspace:` is the one protocol that MAY carry a range of its own.
// `workspace:*`, `workspace:^` and `workspace:~` are the versionless forms —
// the package manager substitutes the local version at publish time. But
// `workspace:^4.6.0` states a lower bound like any other range, and skipping
// it let a stale internal dependency through. Unwrap the prefix and let the
// normal path judge what follows.
const WORKSPACE_PREFIX = "workspace:";
const VERSIONLESS_WORKSPACE_FORMS = new Set(["*", "^", "~"]);

function unwrapWorkspaceProtocol(range) {
  if (typeof range !== "string") return range;
  const trimmed = range.trim();
  if (!trimmed.toLowerCase().startsWith(WORKSPACE_PREFIX)) return trimmed;
  const inner = trimmed.slice(WORKSPACE_PREFIX.length);
  return VERSIONLESS_WORKSPACE_FORMS.has(inner) ? "*" : inner;
}

function isVersionlessSpecifier(range) {
  if (typeof range !== "string") return false;
  const trimmed = range.trim();
  if (trimmed === "*") return true;
  const colon = trimmed.indexOf(":");
  return colon > 0 && VERSIONLESS_PROTOCOLS.has(trimmed.slice(0, colon).toLowerCase());
}

function parseLowerBound(range) {
  if (typeof range !== "string" || isVersionlessSpecifier(range)) return null;
  const trimmed = range.trim();
  const match = trimmed.match(SEMVER_TAIL_RE);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// The version a range pins to, in the form two of them can be compared in:
// comparator removed and build metadata dropped, prerelease kept —
// `^4.8.0-beta.1+build.2` → `4.8.0-beta.1`. Build metadata is excluded from
// SemVer precedence, so two versions differing only there are the same release
// and must not read as drift; prerelease IS part of precedence, so it stays.
function comparableVersion(value) {
  return String(value)
    .trim()
    .replace(COMPARATOR_PREFIX_RE, "")
    .replace(/\+[\w.-]+$/, "");
}

function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.trim().match(SEMVER_RE);
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

// Invariant 4 owns the LOCKSTEP COMPARISON for the launcher's own
// `dependencies` — reporting that drift twice would make one bad release read
// as two problems. It does NOT own the strict checks: invariant 4 turns a
// malformed range or an invalid workspace version into `skipped`, which
// `main()` excludes from failure, so exempting the launcher outright left the
// closed gate open for exactly the manifest the launcher owns.
function isLockstepOwnedByInvariant4(manifestPath, field, launcherPath) {
  return manifestPath === launcherPath && field === "dependencies";
}

// The findings invariant 4 cannot produce, and therefore must not be dropped
// with it.
const STRICT_KINDS = new Set(["unsupported-range", "invalid-workspace-version"]);

// One consumer edge: a manifest declaring a range on a workspace
// package. The range's lower bound MUST equal that workspace's current
// version, for the same reason invariant 4 exists — a caret does not
// float a consumer forward, it pins it to the lower bound, so a stale
// range withholds every release since from anyone installing it.
function checkConsumerEdge({ relPath, field, depName, range, workspaceVersion }) {
  const source = parseVersion(workspaceVersion);
  if (!source) {
    // Not the consumer's fault, and NOT skippable: one malformed version in a
    // workspace's own package.json would otherwise disable this invariant for
    // every consumer of that workspace at once.
    return {
      kind: "invalid-workspace-version",
      message: `${relPath}: ${field}."${depName}" points at workspace ${depName}, whose own version "${workspaceVersion}" is not valid SemVer — no consumer of it can be verified`,
    };
  }
  const specifier = unwrapWorkspaceProtocol(range);
  if (isVersionlessSpecifier(specifier)) {
    return {
      kind: "skipped",
      message: `${relPath}: ${field}."${depName}"="${range}" resolves by a route that names no version — nothing to compare against workspace ${workspaceVersion}`,
    };
  }
  const lower = parseLowerBound(specifier);
  if (!lower) {
    return {
      kind: "unsupported-range",
      message: `${relPath}: ${field}."${depName}"=${JSON.stringify(range)} is not a range this gate can evaluate — use an exact version, ^, ~ or >=`,
    };
  }
  // Compare the whole lower bound, not parsed numeric triples — those are wrong
  // in both directions: against the raw version string a correctly swept
  // `^4.8.0-beta.1` reads as drift and blocks its own release commit, and
  // against another triple `^4.8.0-beta.1` passes for a workspace already at
  // `4.8.0-beta.2`, the stale range this invariant exists to find.
  if (comparableVersion(specifier) === comparableVersion(workspaceVersion)) return null;
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
      const lockstepOwnedElsewhere = isLockstepOwnedByInvariant4(manifestPath, field, launcherPath);
      for (const [depName, range] of Object.entries(pkg[field] ?? {})) {
        const target = workspaces.get(depName);
        if (!target || depName === pkg.name) continue;
        const finding = checkConsumerEdge({ relPath, field, depName, range, workspaceVersion: target.version });
        if (!finding) continue;
        if (lockstepOwnedElsewhere && !STRICT_KINDS.has(finding.kind)) continue;
        findings.push(finding);
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
//   unsupported-range       invariant 6 — an internal dep range this gate cannot evaluate (fails, never skips)
//   invalid-workspace-version invariant 6 — a workspace's own version is not SemVer (fails; it blinds every consumer)
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
