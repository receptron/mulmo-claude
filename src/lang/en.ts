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
    placeholder: "Type a task, or drop / paste / attach a file…",
    expandEditor: "Expand editor",
    composeMessage: "Compose message",
    sendHint: "Cmd+Enter to send",
    send: "Send",
    attachFile: "Attach file",
    fileTooLarge: "File too large ({sizeMB} MB). Maximum is 30 MB.",
    unsupportedFileType: "File type not supported. Accepted: images, PDF, DOCX, XLSX, PPTX, text files.",
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
  pluginLauncher: {
    todos: { label: "Todos", title: "Open todos (⌘4)" },
    scheduler: { label: "Schedule", title: "Open schedule (⌘5)" },
    wiki: { label: "Wiki", title: "Open wiki (⌘6)" },
    skills: { label: "Skills", title: "Open skills (⌘7)" },
    roles: { label: "Roles", title: "Open roles (⌘8)" },
    files: { label: "Files", title: "Open workspace files (⌘3)" },
  },
  fileContentHeader: {
    showRendered: "Show rendered Markdown",
    showRaw: "Show raw source",
    rendered: "Rendered",
    raw: "Raw",
    closeFile: "Close file",
  },
  fileContentRenderer: {
    selectFile: "Select a file",
    htmlPreview: "HTML preview",
    pdfPreview: "PDF preview",
    parseError: "parse error",
  },
  settingsMcpTab: {
    noServers: "No MCP servers configured yet.",
    enabled: "enabled",
    urlLabel: "URL:",
    commandLabel: "Command:",
    dockerNonWorkspaceWarning: "⚠ Contains paths outside the workspace — will not resolve inside Docker.",
    addServerButton: "+ Add MCP Server",
    nameLabel: "Name",
    namePlaceholder: "my-server",
    typeHttp: "HTTP",
    typeStdio: "Stdio (command)",
    urlFieldLabel: "URL",
    urlPlaceholder: "https://example.com/mcp",
    commandFieldLabel: "Command",
    argsLabel: "Arguments (one per line)",
    // Message function form — skips vue-i18n's message compiler so
    // the literal `@` isn't parsed as a linked-message reference.
    argsPlaceholder: () => "-y\n@modelcontextprotocol/server-filesystem\n/workspace/path",
    errNoName: "Please provide a Name, or enter a URL / args we can derive one from.",
    errBadName: "Name must start with a lowercase letter and contain only [a-z0-9_-].",
    errIdExists: 'Server id "{id}" already exists.',
    errBadHttpUrl: "HTTP URL must start with http:// or https://",
  },
  pluginScheduler: {
    prev: "Previous",
    today: "Today",
    goToday: "Go to today",
    next: "Next",
    deleteItem: "Delete item",
    closeEditor: "Close editor",
    apiError: "⚠ Failed to update scheduler: {error}",
    tabCalendar: "Calendar",
    tabTasks: "Tasks",
    heading: "Scheduler",
    itemCount: "{count} item | {count} items",
    noScheduled: "No scheduled items",
    unscheduled: "Unscheduled",
    editItem: "Edit item",
    update: "Update",
    editSource: "Edit Source",
    applyChanges: "Apply Changes",
  },
  pluginSchedulerTasks: {
    recommendedFrequencies: "Recommended Frequencies",
    tableTaskType: "Task type",
    tableSuggestedSchedule: "Suggested schedule",
    noTasks: "No scheduled tasks",
    runNow: "Run now",
    enable: "Enable",
    disable: "Disable",
    delete: "Delete",
    nextRun: "Next: {time}",
    originSystem: "System",
    originUser: "User",
    originSkill: "Skill",
    runFailed: "Run failed: {error}",
    toggleFailed: "Toggle failed: {error}",
    deleteFailed: "Delete failed: {error}",
  },
  pluginCanvas: {
    undo: "Undo",
    redo: "Redo",
    clear: "Clear",
  },
  pluginTodo: {
    clearFilters: "Clear all filters",
    deleteItem: "Delete item",
  },
  pluginWiki: {
    backToIndex: "Back to index",
  },
  pluginPresentHtml: {
    saveAsPdf: "Save as PDF (opens print dialog)",
  },
  pluginManageSource: {
    titlePlaceholder: "Title (optional)",
  },
  pluginManageSkills: {
    deleteProjectSkill: "Delete this project-scope skill",
  },
  pluginSpreadsheet: {
    valuePlaceholder: "Value",
    valueOrFormulaPlaceholder: "Value or Formula (e.g., 100 or SUM(B2:B11))",
    formatPlaceholder: "Format (e.g., $#,##0.00)",
  },
  app: {
    // `<i18n-t>` slots — named `envKey` / `envFile` render as inline
    // `<code>` in App.vue, so the literal variable and file names
    // stay untranslated while the surrounding copy is localised.
    geminiRequired: "Image generation requires {envKey}. Add it to {envFile} and restart the app.",
    startConversation: "Start a conversation",
  },
  suggestionsPanel: {
    suggestions: "Suggestions",
    sendEditHint: "click to send · shift+click to edit",
  },
  settingsToolsTab: {
    // Rendered via <i18n-t> with named slots `allowedTools` and `claudeMcp`
    // so the inline `<code>` tags keep their styling while the copy
    // is translatable.
    explanation:
      "Extra tool names to pass to Claude via {allowedTools}. One per line. Useful for built-in Claude Code MCP servers like Gmail / Google Calendar after you have authenticated via {claudeMcp}.",
  },
};

export default enMessages;
