import { appendFile } from "fs/promises";
import path from "path";
import type { ConsoleSinkConfig, FileSinkConfig, TelemetrySinkConfig } from "./config.js";
import { formatJson, formatText, formatTextColor } from "./formatters.js";
import { dailyFileName, enforceMaxFiles, ensureDir } from "./rotation.js";
import type { Formatter, LogRecord, Sink } from "./types.js";

function pickFormatter(kind: "text" | "json"): Formatter {
  return kind === "json" ? formatJson : formatText;
}

// Decide whether to emit ANSI escapes on this stream:
//   1. `NO_COLOR=<anything>` → off, always (https://no-color.org/).
//   2. `FORCE_COLOR=<non-zero>` → on, even when the stream isn't a
//      TTY. Concurrently / yarn / npm scripts set this on child
//      processes by default, so `yarn dev` piped output keeps colour.
//      `FORCE_COLOR=0` is treated as "explicitly off".
//   3. Otherwise: on iff the stream itself is a real TTY.
function colorEnabled(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR.length > 0) return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "" && force !== "0" && force !== "false") return true;
  if (force === "0" || force === "false") return false;
  return stream.isTTY === true;
}

export function createConsoleSink(config: ConsoleSinkConfig): Sink {
  // Pre-resolve a (plain, colour) pair once. `text` may upgrade to the
  // ANSI variant per record based on which stream the record will hit;
  // `json` stays uncoloured so structured-log consumers get a clean
  // stream regardless of the terminal.
  const plain = pickFormatter(config.format);
  const colored: Formatter = config.format === "text" ? formatTextColor : plain;

  return {
    name: "console",
    level: config.level,
    write(record: LogRecord) {
      const stream = record.level === "error" || record.level === "warn" ? process.stderr : process.stdout;
      const fmt = colorEnabled(stream) ? colored : plain;
      stream.write(fmt(record) + "\n");
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
export function createFileSink(config: FileSinkConfig, deps: FileSinkDeps = {}): Sink {
  const now = deps.now ?? (() => new Date());
  const writeLine = deps.writeLine ?? ((filePath: string, line: string) => appendFile(filePath, line, "utf-8"));
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

  function enqueue(operation: () => Promise<void>): void {
    queue = queue.then(operation).catch(onError);
  }

  function dateKey(date: Date): string {
    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
  }

  function maybeRotate(currentDate: Date): boolean {
    const key = dateKey(currentDate);
    if (key === currentDateKey) return false;
    currentDateKey = key;
    currentPath = path.join(config.dir, dailyFileName(currentDate));
    enqueue(async () => {
      await ensureDir(config.dir);
    });
    return true;
  }

  return {
    name: "file",
    level: config.level,
    write(record: LogRecord) {
      const nowDate = now();
      const rotated = maybeRotate(nowDate);
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
