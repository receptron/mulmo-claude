# Refactor chat-service to a DI middleware factory (#269 / #305)

## Goal

Keep `server/chat-service/` inside the mulmoclaude repo for now, but make it shaped exactly like a future standalone npm package (`@mulmoclaude/chat-service`). Nothing inside the module should import from the host app — all host-specific behaviour (startChat, session subscription, role lookup, workspace dir, logger) is passed in via a `ChatServiceDeps` interface.

**Load-bearing rule**: once the refactor lands, the chat-service directory is frozen against "just add another import from `../routes/…` or `../roles.js`". Every new dependency MUST be added to `ChatServiceDeps` and threaded through `createChatService(deps)`. This is called out at the top of each chat-service file via a `@package-contract` header comment so future contributors (human or agent) do not silently break the extractability invariant.

## Today's import surface (to be replaced with DI)

`server/chat-service/index.ts`:

- `../logger/index.js` → `log`
- `../roles.js` → `getRole`
- `../../src/config/roles.js` → `DEFAULT_ROLE_ID`
- `../routes/agent.js` → `startChat`, `StartChatParams`, `StartChatResult`
- `../session-store/index.js` → `onSessionEvent`
- `../utils/httpError.js` → `badRequest`, `notFound`
- `../../src/config/apiRoutes.js` → `API_ROUTES`
- `../../src/types/events.js` → `EVENT_TYPES`

`server/chat-service/chat-state.ts`:

- `../workspace-paths.js` → `WORKSPACE_PATHS.transports`
- `../logger/index.js` → `log`

`server/chat-service/commands.ts`:

- `../roles.js` → `getRole`, `loadAllRoles`
- `./chat-state.js` → `resetChatState`

## After the refactor

New `ChatServiceDeps` interface (in `server/chat-service/types.ts`):

```ts
export interface ChatServiceDeps {
  startChat: (params: StartChatParams) => Promise<StartChatResult>;
  onSessionEvent: (sessionId: string, listener: SessionEventListener) => () => void;
  loadAllRoles: () => Role[];
  getRole: (roleId: string) => Role;
  defaultRoleId: string;
  transportsDir: string;
  logger: Logger;
}
```

`StartChatParams` / `StartChatResult` / `SessionEventListener` / `Role` / `Logger` are re-declared as structural types in `server/chat-service/types.ts` so the module can eventually be extracted without importing from the host app's types.

`server/chat-service/index.ts` exports:

```ts
export function createChatService(deps: ChatServiceDeps): Router { ... }
```

`chat-state.ts` becomes a factory:

```ts
export function createChatState(opts: { transportsDir: string; logger: Logger }) {
  return { getChatState, setChatState, resetChatState, connectSession, generateSessionId };
}
```

`commands.ts` becomes a factory:

```ts
export function createCommandHandler(opts: {
  loadAllRoles: () => Role[];
  getRole: (id: string) => Role;
  resetChatState: ResetChatStateFn;
}) {
  return { handleCommand };
}
```

`server/index.ts` wires everything up:

```ts
import { createChatService } from "./chat-service/index.js";
import { startChat } from "./routes/agent.js";
import { onSessionEvent } from "./session-store/index.js";
import { getRole, loadAllRoles } from "./roles.js";
import { DEFAULT_ROLE_ID } from "../src/config/roles.js";
import { WORKSPACE_PATHS } from "./workspace-paths.js";
import { log } from "./logger/index.js";

app.use(
  createChatService({
    startChat,
    onSessionEvent,
    loadAllRoles,
    getRole,
    defaultRoleId: DEFAULT_ROLE_ID,
    transportsDir: WORKSPACE_PATHS.transports,
    logger: log,
  }),
);
```

## Files touched

- **new** `server/chat-service/types.ts` — `ChatServiceDeps` + structural types
- **edit** `server/chat-service/index.ts` — factory, keep routes unchanged
- **edit** `server/chat-service/chat-state.ts` — factory accepting `{ transportsDir, logger }`
- **edit** `server/chat-service/commands.ts` — factory accepting `{ loadAllRoles, getRole, resetChatState }`
- **edit** `server/index.ts` — build deps, mount via factory
- each chat-service file gets a `@package-contract` header comment

## Behaviour

No functional change. Same routes, same payloads, same logging prefix, same timeout. Unit tests (none exist for chat-service today) can now inject stubs; adding coverage is a follow-up PR.

## Non-goals

- npm publish — deferred
- Moving the module out of the repo — deferred
- Adding WebSocket support — blocked on this (#268 sits on top)

## Verification

- `yarn typecheck` / `yarn typecheck:server` / `yarn test` / `yarn lint` / `yarn build` all green
- Manual smoke: send a `/status` command through the existing Slack / CLI bridge to confirm the chat-service routes still reply
- No grep hits for `chat-service/` internal files importing from outside the directory after the refactor (other than `../../src/types/events.js` and `../../src/config/apiRoutes.js` which are type / route-path constants, not host logic)
