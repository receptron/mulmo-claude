// The seam between the firestore store and the Firestore SDK.
//
// The modular SDK is function-based (`getDocs(query(collection(db, …)))`),
// so a store that imported those functions directly could not be tested
// without a real backend — a fake `db` would still be handed to the real
// functions. Narrowing to this interface makes the backend swappable: core
// ships `createFirestoreDocs` over the real SDK, and the contract test
// injects an in-memory fake that satisfies the same shape.
//
// Deliberately minimal and id-keyed: no query builder, no field ordering,
// no cursors. Everything the store needs is "the documents of one
// collection path, ordered by document id" — see the store header for why
// field ordering is avoided entirely.

import {
  collection as firestoreCollection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query as firestoreQuery,
  runTransaction,
  setDoc,
  type Firestore,
} from "firebase/firestore";

/** One stored record document. `data` is the record as written; the store
 *  validates its shape (a document written by hand could be anything). */
export interface FirestoreDoc {
  id: string;
  data: unknown;
}

export interface FirestoreDocs {
  /** Every document under `collectionPath`, ordered by document id. */
  list: (collectionPath: string) => Promise<FirestoreDoc[]>;
  /** One document's `data`, or null when it doesn't exist. */
  get: (collectionPath: string, docId: string) => Promise<unknown | null>;
  /** Create or replace. */
  set: (collectionPath: string, docId: string, data: unknown) => Promise<void>;
  /** Create only. Returns false when the id already exists — atomic, so
   *  two concurrent creates can't both observe "missing". */
  create: (collectionPath: string, docId: string, data: unknown) => Promise<boolean>;
  /** Delete. Returns false when the id didn't exist, so a caller can tell
   *  a real delete from a typo'd id. */
  delete: (collectionPath: string, docId: string) => Promise<boolean>;
}

/** The real implementation over the modular SDK.
 *
 *  `orderBy("__name__")` orders by DOCUMENT ID. Ordering by a record field
 *  would silently EXCLUDE documents missing that field (the trap
 *  `remote-host/server/hostRunner.ts:158-169` documents), turning a read
 *  into a partial one; document id is always present and gives the stable
 *  order the store contract requires. */
export function createFirestoreDocs(database: Firestore): FirestoreDocs {
  return {
    list: async (collectionPath) => {
      const snapshot = await getDocs(firestoreQuery(firestoreCollection(database, collectionPath), orderBy("__name__")));
      return snapshot.docs.map((entry) => ({ id: entry.id, data: entry.get("data") as unknown }));
    },
    get: async (collectionPath, docId) => {
      const snapshot = await getDoc(doc(database, collectionPath, docId));
      return snapshot.exists() ? (snapshot.get("data") as unknown) : null;
    },
    set: async (collectionPath, docId, data) => {
      await setDoc(doc(database, collectionPath, docId), { data });
    },
    create: (collectionPath, docId, data) =>
      runTransaction(database, async (transaction) => {
        const ref = doc(database, collectionPath, docId);
        const existing = await transaction.get(ref);
        if (existing.exists()) return false;
        transaction.set(ref, { data });
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
  };
}
