// Canonical logger interface family. Lives in this zero-dep leaf — the only
// tier the host, @mulmoclaude/core domains, and plugins can all reach — so each
// consumer aliases ONE declaration (`export type CollectionLogger =
// StructuredLogger`) instead of re-declaring the shape: structural typing keeps
// every alias's public name and d.ts surface identical to a re-declaration.

/** 4-method host-logger shape — `(prefix, message, data?)`. */
export interface StructuredLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

/** 3-method pre-namespaced logger — `(message, data?)`; the logging package
 *  binds its own prefix, so hosts only supply the transport. */
export interface MinimalLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}
