/**
 * The invariant roster `model/domain.qnt` declares, read out of the model at
 * run time.
 *
 * IT IS THE MECHANISM `test/golden/corpus.ts` ALREADY USES for the step-label
 * and exemption-arm rosters, pointed at a different declaration: the model is
 * the specification, so a list of its members maintained by hand here would go
 * stale the moment one was added there — silently, which is the failure a
 * roster check exists to prevent. An invariant added to the model becomes a
 * failure in this tree instead.
 *
 * BOTH ROSTERS COME OUT OF ONE RULE. A conjunct whose own definition is
 * nothing but a conjunction of bare names is itself a bundle and expands; a
 * conjunct defined by any expression is a leaf and stands. That is why the two
 * counts differ, and neither is written down here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The model, as text. Reading it is the whole point: a declaration is a claim a grep can check. */
function modelSource(root: string): string {
  return readFileSync(join(root, "model", "domain.qnt"), "utf8");
}

/** The body a `val <name>: bool = and {` opens, matched brace to brace so a one-line bundle reads the same. */
function conjunctionBody(source: string, name: string): string | undefined {
  const opener = `\n  val ${name}: bool = and {`;
  const start = source.indexOf(opener);
  if (start < 0) return undefined;
  let depth = 0;
  for (let at = start + opener.length - 1; at < source.length; at++) {
    if (source[at] === "{") depth++;
    else if (source[at] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + opener.length, at);
    }
  }
  return undefined;
}

/**
 * The bare names a conjunction conjoins, or nothing when any part of it is an
 * expression. Nothing is what makes the enclosing name a leaf.
 */
export function conjunctNames(
  source: string,
  name: string,
): readonly string[] | undefined {
  const body = conjunctionBody(source, name);
  if (body === undefined) return undefined;
  const names: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    for (const piece of line.split(",")) {
      const text = piece.trim();
      if (text === "") continue;
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(text)) return undefined;
      names.push(text);
    }
  }
  return names;
}

/** The conjuncts of the model's own `allInvariants`, in the order it lists them. */
export function declaredBundle(root: string): readonly string[] {
  const names = conjunctNames(modelSource(root), "allInvariants");
  if (names === undefined || names.length === 0) {
    throw new Error(
      "declared: model/domain.qnt's allInvariants is not the conjunction of names this reader expects",
    );
  }
  return names;
}

/** The same roster with every conjunct that is itself a bundle expanded into its own members. */
export function declaredLeaves(root: string): readonly string[] {
  const source = modelSource(root);
  return declaredBundle(root).flatMap(
    (name) => conjunctNames(source, name) ?? [name],
  );
}
