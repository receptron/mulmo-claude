# Feat: macOS Reminder notification sink (#789)

## Why

Convert the user-facing `/notify` skill (which writes to macOS
Reminders via `osascript` so iCloud sync mirrors to iPhone) into a
built-in notification sink. Skills require explicit user invocation
per call; the built-in sink fires automatically alongside the existing
bell + bridge sinks whenever any caller publishes a notification.

## Design

### Module: `server/system/macosNotify.ts`

- `pushToMacosReminder(title: string, body?: string): Promise<void>`
- Gates:
  1. `env.macosReminderNotifications` flag must be set
  2. `process.platform === "darwin"`
  3. (Internal) — once both gates pass, the `osascript` subprocess
     runs; failures log `warn` but never throw
- AppleScript reads title / body from environment via
  `system attribute "MULMOC_NOTIFY_TITLE"` rather than embedding the
  string literally. Sidesteps quote / backslash escaping entirely
  → no AppleScript injection vector.

### Env

`server/system/env.ts`:

```ts
macosReminderNotifications: asFlag(process.env.MACOS_REMINDER_NOTIFICATIONS),
```

### Hook

`server/events/notifications.ts` — inside `publishNotification`'s
existing `try / catch` block, after the bridge push, fire the macOS
Reminder. The `try / catch` wrapping protects every sink from
breaking the others.

```ts
// after deps.publish(...) + deps.pushToBridge(...)
void pushToMacosReminder(payload.title, payload.body);
```

We `void` the promise — fire-and-forget, the macOS sink shouldn't
block the bell update.

### One-time platform warning

If env is set on a non-darwin platform, log a single `warn` at module
load and then no-op forever. Don't spam per call.

### Spawn injection point (testability)

```ts
type Spawner = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => ChildProcess;
export function pushToMacosReminderWithDeps(spawner: Spawner, title: string, body?: string): Promise<void>;
export function pushToMacosReminder(title: string, body?: string): Promise<void>;
```

The default export uses `child_process.spawn`; tests inject a mock
spawner so we never invoke `osascript` in CI / on Linux.

## AppleScript

```text
tell application "Reminders"
    set t to (system attribute "MULMOC_NOTIFY_TITLE")
    set b to (system attribute "MULMOC_NOTIFY_BODY")
    if b is "" then
        make new reminder in default list with properties {name:t, due date:(current date)}
    else
        make new reminder in default list with properties {name:t, body:b, due date:(current date)}
    end if
end tell
```

(The `due date:(current date)` is what triggers the actual notification on the iPhone — without it the reminder is silent.)

## Tests (`test/system/test_macosNotify.ts`)

- `pushToMacosReminderWithDeps` — pure spawn argument assembly:
  - title / body environment variables forwarded to spawn
  - body absent → `MULMOC_NOTIFY_BODY=""`
  - the `osascript -e <script>` argv shape
- Gates:
  - env flag off → no spawn at all
  - non-darwin platform → no spawn (using a platform-injection seam)
- Subprocess error (non-zero exit / spawn error) → resolves silently,
  warn logged

## Acceptance

- [ ] `MACOS_REMINDER_NOTIFICATIONS=1` + darwin → `publishNotification`
      adds a reminder to default Reminders list
- [ ] iCloud Reminders → iPhone delivery (manual check)
- [ ] env unset → no extra log lines, no spawn
- [ ] non-darwin + env set → single warn at module load, then no-op
- [ ] `osascript` failure → bell + bridge unaffected
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn test` clean

## Out of scope

- Per-kind filtering (`NOTIFY_KINDS=push,scheduler`)
- Scheduled reminders (`(current date) + N minutes`)
- macOS native Notification Center (transient pop) — Reminders + iCloud
  better matches the "deliver to my phone" intent
- Custom sound / icon
