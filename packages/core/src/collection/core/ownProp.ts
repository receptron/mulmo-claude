// Own-property read for a plain object indexed by a user/LLM/feed-controlled
// key. Extracted so the ref/embed resolution in `deriveAll` and `derive`
// share one guard (where.ts keeps its own private copy for the dynamicIcon
// `where` evaluator — #2443).

/** Read `obj[key]` only when it is an OWN property. A bare `obj[key]` reaches
 *  inherited Object.prototype members, so a dangling ref/embed id like
 *  `"constructor"` or `"__proto__"` resolves to a prototype value (the
 *  `Object` function) instead of being absent — breaking the "missing target
 *  ⇒ null (em-dash)" fail-soft contract and putting a non-serializable
 *  function into the API response, where `JSON.stringify` drops the key
 *  entirely (#2322). A prototype key resolves to `undefined`; a record whose
 *  id is legitimately `"constructor"` (an own key) still resolves. */
export function ownProp<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}
