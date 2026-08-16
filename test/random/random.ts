/**
 * The walk's only source of randomness: a small splitmix-scrambled generator
 * whose whole state is one integer, so a run is a pure function of its seed and
 * a failure message that carries the seed carries the run.
 *
 * It is hand-rolled rather than imported, and deliberately: the model already
 * prescribes every draw set, so a property-testing library's generators would
 * have nothing to generate, and its own seed plumbing would displace the
 * seed-in-the-message reproducibility this module exists to provide. What is
 * left is the scrambler below, which is the ecosystem's stock shape for a tiny
 * seeded generator in JavaScript.
 */

/** What a draw site may ask for: a uniform pick bound, or a fair coin. */
export interface Random {
  below(bound: number): number;
  coin(): boolean;
}

/** The generator over the given seed. Two calls with one seed yield one sequence. */
export function randomOf(seed: number): Random {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`random: ${String(seed)} is not a usable seed`);
  }
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let word = state;
    word = Math.imul(word ^ (word >>> 15), word | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return (word ^ (word >>> 14)) >>> 0;
  };
  return {
    below(bound: number): number {
      if (!Number.isSafeInteger(bound) || bound < 1) {
        throw new RangeError(`random: an empty draw set has no pick to make`);
      }
      return Math.floor((next() / 2 ** 32) * bound);
    },
    coin(): boolean {
      return (next() & 1) === 1;
    },
  };
}

/** A uniform pick from a non-empty list, which every `oneOf` draw below mirrors. */
export function pickFrom<T>(random: Random, items: readonly T[]): T {
  const picked = items[random.below(items.length)];
  if (picked === undefined) {
    throw new RangeError("random: the pick fell outside its own set");
  }
  return picked;
}

/** A uniform subset of a list: one fair coin per member, which is `powerset().oneOf()`. */
export function subsetFrom<T>(random: Random, items: readonly T[]): T[] {
  return items.filter(() => random.coin());
}
