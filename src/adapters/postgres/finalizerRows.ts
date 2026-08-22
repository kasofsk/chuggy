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

/**
 * Refuses a column the server types as nullable where this code requires a
 * value. The declared row type says what postgres returns, so a column that is
 * nullable there is nullable here, and the refusal names it rather than letting
 * `Number(null)` become a silent zero.
 */
export function finalizerRowPresent<Value>(
  value: Value | null,
  what: string,
): Value {
  if (value === null) {
    throw new Error(
      `finalizer row: ${what} is null on a row that must have one`,
    );
  }
  return value;
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
