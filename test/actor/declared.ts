/**
 * The rosters `model/refinement.qnt` declares, read out of the model at run
 * time: its two obligation bundles, and its `DecisionEvent` constructor vocabulary.
 *
 * It is `test/domain/declared.ts`'s mechanism pointed at the refinement
 * module: the model is the specification, so a hand-maintained list of its
 * members here would go stale silently the moment one was added there. The
 * conjunction reader is imported rather than rewritten; what is new is only
 * the constructor reader, because a sum type's roster is its declaration's
 * variant tags rather than a braced block of bare names.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { conjunctNames } from "../domain/declared.ts";

/** The refinement module, as text: a declaration is a claim a reader can check. */
function refinementSource(root: string): string {
  return readFileSync(join(root, "model", "refinement.qnt"), "utf8");
}

/** The conjuncts of one named bundle, refused loudly when the model no longer declares it that way. */
function declaredBundleOf(source: string, name: string): readonly string[] {
  const names = conjunctNames(source, name);
  if (names === undefined || names.length === 0) {
    throw new Error(
      `declared: model/refinement.qnt's ${name} is not the conjunction of names this reader expects`,
    );
  }
  return names;
}

/** The model's `refinementCore` members, in its order. */
export function declaredRefinementCore(root: string): readonly string[] {
  return declaredBundleOf(refinementSource(root), "refinementCore");
}

/** The model's `refinementInvariants` conjuncts as written, nested bundle unexpanded. */
export function declaredRefinementBundle(root: string): readonly string[] {
  return declaredBundleOf(refinementSource(root), "refinementInvariants");
}

/** The same roster with every conjunct that is itself a bundle expanded into its members. */
export function declaredRefinementObligations(root: string): readonly string[] {
  const source = refinementSource(root);
  return declaredBundleOf(source, "refinementInvariants").flatMap(
    (name) => conjunctNames(source, name) ?? [name],
  );
}

/**
 * The constructor tags of the model's `DecisionEvent`, in declaration order: the block
 * from the type's opener to its first blank line, one tag per variant arm.
 */
export function declaredDecisionEventConstructors(
  root: string,
): readonly string[] {
  const source = refinementSource(root);
  const start = source.indexOf("\n  type DecisionEvent =");
  if (start < 0) {
    throw new Error(
      "declared: model/refinement.qnt declares no DecisionEvent type",
    );
  }
  const end = source.indexOf("\n\n", start);
  const block = source.slice(start, end < 0 ? source.length : end);
  const tags: string[] = [];
  for (const line of block.split("\n")) {
    const arm = /^\s*\|?\s*([A-Z][A-Za-z]*)\(/.exec(line);
    const tag = arm?.[1];
    if (tag !== undefined) tags.push(tag);
  }
  if (tags.length === 0) {
    throw new Error(
      "declared: model/refinement.qnt's DecisionEvent holds no constructor this reader recognizes",
    );
  }
  return tags;
}
