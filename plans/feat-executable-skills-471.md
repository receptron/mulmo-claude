# feat: chat-created programs as executable skills (#471)

## Goal

Allow users to create programs during chat and save them as executable skills that run safely in the Docker sandbox.

## Current state

- Skills are **text-only** — SKILL.md body is a prompt passed to Claude
- Claude interprets the prompt and uses MCP tools (manageScheduler, manageSource, etc.)
- No mechanism to run arbitrary code (Python, Node.js, shell scripts) within a skill
- Docker sandbox exists and is used for the Claude Code CLI agent

## Design

### SKILL.md extension

Add optional `runtime` and `permissions` fields to the YAML frontmatter:

```yaml
---
description: Fetch and analyze CSV data from an API
runtime: node
permissions:
  - network
  - file-write
---
```

**runtime values:**
- `claude` (default, current behavior) — body is a prompt for Claude
- `node` — body contains a Node.js script, executed via `tsx`
- `python` — body contains a Python script, executed via `python3`
- `shell` — body contains a shell script, executed via `bash`

**permissions values:**
- `network` — allow outbound network access (default: denied)
- `file-write` — allow writing outside the skill's output directory (default: denied)
- `file-read-all` — allow reading outside the workspace (default: workspace only)

When `runtime` is omitted or `claude`, behavior is unchanged.

### Execution model

```
User invokes /my-skill (or scheduled task fires)
    ↓
Parse SKILL.md → runtime: node
    ↓
Prepare sandbox:
  - Mount workspace read-only (or read-write if file-write permission)
  - Mount skill output dir at /output (always writable)
  - Network: --network=none unless network permission granted
    ↓
Execute:
  docker run --rm \
    --cap-drop ALL \
    -v ~/mulmoclaude:/workspace:ro \
    -v /tmp/skill-output:/output \
    --network none \
    node:22-slim \
    node /workspace/.claude/skills/my-skill/main.js
    ↓
Capture stdout/stderr
    ↓
Return result to chat or save to workspace
```

### Skill file structure

Two formats supported:

**Inline (simple):** Script is in the SKILL.md body itself.

```yaml
---
description: Count lines in all markdown files
runtime: shell
---

find /workspace -name "*.md" | xargs wc -l | sort -rn | head -20
```

**Multi-file (complex):** SKILL.md references files in the skill directory.

```
.claude/skills/data-analyzer/
  SKILL.md          ← frontmatter + description
  main.ts           ← entry point
  package.json      ← dependencies (installed at build time)
  lib/helpers.ts
```

```yaml
---
description: Analyze workspace data and generate report
runtime: node
entry: main.ts
permissions:
  - network
  - file-write
---

Fetches data from configured APIs, runs analysis, and generates
a report in ~/mulmoclaude/artifacts/documents/.
```

### Phases

#### Phase 1: Inline shell/node execution in Docker

- Parse `runtime` field from frontmatter
- For `runtime: shell` — write body to temp file, execute in Docker
- For `runtime: node` — write body to temp file, execute via `tsx` in Docker
- Capture stdout → return as tool result
- Permission flags parsed but only `network` enforced (--network flag)
- Non-Docker mode: warn user and prompt for confirmation before executing

**Files to modify:**
- `server/workspace/skills/parser.ts` — parse `runtime`, `permissions`, `entry` fields
- `server/workspace/skills/executor.ts` — NEW: skill execution engine
- `server/agent/index.ts` — route executable skills through executor
- `src/plugins/manageSkills/definition.ts` — add runtime/permissions to save action

**Estimated: 3-4 files, ~200 lines**

#### Phase 2: Multi-file skills with dependencies

- Support `entry` field pointing to a file in the skill directory
- Support `package.json` with dependencies (install in Docker at first run, cache)
- Skill directory mounted into Docker container
- Build step: `npm install` in Docker before execution

**Estimated: +100 lines, modify executor.ts**

#### Phase 3: UI and safety

- Skills UI shows permission badges (network, filesystem icons)
- Permission confirmation dialog on first run of a new executable skill
- Execution log visible in Tasks tab (reuse scheduler log infrastructure)
- `manageSkills save` supports `runtime` and `permissions` parameters so Claude can create executable skills from chat

**Estimated: +150 lines (Vue + API)**

#### Phase 4: Scheduled executable skills

- Combine with scheduler: `runtime: node` + `schedule: daily 09:00`
- Task fires → executor runs the script in Docker → result saved to workspace
- Example: daily data pipeline that fetches, transforms, and saves CSV

**No new infrastructure needed — scheduler already calls skill body. Just route through executor when runtime != claude.**

### Security model

| Mode | Execution | Safety |
|---|---|---|
| Docker (default) | Container with --cap-drop ALL | Strong: filesystem isolation, network control |
| Non-Docker | Direct process execution | Weak: prompt-based confirmation only, warn user |

**Docker permissions mapping:**

| Permission | Docker flag | Default |
|---|---|---|
| (none) | `--network none`, workspace read-only | Denied |
| `network` | Omit `--network none` | Allowed |
| `file-write` | Workspace mounted read-write | Allowed |
| `file-read-all` | Host home dir mounted read-only | Allowed |

### User stories

1. **"Analyze my CSV files"** — user asks Claude to write a Python script → Claude saves it as a skill with `runtime: python` → user runs `/analyze-csv data.csv` later
2. **"Build a scraper for job postings"** — Claude writes Node.js code → saves as multi-file skill with `network` permission → runs daily via scheduler
3. **"Create a data pipeline"** — Claude writes shell script → saves with `runtime: shell` → piped through Docker sandbox every morning

### Dependencies

- Existing Docker sandbox infrastructure (`server/system/docker.ts`)
- Existing skill parser (`server/workspace/skills/parser.ts`)
- Existing scheduler (`@receptron/task-scheduler`)
- Existing manageSkills MCP tool

### Open questions

- Should executable skills be allowed in non-Docker mode at all? (Current plan: yes with warning)
- Should there be a skill "marketplace" or sharing mechanism? (Defer to future)
- Should we support `runtime: deno` for sandboxed JS without Docker? (Nice-to-have)
