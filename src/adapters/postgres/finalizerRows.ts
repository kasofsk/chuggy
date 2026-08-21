/**
 * The row vocabulary the finalizer's transactions share: the request states a
 * predicate spells, the narrowing that refuses a column value no migration can
 * have written, and the bound check every paged query owes its caller.
 *
 * A COLUMN IS NARROWED AND NEVER CAST. A `text` column arrives as a string the
 * driver knows nothing about, so a value outside the closed set the port
 * declares raises here rather than travelling on as a type the compiler was told
 * to believe.
 */

/** The states a request is still working through, which a claim and a submission both need it to be in. */
export const finalizerLiveRequestStates = "'Open', 'Registered'";

/** The states no claim outlives, which is where a lease is dropped rather than reopened. */
export const finalizerSettledRequestStates = "'Fulfilled', 'Invalidated'";

/** Refuses a bound no work can be drawn under, naming the argument rather than the row. */
export function finalizerBounded(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `postgres finalizer: ${what} of ${String(value)} is not a positive bound`,
    );
  }
}

/** Narrows a column to the closed set the port declares, refusing what no migration can have written. */
export function finalizerRowValue<Value extends string>(
  admitted: readonly Value[],
  value: string,
  what: string,
): Value {
  const found = admitted.find((each) => each === value);
  if (found === undefined) {
    throw new Error(`finalizer row: ${value} is not a ${what} this code knows`);
  }
  return found;
}
