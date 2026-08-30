/**
 * The check every HTTP client here narrows its configured limits through.
 *
 * A BOUND IS A SAFE INTEGER OR IT IS NOT A BOUND. A limit held at a magnitude
 * arithmetic has stopped being exact in compares wrongly, and then admits the
 * value it was written to refuse; the narrowing happens where the
 * configuration arrives rather than where it is compared.
 */

export function checkedPositiveBound(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${what} must be a positive safe integer`);
  return value;
}
