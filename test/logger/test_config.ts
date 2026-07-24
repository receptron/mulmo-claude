import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, resolveConfig } from "../../server/system/logger/config.js";

describe("resolveConfig", () => {
  it("returns defaults when env is empty", () => {
    const config = resolveConfig({});
    assert.deepEqual(config, DEFAULT_CONFIG);
  });

  it("applies LOG_LEVEL to both console and file levels", () => {
    const config = resolveConfig({ LOG_LEVEL: "debug" });
    assert.equal(config.sinks.console.level, "debug");
    assert.equal(config.sinks.file.level, "debug");
  });

  it("per-sink levels override the coarse LOG_LEVEL", () => {
    const config = resolveConfig({
      LOG_LEVEL: "debug",
      LOG_CONSOLE_LEVEL: "warn",
    });
    assert.equal(config.sinks.console.level, "warn");
    assert.equal(config.sinks.file.level, "debug");
  });

  it("ignores invalid level and falls back to default", () => {
    const config = resolveConfig({ LOG_LEVEL: "chatty" });
    assert.equal(config.sinks.console.level, DEFAULT_CONFIG.sinks.console.level);
  });

  // A membership test written with `in` walks the prototype chain, so these
  // used to pass as levels. `LEVEL_PRIORITY["constructor"]` is then a function,
  // every `priority <= function` comparison is false, and the process runs with
  // every log record discarded — with no error and no way to notice (#2321).
  it("rejects a level named after an Object.prototype member", () => {
    for (const level of ["constructor", "tostring", "valueof", "hasownproperty"]) {
      const config = resolveConfig({ LOG_LEVEL: level });
      assert.equal(config.sinks.console.level, DEFAULT_CONFIG.sinks.console.level, `${level} must not be accepted`);
      assert.equal(config.sinks.file.level, DEFAULT_CONFIG.sinks.file.level, `${level} must not be accepted`);
    }
  });

  it("rejects a prototype-named level on the per-sink overrides too", () => {
    const config = resolveConfig({ LOG_CONSOLE_LEVEL: "constructor", LOG_FILE_LEVEL: "constructor", LOG_TELEMETRY_LEVEL: "constructor" });
    assert.equal(config.sinks.console.level, DEFAULT_CONFIG.sinks.console.level);
    assert.equal(config.sinks.file.level, DEFAULT_CONFIG.sinks.file.level);
    assert.equal(config.sinks.telemetry.level, DEFAULT_CONFIG.sinks.telemetry.level);
  });

  it("accepts format overrides per sink", () => {
    const config = resolveConfig({
      LOG_CONSOLE_FORMAT: "json",
      LOG_FILE_FORMAT: "text",
    });
    assert.equal(config.sinks.console.format, "json");
    assert.equal(config.sinks.file.format, "text");
  });

  it("ignores invalid format and keeps default", () => {
    const config = resolveConfig({ LOG_CONSOLE_FORMAT: "xml" });
    assert.equal(config.sinks.console.format, DEFAULT_CONFIG.sinks.console.format);
  });

  it("parses enabled flags (true/false/1/0/yes/no)", () => {
    assert.equal(resolveConfig({ LOG_FILE_ENABLED: "false" }).sinks.file.enabled, false);
    assert.equal(resolveConfig({ LOG_FILE_ENABLED: "0" }).sinks.file.enabled, false);
    assert.equal(resolveConfig({ LOG_CONSOLE_ENABLED: "no" }).sinks.console.enabled, false);
    assert.equal(resolveConfig({ LOG_CONSOLE_ENABLED: "yes" }).sinks.console.enabled, true);
  });

  it("ignores invalid enabled flag and keeps default", () => {
    const config = resolveConfig({ LOG_CONSOLE_ENABLED: "maybe" });
    assert.equal(config.sinks.console.enabled, true);
  });

  it("accepts LOG_FILE_DIR override", () => {
    const config = resolveConfig({ LOG_FILE_DIR: "/tmp/logs" });
    assert.equal(config.sinks.file.dir, "/tmp/logs");
  });

  it("accepts a positive integer for LOG_FILE_MAX_FILES", () => {
    const config = resolveConfig({ LOG_FILE_MAX_FILES: "7" });
    assert.equal(config.sinks.file.rotation.maxFiles, 7);
  });

  it("ignores non-positive or non-integer maxFiles", () => {
    assert.equal(resolveConfig({ LOG_FILE_MAX_FILES: "0" }).sinks.file.rotation.maxFiles, DEFAULT_CONFIG.sinks.file.rotation.maxFiles);
    assert.equal(resolveConfig({ LOG_FILE_MAX_FILES: "-3" }).sinks.file.rotation.maxFiles, DEFAULT_CONFIG.sinks.file.rotation.maxFiles);
    assert.equal(resolveConfig({ LOG_FILE_MAX_FILES: "abc" }).sinks.file.rotation.maxFiles, DEFAULT_CONFIG.sinks.file.rotation.maxFiles);
  });

  it("supports telemetry enabled + level override", () => {
    const config = resolveConfig({
      LOG_TELEMETRY_ENABLED: "true",
      LOG_TELEMETRY_LEVEL: "warn",
    });
    assert.equal(config.sinks.telemetry.enabled, true);
    assert.equal(config.sinks.telemetry.level, "warn");
  });
});
