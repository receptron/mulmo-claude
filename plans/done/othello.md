# Othello Plugin — Integration Plan

## Overview

Wire up the `@gui-chat-plugin/othello` package (already installed) into the MulmoChat agent stack. The plugin provides complete game logic via `executeOthello` — no file storage is needed. This is a pure in-memory tool: Claude manages game state by passing the board back and forth with the player.

---

## Package API

**Tool name**: `playOthello`

**Actions**:
| Action     | Description                                         |
|------------|-----------------------------------------------------|
| `new_game` | Start a fresh board, set player sides               |
| `move`     | Place a piece; requires `board`, `currentSide`, `row`, `col` |
| `pass`     | Pass the current turn; requires `board`, `currentSide` |

The execute function returns `OthelloState`:
```ts
{
  board: Cell[][];         // 8×8 grid of ".", "B", "W"
  currentSide: Side;       // whose turn it is
  playerNames: { B, W };
  legalMoves: { row, col }[];
  counts: { B, W, empty };
  isTerminal: boolean;
  winner: Side | "draw" | null;
  lastAction: { type: "new_game" | "move" | "pass"; ... };
  error?: string;
}
```

---

## Key Fix: Plugin Registry Key

`src/tools/index.ts` currently registers the plugin under the key `"othello"`:
```ts
othello: OthelloPlugin.plugin as unknown as ToolPlugin,
```

The MCP tool name (what Claude calls) is `"playOthello"`. The frontend uses `toolName` from the tool result to look up the view component, so the key **must match the tool name**. Change the key to `"playOthello"`.

---

## Files to Change

### 1. `server/api/routes/plugins.ts`
Add a route for `POST /api/othello` that calls `executeOthello` from the package:
```ts
import { executeOthello } from "@gui-chat-plugin/othello";

router.post("/othello", async (req, res) => {
  try {
    const result = await executeOthello(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});
```

### 2. `src/tools/index.ts`
Change the plugin registry key from `"othello"` to `"playOthello"` to match the MCP tool name:
```ts
// before:
othello: OthelloPlugin.plugin as unknown as ToolPlugin,
// after:
playOthello: OthelloPlugin.plugin as unknown as ToolPlugin,
```

### 3. `server/agent/index.ts`
Add `"playOthello"` to `MCP_PLUGINS`:
```ts
const MCP_PLUGINS = new Set([
  // ...existing entries...
  "playOthello",
]);
```

### 4. `server/agent/mcp-server.ts`
Add entry to `ALL_TOOLS` using the schema from the package types:
```ts
playOthello: {
  name: "playOthello",
  description: "Play Othello/Reversi. Start a new game or make moves on the board.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["new_game", "move", "pass"],
        description: "Action to perform.",
      },
      board: {
        type: "array",
        description: "Current board state (8×8 grid). Required for move/pass.",
        items: { type: "array", items: { type: "string" } },
      },
      currentSide: {
        type: "string",
        enum: ["B", "W"],
        description: "Whose turn it is. Required for move/pass.",
      },
      row: {
        type: "number",
        description: "Row index 0–7 for the move. Required for move.",
      },
      col: {
        type: "number",
        description: "Column index 0–7 for the move. Required for move.",
      },
      playerNames: {
        type: "object",
        description: "Player names for B and W sides.",
        properties: {
          B: { type: "string" },
          W: { type: "string" },
        },
      },
    },
    required: ["action"],
  },
  endpoint: "/api/othello",
},
```

### 5. `src/config/roles.ts`
Add a new **Game** role with `playOthello` in `availablePlugins`:
```ts
{
  id: "game",
  name: "Game",
  icon: "sports_esports",
  prompt: "You are a game companion. Play Othello/Reversi with the user. " +
    "Start a new game when the user asks, make your own moves as the computer player (W), " +
    "and display the board after every action.",
  availablePlugins: ["playOthello", "switchRole"],
  queries: ["Let's play Othello"],
},
```

---

## No New Files Required

All changes are additions to existing files. The othello package provides:
- Game logic (`executeOthello`)
- Vue view/preview components (`OthelloPlugin.plugin`)
- Tool definition schema (copied into `ALL_TOOLS`)

No new route file, no workspace storage, no new Vue components needed.

---

## Checklist

- [ ] `server/api/routes/plugins.ts` — add `/api/othello` route
- [ ] `src/tools/index.ts` — rename key `"othello"` → `"playOthello"`
- [ ] `server/agent/index.ts` — add `"playOthello"` to `MCP_PLUGINS`
- [ ] `server/agent/mcp-server.ts` — add `playOthello` entry to `ALL_TOOLS`
- [ ] `src/config/roles.ts` — add Game role with `playOthello`
