// .gitignore-aware path filtering for the Files API (#256 P2).
//
// Reads `.gitignore` files at each directory level during the tree
// walk and filters entries that match. Uses the `ignore` npm package
// which implements the full gitignore spec (negation, glob, anchoring,
// directory-only patterns, etc.).
//
// Design: the `GitignoreFilter` builds a chain of `ignore` instances
// as the walker descends. Each directory may add its own `.gitignore`
// rules on top of the parent's. The `ignores(relPath)` method tests
// the full chain so parent rules apply to children.
//
// Performance: `.gitignore` files are read synchronously during the
// walk (one readFileSync per directory that has a `.gitignore`). For
// the workspace scale (~hundreds of dirs) this is negligible. If
// profiling shows otherwise, cache the parsed ignore instances.

import fs from "fs";
import path from "path";
import ignore, { type Ignore } from "ignore";

export class GitignoreFilter {
  private rules: Ignore;

  constructor(rules?: string) {
    this.rules = ignore();
    if (rules) {
      this.rules.add(rules);
    }
  }

  /** Test whether a workspace-relative path should be hidden. */
  ignores(relPath: string): boolean {
    if (!relPath) return false;
    return this.rules.ignores(relPath);
  }

  /** Create a child filter that inherits this filter's rules and
   *  adds any `.gitignore` found in `dirAbsPath`. */
  childForDir(dirAbsPath: string): GitignoreFilter {
    const child = new GitignoreFilter();
    // Inherit parent rules
    child.rules = ignore().add(this.rules);
    // Add local .gitignore if present
    const gitignorePath = path.join(dirAbsPath, ".gitignore");
    try {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      child.rules.add(content);
    } catch {
      // No .gitignore in this directory — just inherit parent
    }
    return child;
  }
}

/**
 * Create a root filter from the workspace's `.gitignore`.
 * Returns a filter that always returns false (ignores nothing) if
 * no `.gitignore` exists at the workspace root.
 */
export function createRootFilter(workspaceRoot: string): GitignoreFilter {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  try {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    return new GitignoreFilter(content);
  } catch {
    return new GitignoreFilter();
  }
}
