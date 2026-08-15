/**
 * An effect paired with the journal sequence number that authorized it.
 *
 * The engineering bar states the rule this type exists to make expressible:
 * effects are keyed by their decision's journal sequence number and absorb on
 * redelivery. A bare effect cannot be absorbed, because nothing about it says
 * which decision emitted it; the key is what makes redelivery recognizable.
 *
 * It is generic in the effect. The eight effect constructors the model names
 * arrive in a later slice and slot in here without this file moving — which is
 * the point of writing the envelope separately from its contents.
 */

import { invariant } from "../domain/assert.ts";

export type Keyed<E> = {
  /** The journal sequence number of the decision that emitted this effect. */
  readonly seq: number;
  readonly effect: E;
};

/**
 * Pair an effect with its authorizing journal sequence number.
 *
 * The sequence number is checked rather than trusted: it indexes an
 * append-only journal, so a negative, fractional or unsafe value is a caller
 * bug that would otherwise surface much later as a mis-absorbed duplicate.
 */
export function keyed<E>(seq: number, effect: E): Keyed<E> {
  invariant(
    Number.isSafeInteger(seq) && seq >= 0,
    `journal sequence number must be a non-negative safe integer, got ${String(seq)}`,
  );
  return { seq, effect };
}
