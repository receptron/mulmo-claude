import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// `env` is a frozen module-level snapshot, so we re-import the
// module under different process.env states by clearing the require
// cache. Easiest in node:test land is to import via dynamic import
// with a cache-busting query string.

interface EnvSnapshot {
  env: Readonly<{
    port: number;
    nodeEnv: string;
    isProduction: boolean;
    disableSandbox: boolean;
    geminiApiKey: string | undefined;
    xBearerToken: string | undefined;
    authTokenOverride: string | undefined;
    sessionsListWindowDays: number;
    journalForceRunOnStartup: boolean;
    chatIndexForceRunOnStartup: boolean;
    mcpSessionId: string;
    mcpHost: string;
    mcpPluginNames: readonly string[];
    mcpRoleIds: readonly string[];
  }>;
  isGeminiAvailable: () => boolean;
}

let cacheBuster = 0;
async function loadEnvFresh(): Promise<EnvSnapshot> {
  cacheBuster++;
  // tsx uses esbuild's import resolver which respects query strings
  // for cache-busting. Each import returns a fresh module instance.
  const mod = await import(`../../server/system/env.ts?t=${cacheBuster}`);
  return mod as EnvSnapshot;
}

const ENV_KEYS = [
  "PORT",
  "NODE_ENV",
  "DISABLE_SANDBOX",
  "GEMINI_API_KEY",
  "X_BEARER_TOKEN",
  "MULMOCLAUDE_AUTH_TOKEN",
  "SESSIONS_LIST_WINDOW_DAYS",
  "JOURNAL_FORCE_RUN_ON_STARTUP",
  "CHAT_INDEX_FORCE_RUN_ON_STARTUP",
  "SESSION_ID",
  "MCP_HOST",
  "PLUGIN_NAMES",
  "ROLE_IDS",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("env defaults", () => {
  it("falls back to documented defaults when nothing is set", async () => {
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 3001);
    assert.equal(env.nodeEnv, "development");
    assert.equal(env.isProduction, false);
    assert.equal(env.disableSandbox, false);
    assert.equal(env.geminiApiKey, undefined);
    assert.equal(env.xBearerToken, undefined);
    assert.equal(env.authTokenOverride, undefined);
    assert.equal(env.sessionsListWindowDays, 90);
    assert.equal(env.journalForceRunOnStartup, false);
    assert.equal(env.chatIndexForceRunOnStartup, false);
    assert.equal(env.mcpSessionId, "");
    assert.equal(env.mcpHost, "localhost");
    assert.deepEqual(env.mcpPluginNames, []);
    assert.deepEqual(env.mcpRoleIds, []);
  });
});

describe("env coercion", () => {
  it("parses PORT as an integer", async () => {
    process.env.PORT = "8080";
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 8080);
  });

  it("falls back to default when PORT is non-numeric", async () => {
    process.env.PORT = "not-a-number";
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 3001);
  });

  it("falls back to default when PORT is empty string", async () => {
    process.env.PORT = "";
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 3001);
  });

  it("treats DISABLE_SANDBOX=1 as true; anything else as false", async () => {
    process.env.DISABLE_SANDBOX = "1";
    const a = await loadEnvFresh();
    assert.equal(a.env.disableSandbox, true);

    process.env.DISABLE_SANDBOX = "true";
    const b = await loadEnvFresh();
    assert.equal(b.env.disableSandbox, false, "string 'true' should not flip");

    process.env.DISABLE_SANDBOX = "0";
    const c = await loadEnvFresh();
    assert.equal(c.env.disableSandbox, false);
  });

  it("isProduction reflects NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    const { env } = await loadEnvFresh();
    assert.equal(env.nodeEnv, "production");
    assert.equal(env.isProduction, true);
  });

  it("parses CSV env vars (PLUGIN_NAMES / ROLE_IDS)", async () => {
    process.env.PLUGIN_NAMES = "a,b,c";
    process.env.ROLE_IDS = "general,office";
    const { env } = await loadEnvFresh();
    assert.deepEqual(env.mcpPluginNames, ["a", "b", "c"]);
    assert.deepEqual(env.mcpRoleIds, ["general", "office"]);
  });

  it("CSV parsing drops empty segments (so trailing commas don't yield '')", async () => {
    process.env.PLUGIN_NAMES = "a,,b,";
    const { env } = await loadEnvFresh();
    assert.deepEqual(env.mcpPluginNames, ["a", "b"]);
  });

  it("SESSIONS_LIST_WINDOW_DAYS parses to integer", async () => {
    process.env.SESSIONS_LIST_WINDOW_DAYS = "30";
    const { env } = await loadEnvFresh();
    assert.equal(env.sessionsListWindowDays, 30);
  });

  it("MULMOCLAUDE_AUTH_TOKEN is passed through verbatim when set", async () => {
    process.env.MULMOCLAUDE_AUTH_TOKEN = "pinned-value";
    const { env } = await loadEnvFresh();
    assert.equal(env.authTokenOverride, "pinned-value");
  });
});

describe("isGeminiAvailable", () => {
  it("returns false when GEMINI_API_KEY is unset", async () => {
    const { isGeminiAvailable } = await loadEnvFresh();
    assert.equal(isGeminiAvailable(), false);
  });

  it("returns false when GEMINI_API_KEY is empty string", async () => {
    process.env.GEMINI_API_KEY = "";
    const { isGeminiAvailable } = await loadEnvFresh();
    assert.equal(isGeminiAvailable(), false);
  });

  it("returns true when GEMINI_API_KEY is set to a non-empty value", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    const { isGeminiAvailable } = await loadEnvFresh();
    assert.equal(isGeminiAvailable(), true);
  });
});

describe("asInt edge cases", () => {
  it("falls back when PORT is a decimal", async () => {
    process.env.PORT = "3001.5";
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 3001);
  });

  it("falls back when PORT is negative", async () => {
    process.env.PORT = "-1";
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 3001);
  });

  it("falls back when PORT exceeds 65535", async () => {
    process.env.PORT = "70000";
    const { env } = await loadEnvFresh();
    assert.equal(env.port, 3001);
  });

  it("falls back when SESSIONS_LIST_WINDOW_DAYS is negative", async () => {
    process.env.SESSIONS_LIST_WINDOW_DAYS = "-7";
    const { env } = await loadEnvFresh();
    assert.equal(env.sessionsListWindowDays, 90);
  });
});

describe("asCsv edge cases", () => {
  it("trims surrounding whitespace from entries", async () => {
    process.env.PLUGIN_NAMES = "a, b , c";
    const { env } = await loadEnvFresh();
    assert.deepEqual(env.mcpPluginNames, ["a", "b", "c"]);
  });

  it("trims whitespace-only entries to empty and drops them", async () => {
    process.env.ROLE_IDS = " , a , , b , ";
    const { env } = await loadEnvFresh();
    assert.deepEqual(env.mcpRoleIds, ["a", "b"]);
  });
});

describe("env immutability", () => {
  it("env is frozen", async () => {
    const { env } = await loadEnvFresh();
    assert.equal(Object.isFrozen(env), true);
  });

  it("mcpPluginNames array is frozen", async () => {
    process.env.PLUGIN_NAMES = "a,b";
    const { env } = await loadEnvFresh();
    assert.equal(Object.isFrozen(env.mcpPluginNames), true);
  });

  it("mcpRoleIds array is frozen", async () => {
    process.env.ROLE_IDS = "x,y";
    const { env } = await loadEnvFresh();
    assert.equal(Object.isFrozen(env.mcpRoleIds), true);
  });
});
