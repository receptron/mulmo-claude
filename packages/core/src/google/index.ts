// Server-only Google engine: local OAuth (loopback + PKCE), token store at
// `~/.config/mulmo/google-token.json`, and REST calls for Calendar, Tasks,
// and Drive (`drive.file` — app-created files only). Shared by the hosts
// (remote-host handlers, /api routes, each host's auth CLI) and the google
// plugin — the token file has a single owner, so every surface sees the same
// link state.
export { configureGoogleHost, type GoogleLogger } from "./host.js";
export { isIsoDateTimeWithOffset } from "./datetime.js";
export { googleConfigDir, googleSecretsDir, googleTokenPath, legacyGoogleTokenPath } from "./paths.js";
export { clientSecretPresence, findClientSecretPath, loadClientSecret, type ClientSecretPresence, type InstalledClientSecret } from "./clientSecret.js";
export { deleteGoogleTokens, loadGoogleTokens, mergeGoogleTokens, saveGoogleTokens, type IssuedVia, type StoredGoogleTokens } from "./tokenStore.js";
export { brokerBaseUrl, brokerExchange, brokerRefresh, brokerStart, type BrokerStartResponse } from "./broker.js";
export {
  authorizeGoogle,
  commitLinkedTokens,
  getGoogleAccessToken,
  unlinkGoogle,
  waitForAuthCode,
  GOOGLE_AUTH_CANCELLED,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDARLIST_SCOPE,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SCOPES,
  type AuthorizeGoogleOptions,
  type RevokeFetch,
} from "./auth.js";
export { createGoogleAuthFlow, googleAuthFlow, type GoogleAuthFlow, type GoogleAuthFlowStatus } from "./authFlow.js";
export { googleApiError, isGoogleApiError, GoogleApiError, DEFAULT_LIST_MAX_RESULTS, MAX_LIST_RESULTS } from "./apiClient.js";
export {
  calendarApiError,
  collectCalendarPages,
  createCalendarEvent,
  getCalendarColors,
  canonicalCalendarId,
  listCalendarEvents,
  listCalendars,
  syncCalendarEvents,
  toCalendarSummary,
  toEventSummary,
  type CalendarColorEntry,
  type CalendarColors,
  type CalendarEventInput,
  type CalendarEventSummary,
  type CalendarListPage,
  type CalendarSummary,
  type CalendarSyncResult,
  type ListEventsInput,
  type SyncEventsInput,
} from "./calendar.js";
export { calendarSyncStatePath, clearCalendarSyncToken, loadCalendarSyncToken, saveCalendarSyncToken } from "./calendarSyncStore.js";
export { toCollectionDateTime } from "./collectionDateTime.js";
export {
  googleCalendarSyncTaskDef,
  classifyDelete,
  classifyWrite,
  groupByCalendar,
  syncCalendarGroup,
  syncDueCalendarCollections,
  toCollectionRecord,
  GOOGLE_CALENDAR_SYNC_TASK_ID,
  type CalendarCollectionSyncResult,
} from "./collectionSync.js";
export {
  completeTask,
  createTask,
  deleteTask,
  listTaskLists,
  listTasks,
  toTaskListSummary,
  toTaskSummary,
  type CompleteTaskInput,
  type CreateTaskInput,
  type ListTasksInput,
  type TaskListSummary,
  type TaskSummary,
} from "./tasks.js";
export {
  assertSafeMimeType,
  buildMultipartBody,
  createDriveFile,
  deleteDriveFile,
  isTextMimeType,
  listDriveFiles,
  pickBoundary,
  readDriveFile,
  toDriveFileSummary,
  type CreateDriveFileInput,
  type DriveFileSummary,
  type ListDriveFilesInput,
  type ReadDriveFileInput,
} from "./driveFile.js";
