import { appendFile } from "fs/promises";
import path from "path";
import type {
  ConsoleSinkConfig,
  FileSinkConfig,
  TelemetrySinkConfig,
} from "./config.js";
import { formatJson, formatText } from "./formatters.js";
import { dailyFileName, enforceMaxFiles, ensureDir } from "./rotation.js";
import type { Formatter, LogRecord, Sink } from "./types.js";

function pickFormatter(kind: "text" | "json"): Formatter {
  return kind === "json" ? formatJson : formatText;
}

export function createConsoleSink(config: ConsoleSinkConfig): Sink {
  const fmt = pickFormatter(config.format);
  return {
    name: "console",
    level: config.level,
    write(record: LogRecord) {
      const line = fmt(record) + "\n";
      const stream =
        record.level === "error" || record.level === "warn"
          ? process.stderr
          : process.stdout;
      stream.write(line);
    },
  };
}

export interface FileSinkDeps {
  now?: () => Date;
  writeLine?: (filePath: string, line: string) => Promise<void>;
  onError?: (err: unknown) => void;
}

// Factory for the rotating file sink. `deps` is only used by tests to
// inject a fake clock and an in-memory writer.
export function createFileSink(
  config: FileSinkConfig,
  deps: FileSinkDeps = {},
): Sink {
  const now = deps.now ?? (() => new Date());
  const writeLine =
    deps.writeLine ??
    ((p: string, line: string) => appendFile(p, line, "utf-8"));
  const onError =
    deps.onError ??
    ((err: unknown) => {
      // Fallback — never throw back into the caller.
      console.error("[logger] file sink error:", err);
    });

  const fmt = pickFormatter(config.format);
  let currentDateKey = "";
  let currentPath = "";
  // Per-sink write queue: chains all pending I/O so rotations can't
  // interleave with a previous write.
  let queue: Promise<void> = Promise.resolve();

  function enqueue(op: () => Promise<void>): void {
    queue = queue.then(op).catch(onError);
  }

  function dateKey(d: Date): string {
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  }

  function maybeRotate(ts: Date): boolean {
    const key = dateKey(ts);
    if (key === currentDateKey) return false;
    currentDateKey = key;
    currentPath = path.join(config.dir, dailyFileName(ts));
    enqueue(async () => {
      await ensureDir(config.dir);
    });
    return true;
  }

  return {
    name: "file",
    level: config.level,
    write(record: LogRecord) {
      const ts = now();
      const rotated = maybeRotate(ts);
      const line = fmt(record) + "\n";
      const filePath = currentPath;
      enqueue(() => writeLine(filePath, line));
      // Enforce retention AFTER the write so maxFiles counts include
      // the file we just touched. Enforcing before rotation would
      // leave N-1 existing files plus the fresh one (off-by-one).
      if (rotated) {
        enqueue(() => enforceMaxFiles(config.dir, config.rotation.maxFiles));
      }
    },
    flush() {
      return queue;
    },
  };
}

// Telemetry sink is a placeholder for a future remote-shipping
// implementation. Keeping the interface here so wiring is ready.
export function createTelemetrySink(config: TelemetrySinkConfig): Sink {
  return {
    name: "telemetry",
    level: config.level,
    write(__record: LogRecord) {
      // no-op until a transport is added
    },
  };
}
