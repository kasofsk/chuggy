/**
 * The interpretation layer's structural promise, on its own: within one call,
 * each keyed effect reaches its handler at most once, in issue order, within
 * an explicit bound.
 *
 * Three engineering-bar items meet here and nowhere else. Effects "absorb on
 * redelivery" — so a sequence number already handled is skipped rather than
 * handled again, because an at-least-once channel upstream must not become
 * at-least-once execution downstream. "Everything is bounded" — so the caller
 * states a ceiling and exceeding it is an assertion failure, not a long loop.
 * And issue order is checked rather than assumed, because a fresh effect
 * arriving behind one already handled means the caller reordered a journal,
 * which nothing downstream can detect.
 *
 * THE SCOPE OF "AT MOST ONCE" IS ONE CALL, and claiming more would be a
 * promise this function is in no position to keep. The set of handled sequence
 * numbers is built per call and discarded with it, so a redelivery arriving in
 * a LATER batch is handled again — and the order check has no memory of the
 * previous batch's high-water mark either. Absorption ACROSS calls needs a
 * cursor that outlives them; that cursor is the executor's, and it is s5's.
 * What is here is the within-batch half, which is the half that does not
 * depend on a journal existing yet.
 *
 * It is generic in both the effect and the handler's result. The effect
 * vocabulary, the ports, and the interpreter that names them arrive in a later
 * slice; what is here is the part that does not depend on any of them.
 */

import { invariant } from "../domain/assert.ts";
import type { Keyed } from "../effects/keyed.ts";

export function deliverOnce<E, R>(
  effects: readonly Keyed<E>[],
  handle: (keyed: Keyed<E>) => R,
  maxEffects: number,
): readonly R[] {
  invariant(
    Number.isSafeInteger(maxEffects) && maxEffects >= 0,
    `delivery bound must be a non-negative safe integer, got ${String(maxEffects)}`,
  );
  invariant(
    effects.length <= maxEffects,
    `delivery bound of ${String(maxEffects)} exceeded by ${String(effects.length)} effects`,
  );

  const handled = new Set<number>();
  const results: R[] = [];
  let highWater = -1;

  for (const item of effects) {
    if (handled.has(item.seq)) {
      continue;
    }
    invariant(
      item.seq > highWater,
      `effect ${String(item.seq)} arrived behind ${String(highWater)}; delivery is in issue order`,
    );
    handled.add(item.seq);
    highWater = item.seq;
    results.push(handle(item));
  }

  return results;
}
