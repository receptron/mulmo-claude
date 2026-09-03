// Type sidecar for launcherSync.mjs — matches the deps/drift convention
// so the script stays plain JS while consumers (tests + workflow) still
// have a typed import surface.

export interface WorkspacePackage {
  name: string;
  version: string;
  packageJsonPath: string;
  peerDependencies: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export type FindingKind =
  "root-launcher-mismatch" | "workspace-source-drift" | "workspace-lockstep" | "peer-dep-violation" | "peer-dep-lockstep" | "consumer-lockstep" | "skipped";

export interface Finding {
  kind: FindingKind;
  message: string;
}

export interface AuditOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  root?: string;
}

export function loadWorkspacePackages(options?: AuditOptions): Promise<Map<string, WorkspacePackage>>;

/** True/false when the range/version pair is parseable and evaluable; null when either is unparseable. */
export function satisfies(version: string, range: string): boolean | null;

export function auditLauncherSync(options?: AuditOptions): Promise<Finding[]>;

/** Invariant 6: every manifest's internal dep ranges vs the workspace source. */
export function auditConsumerLockstep(input: { root: string; rootPkg: Record<string, unknown>; workspaces: Map<string, WorkspacePackage> }): Finding[];

/** CLI entry point. Returns 0 clean, 1 if any non-skipped finding present. */
export function main(): Promise<number>;
