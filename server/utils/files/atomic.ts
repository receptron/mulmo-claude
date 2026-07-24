// Atomic file writes live in exactly one place — `@mulmoclaude/core/files` — so
// the safety-critical Windows rename-retry logic can't drift across copies
// (#2399). This module keeps the stable `../utils/files/atomic.js` import path
// that ~30 host modules rely on; the implementation is the shared core one.
export { writeFileAtomic, writeFileAtomicSync, type WriteAtomicOptions } from "@mulmoclaude/core/files";
