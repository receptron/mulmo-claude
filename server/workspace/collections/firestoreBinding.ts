// Bind firestore-backed collections to the remote-host session's Firestore.
//
// Separate from `configure.ts` (the one-shot host binding) because the session
// is late-bound and comes and goes: it doesn't exist at startup, opens when the
// user connects, and closes on disconnect. The accessor is therefore consulted
// per operation and answers null while there is no session — the store turns
// that into "connect remote-host first" rather than an empty result.
import { createFirestoreDocs, setFirestoreAccessor, type FirestoreDocs } from "@mulmoclaude/core/collection/server";
import type { Firestore } from "firebase/firestore";
import { currentFirestoreSession } from "../../remoteHost/session.js";

// One adapter per Firestore instance. The accessor runs on every store call,
// and a fresh adapter each time would allocate a closure set per read.
let cached: { firestore: Firestore; docs: FirestoreDocs } | null = null;

function docsFor(firestore: Firestore): FirestoreDocs {
  if (cached?.firestore !== firestore) cached = { firestore, docs: createFirestoreDocs(firestore) };
  return cached.docs;
}

export function initFirestoreCollectionBinding(): void {
  setFirestoreAccessor(() => {
    const session = currentFirestoreSession();
    return session === null ? null : { docs: docsFor(session.firestore), uid: session.uid };
  });
}
