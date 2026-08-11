// The seam between the firestore store and the Firestore SDK.
//
// The modular SDK is function-based (`getDocs(query(collection(db, …)))`), so a
// store that imported those functions directly could not be tested without a
// real backend — a fake `db` would still be handed to the real functions.
// Narrowing to this interface makes the backend swappable: core ships
// `createFirestoreDocs` over the real SDK, and the tests inject an in-memory
// fake that satisfies the same shape. That is what lets this repository's tests
// run with no API key and no network.
//
// Deliberately minimal and id-keyed: no query builder, no field ordering, no
// cursors. Everything the store needs is "the documents of one collection path,
// ordered by document id" — see the store header for why field ordering is
// avoided entirely.
//
// The collection path is an ARGUMENT, not something this module composes. It
// owns the SDK calls; `firestoreStore` owns where the documents live.

import {
  collection as firestoreCollection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query as firestoreQuery,
  onSnapshot,
  runTransaction,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";

/** One stored record document. `data` is the document's own fields — the
 *  record itself, not a wrapper around it; see `set` below. The store
 *  validates its shape, because a document written by hand could be
 *  anything. */
export interface FirestoreDoc {
  id: string;
  data: unknown;
}

export interface FirestoreDocs {
  /** Every document under `collectionPath`, ordered by document id. */
  list: (collectionPath: string) => Promise<FirestoreDoc[]>;
  /** The documents whose ARRAY field `field` contains `value`, ordered by
   *  document id.
   *
   *  One query shape, not a query builder — the seam stays a list of the
   *  operations the engine actually performs, so a fake can satisfy it
   *  honestly. This one exists for exactly one question, and it is the
   *  question the whole sharing model turns on: "which apps am I a member
   *  of?", asked as `apps` where `memberEmails` contains my address.
   *
   *  It is answerable at all because publish DERIVES `memberEmails` from the
   *  roster — Firestore cannot index the keys of a map, which is why the
   *  denormalised array exists and why the rules refuse a write where the two
   *  disagree. */
  listWhereArrayContains: (collectionPath: string, field: string, value: string) => Promise<FirestoreDoc[]>;
  /** One document's fields, or null when it doesn't exist. */
  get: (collectionPath: string, docId: string) => Promise<unknown | null>;
  /** Create or replace. */
  set: (collectionPath: string, docId: string, data: Record<string, unknown>) => Promise<void>;
  /** Create only. Returns false when the id already exists — atomic, so two
   *  concurrent creates can't both observe "missing". */
  create: (collectionPath: string, docId: string, data: Record<string, unknown>) => Promise<boolean>;
  /** Delete. Returns false when the id didn't exist, so a caller can tell a
   *  real delete from a typo'd id. */
  delete: (collectionPath: string, docId: string) => Promise<boolean>;
  /** Listen to `collectionPath`. Every snapshot reports the ids that changed
   *  in it, and whether it is the FIRST one.
   *
   *  `initial` is not a nicety. `onSnapshot` delivers the current contents
   *  immediately, as one snapshot in which every existing document reads as
   *  `added` — so a listener that treats snapshots uniformly announces the
   *  whole collection as changed the moment it arms, on every mount. The flag
   *  is passed up rather than swallowed here so the decision (and its test)
   *  lives with the store's policy, next to the rest of it.
   *
   *  `onError` fires at most once per subscription: a Firestore listen error
   *  TERMINATES the listener and never recovers on its own. Re-subscribing is
   *  the caller's job (`firestore/listen.ts` holds the policy).
   *
   *  Returns the detach function synchronously — `onSnapshot` is not async. */
  watch: (collectionPath: string, onChanged: (ids: string[], meta: { initial: boolean }) => void, onError: (error: unknown) => void) => () => void;
}

/** The real implementation over the modular SDK.
 *
 *  THE RECORD IS THE DOCUMENT. Its fields are written at the top level, not
 *  nested under a `data` key. This is not a matter of taste: the deployed
 *  security rules read `request.resource.data.<field>` and
 *  `resource.data[submit.emailField]` — a wrapper would put every field one
 *  level down, so the required-field checks, the status state machine and the
 *  "your own row" predicate would all read absent values and fail closed. A
 *  shared record's shape is part of the authorization contract.
 *
 *  `orderBy("__name__")` orders by DOCUMENT ID. Ordering by a record field
 *  would silently EXCLUDE documents missing that field (the trap
 *  `remote-host/server/hostRunner.ts:158-169` documents), turning a read into a
 *  partial one; the document id is always present and gives the stable order
 *  the store contract requires. */
export function createFirestoreDocs(database: Firestore): FirestoreDocs {
  return {
    list: async (collectionPath) => {
      const snapshot = await getDocs(firestoreQuery(firestoreCollection(database, collectionPath), orderBy("__name__")));
      return snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() }));
    },
    listWhereArrayContains: async (collectionPath, field, value) => {
      const snapshot = await getDocs(firestoreQuery(firestoreCollection(database, collectionPath), where(field, "array-contains", value), orderBy("__name__")));
      return snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() }));
    },
    get: async (collectionPath, docId) => {
      const snapshot = await getDoc(doc(database, collectionPath, docId));
      return snapshot.exists() ? snapshot.data() : null;
    },
    set: async (collectionPath, docId, data) => {
      await setDoc(doc(database, collectionPath, docId), data);
    },
    create: (collectionPath, docId, data) =>
      runTransaction(database, async (transaction) => {
        const ref = doc(database, collectionPath, docId);
        const existing = await transaction.get(ref);
        if (existing.exists()) return false;
        transaction.set(ref, data);
        return true;
      }),
    // Firestore's deleteDoc succeeds on a missing document, so an existence
    // check is what makes "deleted" distinguishable from "there was nothing".
    // It runs INSIDE the transaction (like `create`): a plain get-then-delete
    // would report `true` for a document a concurrent client had already
    // removed, i.e. claim a delete this call never performed.
    delete: (collectionPath, docId) =>
      runTransaction(database, async (transaction) => {
        const ref = doc(database, collectionPath, docId);
        const existing = await transaction.get(ref);
        if (!existing.exists()) return false;
        transaction.delete(ref);
        return true;
      }),
    // `docChanges()` rather than the whole snapshot: it names the documents
    // that moved, which is what lets the store report per-record changes
    // instead of "something in this collection changed". Added, modified and
    // removed are all reported the same way — the store's listener takes an
    // id, and re-reads; what KIND of change it was is not something a
    // reconcile pass needs to be told.
    //
    // `includeMetadataChanges` is deliberately left off: local writes and
    // has-pending-writes flips would otherwise wake every listener for
    // changes this process just made.
    watch: (collectionPath, onChanged, onError) => {
      let seen = false;
      return onSnapshot(
        firestoreCollection(database, collectionPath),
        (snapshot) => {
          const initial = !seen;
          seen = true;
          onChanged(
            snapshot.docChanges().map((change) => change.doc.id),
            { initial },
          );
        },
        onError,
      );
    },
  };
}
