/**
 * A seeded generator, so a sequence that finds something can be run again. It
 * is mulberry32 rather than a bare linear congruential step, whose first draw
 * from a small seed spans a fraction of the unit interval — every sequence then
 * opens on the same shape, and a generator that starts every run in one place
 * explores far less than its seed count suggests.
 */
export function seededRandom(seed: number): () => number {
  let held = (seed + 0x6d_2b_79_f5) >>> 0;
  return () => {
    held = (held + 0x6d_2b_79_f5) >>> 0;
    let mixed = Math.imul(held ^ (held >>> 15), held | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
