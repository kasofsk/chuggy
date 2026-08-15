/**
 * The interpretation layer's structural promise, on its own: each keyed effect
 * reaches its handler at most once, in issue order, within an explicit bound.
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
