# refactor: derive host `StartChatParams` from chat-service; use protocol `Attachment` (#2488)

## Background

Code-scanning duplication alert #173 flagged the host's `StartChatParams`
(`server/api/routes/agent.ts`) as a clone of
`packages/chat-service/src/types.ts`'s `StartChatParams`. Adversarial
re-verification of the `@package-contract` comment showed the mirror is only
mandatory in ONE direction:

- chat-service's `StartChatParams` **stays** — the package must not import
  host types (hard constraint, #269 / #305).
- The **host-side copy is not forced**: the host already depends on
  `@mulmobridge/chat-service` (`createChatService` et al.), so it can
  `extends` the package type and keep only its one extra field
  (`userTimezone?: string`).
- chat-service's local `Attachment` is field-identical to
  `@mulmobridge/protocol`'s `Attachment`, and protocol is already a declared
  runtime dependency (`^0.1.4`). The package-contract rule forbids host
  imports, not imports from legitimate package deps — so the local
  redeclaration goes too.

## Changes

1. `packages/chat-service/src/types.ts`
   - Drop the local `Attachment` interface; `import type { Attachment } from
     "@mulmobridge/protocol"` and re-export under the same name (internal
     modules `relay.ts` / `socket.ts` keep importing from `./types.js`).
   - Update the `@package-contract` header: `Attachment` now comes from a
     declared package dep; the remaining types stay structurally independent
     of the host.
2. `packages/chat-service/src/index.ts`
   - Add `Attachment` and `StartChatParams` to the named type exports
     (public surface grows; ships to npm on the next
     `@mulmobridge/chat-service` publish).
3. `server/api/routes/agent.ts`
   - Replace the mirrored interface with
     `export interface StartChatParams extends ChatServiceStartChatParams
     { userTimezone?: string }`, keeping the host doc comment for
     `userTimezone` only.

## Compatibility

Type-only change; no runtime behavior. The host `StartChatParams` remains a
structural superset consumed by `startChat` / `spawnSystemWorker` /
`persistUserTurn` / `dispatchAgentRun` / `spawnBackgroundChat.ts` — all keep
typechecking because inherited members are unchanged. The host `startChat`
still satisfies chat-service's `StartChatFn` (the extra field is optional, so
`ChatServiceStartChatParams` stays assignable to the host param type).

## Verification

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
- jscpd with the CI ignore list: clone pair (alert #173) gone, no new clones.
