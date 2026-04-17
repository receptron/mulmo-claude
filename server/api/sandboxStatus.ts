// Compute the sandbox-auth snapshot exposed via GET /api/sandbox.
//
// The popup (`src/components/LockStatusPopup.vue`) consumes this to
// surface what credentials are actually attached to the Docker
// container, so users can confirm their `SANDBOX_SSH_AGENT_FORWARD` /
// `SANDBOX_MOUNT_CONFIGS` env vars took effect without grepping the
// startup log.
//
// Keep the payload **minimum**: names only, no host paths, no skip
// reasons, no unknown-entry lists. Full detail already lives in the
// server log via the `log.warn` / `log.info` calls inside
// `resolveSandboxAuth`. Exposing host paths to the browser is an
// intentional non-goal (see #329).

import {
  buildAllowedConfigMounts,
  resolveMountNames,
  sshAgentForwardArgs,
} from "../agent/sandboxMounts.js";

export interface SandboxStatus {
  /** True iff the host SSH agent socket is bound into the container. */
  sshAgent: boolean;
  /**
   * Allowlisted config mount names that actually got attached — i.e.
   * the user requested them AND the host path exists. Order preserved
   * from `SANDBOX_MOUNT_CONFIGS`.
   */
  mounts: string[];
}

export interface BuildSandboxStatusParams {
  /** Output of `setupSandbox()` — true when Docker is running AND
   *  `DISABLE_SANDBOX` is unset. When false, the builder returns null
   *  so the handler serializes an empty `{}` body. */
  sandboxEnabled: boolean;
  sshAgentForward: boolean;
  configMountNames: readonly string[];
  sshAuthSock?: string | undefined;
  home?: string;
  /** Injected for tests; defaults to `process.platform`. */
  platform?: typeof process.platform;
}

/**
 * Returns `null` when the sandbox is disabled — the caller (Express
 * handler) serializes that as `{}`, matching the agreed API contract
 * (#329). When enabled, returns the structured `{ sshAgent, mounts }`
 * snapshot.
 *
 * Pure: no logging, no side effects beyond filesystem existence
 * probes done by `resolveMountNames` (same probes the agent spawner
 * already runs per request).
 */
export function buildSandboxStatus(
  params: BuildSandboxStatusParams,
): SandboxStatus | null {
  if (!params.sandboxEnabled) return null;

  const allowed = buildAllowedConfigMounts(params.home);
  const parsed = resolveMountNames(params.configMountNames, allowed);

  const ssh = sshAgentForwardArgs(
    params.sshAgentForward,
    params.sshAuthSock,
    params.platform,
  );
  const sshAgent = ssh.args.length > 0;

  return {
    sshAgent,
    mounts: parsed.resolved.map((m) => m.name),
  };
}
