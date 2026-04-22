// English dictionary for vue-i18n.
//
// Structure is grouped by feature area (common, chat, session, ...).
// Prefer nested objects over flat keys so related strings stay
// together and the namespace serves as self-documentation.

// No `as const` — the module augmentation in src/types/vue-i18n.d.ts
// reads `typeof en` to feed `DefineLocaleMessage`, and readonly literal
// types would conflict with vue-i18n's writable message interface.

const enMessages = {
  common: {
    save: "Save",
    cancel: "Cancel",
    loading: "Loading...",
    close: "Close",
    dismiss: "Dismiss",
    add: "Add",
    remove: "Remove",
    saving: "Saving...",
    saved: "Saved",
  },
  sessionTabBar: {
    newSession: "New session",
    sessionHistory: "Session history",
    // vue-i18n pluralization: `t(key, count)` picks singular / plural
    // based on the number. `{count}` is interpolated.
    activeSessions: "{count} active session (agent running) | {count} active sessions (agent running)",
    unreadReplies: "{count} unread reply | {count} unread replies",
  },
  chatInput: {
    placeholder: "Type a task...",
    expandEditor: "Expand editor",
    composeMessage: "Compose message",
    sendHint: "Cmd+Enter to send",
    send: "Send",
    fileTooLarge: "File too large ({sizeMB} MB). Maximum is 30 MB.",
  },
  sessionHistoryPanel: {
    filters: {
      all: "All",
      human: "Human",
      scheduler: "Scheduler",
      skill: "Skill",
      bridge: "Bridge",
    },
    failedToRefresh: "⚠ Failed to refresh: {error}",
    showingLastKnown: " — showing last known list.",
    noSessions: "No sessions yet.",
    noMatching: "No matching sessions.",
    running: "Running",
    unread: "Unread",
    noMessages: "(no messages)",
  },
  notificationBell: {
    notifications: "Notifications",
    markAllRead: "Mark all read",
    noNotifications: "No notifications",
    dismiss: "Dismiss",
  },
  sidebarHeader: {
    toolCallHistory: "Tool call history",
    settings: "Settings",
  },
  rightSidebar: {
    toggleSystemPrompt: "Toggle system prompt",
    systemPrompt: "System Prompt",
    availableTools: "Available Tools",
    toggleToolDescription: "Toggle tool description",
    toolCallHistory: "Tool Call History",
    noToolCalls: "No tool calls yet",
    arguments: "Arguments",
    error: "Error",
    result: "Result",
    running: "Running...",
  },
  fileTreePane: {
    sort: "Sort:",
    sortByName: "Sort by name",
    name: "Name",
    sortByRecent: "Sort by modified date (newest first)",
    recent: "Recent",
    reference: "Reference",
    // "RO" = Read-Only. Kept short on purpose — rendered as a compact
    // badge next to the Reference label.
    readOnlyBadge: "RO",
  },
  fileTree: {
    workspace: "(workspace)",
    recentlyChanged: "Recently changed",
  },
  lockStatusPopup: {
    sandboxEnabledTooltip: "Sandbox enabled (Docker)",
    noSandboxTooltip: "No sandbox (Docker not found)",
    sandboxEnabledLabel: "Sandbox enabled:",
    sandboxEnabledBody: "Docker is running. Filesystem access is isolated.",
    noSandboxLabel: "No sandbox:",
    noSandboxBodyPrefix: "Claude can access all files on your machine. Install",
    noSandboxBodySuffix: "to enable filesystem isolation.",
    dockerDesktop: "Docker Desktop",
    hostCredentials: "Host credentials attached:",
    credsLoading: "loading…",
    sshAgent: "SSH agent:",
    forwarded: "forwarded",
    notForwarded: "not forwarded",
    mountedConfigs: "Mounted configs:",
    none: "none",
    testIsolation: "Test sandbox isolation:",
  },
  settingsModal: {
    title: "Settings",
    tabs: {
      tools: "Allowed Tools",
      mcp: "MCP Servers",
      dirs: "Directories",
      refs: "Reference Dirs",
    },
    toolNamesLabel: "Tool names",
    invalidToolNamesPrefix: "These look non-standard (expected prefix",
    invalidToolNamesSuffix: "):",
    mcpToolsError: "⚠ Could not fetch MCP tool status: {error}. Showing all tools regardless of enablement.",
    changesHint: "Changes apply on the next message. No restart needed.",
    cannotSaveTooltip: "Cannot save until settings load successfully",
    saving: "Saving…",
    loadingLabel: "Loading…",
  },
  canvasViewToggle: {
    stackViewTooltip: "Stack view · click to switch to Single (⌘1)",
    singleViewTooltip: "Single view · click to switch to Stack (⌘2)",
    switchToSingle: "Switch to Single view",
    switchToStack: "Switch to Stack view",
  },
  settingsWorkspaceDirs: {
    noEntries: "No custom directories configured.",
    addDirTitle: "Add directory",
    pathPlaceholder: "data/clients or artifacts/reports",
    descPlaceholder: "Description (what goes in this folder)",
    errPathRequired: "Path required",
    errMustStartWith: "Must start with data/ or artifacts/",
    errAlreadyExists: "Already exists",
  },
  settingsReferenceDirs: {
    noEntries: "No reference directories configured.",
    addDirTitle: "Add reference directory",
    pathPlaceholder: "/Users/me/ObsidianVault or ~/Documents/notes",
    labelPlaceholder: "Label (optional — defaults to folder name)",
    readOnlyBadge: "read-only",
    errPathRequired: "Path required",
    errMustBeAbsolute: "Must be an absolute path or start with ~/",
    errAlreadyExists: "Already exists",
    errLabelConflict: 'Label "{label}" already exists',
  },
};

export default enMessages;
