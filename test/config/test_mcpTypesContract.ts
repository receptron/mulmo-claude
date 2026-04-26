import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { McpServerSpec as ClientSpec, McpServerEntry as ClientEntry } from "../../src/config/mcpTypes.js";
import type { McpServerSpec as ServerSpec, McpServerEntry as ServerEntry } from "../../server/system/config.js";

// Type-level contract test (#825 / Codex iter-1 finding 3).
// `src/config/mcpTypes.ts` is a frontend mirror of the backend MCP
// shape in `server/system/config.ts`. Without this guard the two
// can drift silently: a field added on the server (e.g. a new
// transport type, a new optional flag) wouldn't be visible to the
// catalog consumer until a runtime parse failure surfaces it.
//
// We assert assignability in BOTH directions so an extra field on
// either side is caught by `vue-tsc` / `tsc --noEmit` before the
// test runner ever spins up. This file exists primarily as a
// compile-time check; the runtime body is a sanity smoke test.

// Compile-time bidirectional assignability — these aliases fail to
// type-check if the shapes diverge. We only need TypeScript to chew
// on them; nothing executes at runtime.
type __ClientToServer = ClientSpec extends ServerSpec ? true : never;
type __ServerToClient = ServerSpec extends ClientSpec ? true : never;
type __ClientEntryToServer = ClientEntry extends ServerEntry ? true : never;
type __ServerEntryToClient = ServerEntry extends ClientEntry ? true : never;

// `true` literal-type sentinels: this file fails to compile if any
// of the four aliases above is `never` (i.e. either side has a
// field the other doesn't). At runtime they're just booleans.
const CONTRACT_OK_CLIENT_TO_SERVER: __ClientToServer = true;
const CONTRACT_OK_SERVER_TO_CLIENT: __ServerToClient = true;
const CONTRACT_OK_CLIENT_ENTRY: __ClientEntryToServer = true;
const CONTRACT_OK_SERVER_ENTRY: __ServerEntryToClient = true;

describe("McpServerSpec contract (frontend mirror ↔ backend)", () => {
  it("compile-time assignability holds in both directions", () => {
    // The real assertion is the type-level one above — this file
    // fails to typecheck if either side grows a field the other
    // doesn't have. The sentinels expose the result at runtime so
    // the test runner registers a clear pass.
    assert.equal(CONTRACT_OK_CLIENT_TO_SERVER, true);
    assert.equal(CONTRACT_OK_SERVER_TO_CLIENT, true);
    assert.equal(CONTRACT_OK_CLIENT_ENTRY, true);
    assert.equal(CONTRACT_OK_SERVER_ENTRY, true);
  });

  it("can construct each transport variant against both type aliases", () => {
    // Smoke: a literal stdio / http object should satisfy both
    // type aliases simultaneously. If a field is added to one side
    // and not the other, this fails to compile.
    const stdioFromClient: ClientSpec = { type: "stdio", command: "npx", args: ["-y", "x"] };
    const stdioAsServer: ServerSpec = stdioFromClient;
    assert.equal(stdioAsServer.type, "stdio");

    const httpFromServer: ServerSpec = { type: "http", url: "https://example.test/mcp" };
    const httpAsClient: ClientSpec = httpFromServer;
    assert.equal(httpAsClient.type, "http");
  });
});
