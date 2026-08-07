// Browser-side Firebase init for the remote-host settings page.
//
// Initializes the Firebase web app and exposes the Auth instance used by the
// SettingsRemoteHostTab to run the Google sign-in popup and extract the Google
// OAuth idToken (which is then POSTed to the server's /connect route).
import { initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence } from "firebase/auth";

import { firebaseConfig } from "./firebaseConfig";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Persistence is deliberately in-memory: this Auth instance exists ONLY to run
// `signInWithPopup` and hand the resulting Google idToken to
// `/api/remote-host/connect`. The Firebase user session is never read back —
// the connection is kept alive by the server's own session blob (parked in
// localStorage under `remoteHost.session` by useRemoteHost.ts), so nothing
// needs to survive a reload here.
//
// Keeping the default IndexedDB persistence is not merely redundant, it breaks
// sign-in outright. `IndexedDBLocalPersistence` sets an internal `isHiding`
// flag on `pagehide` / `visibilitychange:hidden` and throws
// `Database is closing/hidden` from `_openDb()` while it is set. The flag is
// only cleared by the matching `pageshow` / `visibilitychange:visible`
// handlers — but those listeners are unregistered as soon as the last
// persistence listener goes away, and `unregisterLifecycleListeners()` does not
// reset `isHiding`. A tab that was backgrounded at the wrong moment therefore
// keeps a permanently-stuck `isHiding === true` on a page-scoped singleton, and
// every subsequent sign-in fails until a full reload. Opting out of IndexedDB
// removes that failure mode entirely (@firebase/auth 1.13.4).
void setPersistence(auth, inMemoryPersistence);
