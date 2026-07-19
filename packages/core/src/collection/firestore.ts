// @mulmoclaude/core/collection/firestore — the ONLY collection entry that
// pulls the Firestore SDK in at runtime.
//
// Kept off `./collection/server` on purpose: `firebase` is an OPTIONAL peer of
// this package, and a re-export links eagerly, so exporting `createFirestoreDocs`
// from the main entry would make firebase a hard requirement for every host —
// including ones with no Firestore at all. A host that wants firestore-backed
// collections imports the adapter from here and hands it to
// `setFirestoreAccessor`; everyone else never loads this module.

export { createFirestoreDocs, type FirestoreDoc, type FirestoreDocs } from "./server/firestoreDocs";
