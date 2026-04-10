// Client UI knobs. Values here are tunable presentation settings —
// things we might want to change without touching application logic.
// Algorithm constants that are tightly coupled with specific code
// (e.g. PENDING_MIN_MS) live next to their use site, not here.

// How many recent sessions the header tab strip shows. Older
// sessions remain accessible from the history popup.
export const MAX_VISIBLE_SESSION_TABS = 6;

// Upper bound on the number of characters we echo from a server
// error body into an in-chat error card. Anything longer would push
// real content off-screen and rarely carries useful signal.
export const ERROR_BODY_PREVIEW_MAX_CHARS = 200;

// How many items plugin preview tiles (todo / scheduler / wiki) show
// before collapsing the rest into a "+N more" indicator.
export const PREVIEW_ITEM_COUNT = 3;

// localStorage key for the right-sidebar-visible toggle. Kept as a
// named constant so a single rename here migrates every read/write.
export const LS_RIGHT_SIDEBAR_VISIBLE = "right_sidebar_visible";
