/**
 * Excel-formula → JS-expression translation
 *
 * Pure string transforms that turn the Excel-operator form of an
 * already-substituted expression (cell references resolved, functions replaced)
 * into the JavaScript form handed to `new Function`, plus the character
 * allowlists that gate that evaluation. No engine or evaluator state is
 * captured — every function here is input → output only.
 */

/** Excel `^` exponentiation → JS `**`.
 *
 * Excel's `^` is left-associative (`2^3^2` = `(2^3)^2` = 64); JS `**` is
 * right-associative (`2**3**2` = `2**(3**2)` = 512). This transform does not
 * bridge that difference, so a chained `^` still evaluates the JS way — a known
 * limitation tracked separately (#2359), pinned by the tests. */
export function caretToPow(expr: string): string {
  return expr.replace(/\^/g, "**");
}

/** Move the "inside a string literal" marker across one quote character.
 * Empty marker means "not in a literal"; otherwise it holds the opening quote. */
function toggleQuote(openQuote: string, char: string): string {
  if (openQuote === "") return char;
  return char === openQuote ? "" : openQuote;
}

/** Excel `&` string concatenation → JS `+`, leaving any `&` inside a quoted
 *  string literal untouched. A quote toggles the "inside a literal" state only
 *  when it is not backslash-escaped. */
export function replaceConcatOperator(expr: string): string {
  const out: string[] = [];
  let openQuote = "";
  for (let index = 0; index < expr.length; index++) {
    const char = expr[index];
    const escaped = index > 0 && expr[index - 1] === "\\";
    if (!escaped && (char === '"' || char === "'")) {
      openQuote = toggleQuote(openQuote, char);
    }
    out.push(char === "&" && openQuote === "" ? "+" : char);
  }
  return out.join("");
}

/** Excel `=` equality → JS `==`, without disturbing `<=`, `>=` or `!=`. A single
 *  `=` is rewritten only when flanked by a non-`<>!` char on the left and a
 *  non-`=` on the right.
 *
 * Known limitations, pinned by the tests and tracked separately (#2359): the
 * match consumes both flanking characters so replacements do not overlap
 * (`5=6=7` → `5==6=7`, only the first rewritten); a `=` at either end of the
 * expression has no left/right neighbour and is left alone (`5=` → `5=`); and a
 * hand-typed `==` becomes `===` (its second `=` matches). Excel never emits the
 * last two, so they only bite malformed input. */
export function rewriteComparisonEq(expr: string): string {
  return expr.replace(/([^<>!])=([^=])/g, "$1==$2");
}

/** Whether an expression contains only the characters an arithmetic evaluation
 *  may see: digits, ` + - * / ( ) . ` and spaces. Gates `new Function`. */
export function isSafeArithmetic(expr: string): boolean {
  return /^[\d+\-*/(). ]+$/.test(expr);
}

/** Whether an expression contains only the characters a comparison evaluation
 *  may see: the arithmetic set plus ` < > ! = `. Gates `new Function`. */
export function isSafeComparison(expr: string): boolean {
  return /^[\d+\-*/(). <>!=]+$/.test(expr);
}
