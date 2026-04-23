// MulmoClaude publish smoke — driver for the three publish-prep
// checks in `.claude/skills/publish-mulmoclaude/SKILL.md` (§1 deps
// audit, §2 workspace drift, §4 tarball boot). This is what the
// CI workflow (plan step 5) will invoke on every PR.
//
// Sequential + fail-fast: if §1 detects a missing dep there's no
// point paying the 30+ seconds to pack + install + boot. Each
// stage gets its own summary line so the GitHub Actions log reads
// top-to-bottom like a checklist.
//
// Stage implementations are injectable so the orchestration can be
// unit-tested without spawning npm or opening a socket. The
// defaults point at the real three modules; tests swap them out.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { auditServerDeps } from "./deps.mjs";
import { checkWorkspaceDrift } from "./drift.mjs";
import { runTarballSmoke } from "./tarball.mjs";

// Verdict shape returned per stage. Callers (including tests) only
// need `ok` and `summary` — the `details` bag carries stage-specific
// diagnostics for the final report.
function passed(summary, details = {}) {
  return { ok: true, summary, details };
}

function failed(summary, details = {}) {
  return { ok: false, summary, details };
}

// §1 wrapper — auditServerDeps returns missing package names.
async function runDepsStage({ root, auditFn }) {
  const missing = await auditFn({ root });
  if (missing.length === 0) {
    return passed("no missing dependencies");
  }
  return failed(`${missing.length} missing dependency(ies)`, { missing });
}

// §2 wrapper — checkWorkspaceDrift returns one result per auto-
// detected bridge. Status is one of "ok" | "drifted" | "skipped".
async function runDriftStage({ root, driftFn }) {
  const results = await driftFn({ root });
  const drifted = results.filter((row) => row.status === "drifted");
  if (drifted.length === 0) {
    const skipped = results.filter((row) => row.status === "skipped").length;
    const okCount = results.filter((row) => row.status === "ok").length;
    return passed(`${okCount} package(s) ok, ${skipped} skipped`, { results });
  }
  return failed(
    `${drifted.length} package(s) drifted`,
    { results, drifted: drifted.map((row) => row.packageBaseName) },
  );
}

// §4 wrapper — runTarballSmoke is the expensive one. It returns a
// result object (never throws), so we just fold its ok flag into
// the driver's verdict.
async function runTarballStage({ root, tarballFn, tarballOptions }) {
  const result = await tarballFn({ root, ...(tarballOptions ?? {}) });
  if (result.ok) {
    return passed(
      `HTTP 200 on port ${result.port} after ${result.attempts} attempt(s) (${result.elapsedMs}ms)`,
      { workDir: result.workDir, logFile: result.logFile, tarballPath: result.tarballPath },
    );
  }
  return failed(result.lastError ?? "tarball smoke failed", {
    workDir: result.workDir,
    logFile: result.logFile,
    tarballPath: result.tarballPath,
  });
}

// Run all three stages fail-fast. Returns `{ ok, stages: [{name, ok, summary, details}] }`.
export async function runSmoke({
  root = process.cwd(),
  auditFn = auditServerDeps,
  driftFn = checkWorkspaceDrift,
  tarballFn = runTarballSmoke,
  tarballOptions,
  skipTarball = false,
} = {}) {
  const stages = [];

  const deps = await runDepsStage({ root, auditFn });
  stages.push({ name: "deps", ...deps });
  if (!deps.ok) return { ok: false, stages };

  const drift = await runDriftStage({ root, driftFn });
  stages.push({ name: "drift", ...drift });
  if (!drift.ok) return { ok: false, stages };

  // `skipTarball` lets the unit test (and any caller that wants the
  // cheap checks only) bypass the 30-60s npm pack + install step.
  if (skipTarball) {
    return { ok: true, stages };
  }
  const tarball = await runTarballStage({ root, tarballFn, tarballOptions });
  stages.push({ name: "tarball", ...tarball });
  return { ok: tarball.ok, stages };
}

function formatStageLine(stage) {
  const mark = stage.ok ? "✓" : "✗";
  return `${mark} ${stage.name.padEnd(8)} ${stage.summary}`;
}

export async function main({ skipTarball = false } = {}) {
  // SKIP_TARBALL=1 is primarily for local runs where `yarn build`
  // hasn't produced a launchable dist yet, or for debugging the
  // deps/drift stages in isolation.
  const effectiveSkip = skipTarball || process.env.MULMOCLAUDE_SMOKE_SKIP_TARBALL === "1";
  const result = await runSmoke({ skipTarball: effectiveSkip });
  console.log("[mulmoclaude:smoke] stages:");
  for (const stage of result.stages) console.log(`  ${formatStageLine(stage)}`);

  if (!result.ok) {
    const failingStage = result.stages.find((stage) => !stage.ok);
    console.error(`\n[mulmoclaude:smoke] FAIL at stage: ${failingStage?.name ?? "(unknown)"}`);
    if (failingStage?.details) {
      // Pretty-print the details bag so the CI log has the list of
      // missing packages / drifted packages / tarball log path
      // without needing artifact download to diagnose.
      console.error(JSON.stringify(failingStage.details, null, 2));
    }
    console.error("\nSee .claude/skills/publish-mulmoclaude/SKILL.md for the per-stage fix-up flow.");
    return 1;
  }

  console.log("\n[mulmoclaude:smoke] OK — ready to publish (humans still do that bit).");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await main();
  process.exit(code);
}
