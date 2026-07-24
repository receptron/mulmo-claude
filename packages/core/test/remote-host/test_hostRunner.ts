// Unit tests for the command-dispatch lookup (resolveCommandHandler):
//   - a registered method name returns its handler
//   - an unregistered method name returns undefined (→ unknown_method)
//   - proto-key regression (#2319): a method name written by an untrusted remote
//     terminal that collides with an Object.prototype member must NOT resolve to
//     an inherited function and run as if it were registered
//   - boundary: a handler legitimately registered under a proto-collision name
//     is still returned (own property wins)
//
// The lookup is extracted as a pure helper so it is tested directly, without a
// Firestore mock for processCommand.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveCommandHandler } from "../../src/remote-host/server/hostRunner.js";
import type { CommandHandlers } from "../../src/remote-host/index.js";

const handlers: CommandHandlers = {
  listCollections: () => null,
  startChat: () => null,
};

describe("resolveCommandHandler", () => {
  it("returns the handler for a registered method", () => {
    assert.equal(resolveCommandHandler(handlers, "listCollections"), handlers.listCollections);
  });

  it("returns undefined for an unregistered method", () => {
    assert.equal(resolveCommandHandler(handlers, "nope"), undefined);
  });

  for (const proto of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    it(`returns undefined for the prototype key "${proto}"`, () => {
      // A bare `handlers[proto]` would resolve to an Object.prototype member.
      assert.equal(resolveCommandHandler(handlers, proto), undefined);
    });
  }

  it("returns a handler legitimately registered under a proto-collision name (boundary)", () => {
    const ownToString: CommandHandlers["toString"] = () => "real";
    const withOwn: CommandHandlers = { ...handlers, toString: ownToString };
    assert.equal(resolveCommandHandler(withOwn, "toString"), ownToString);
  });
});
