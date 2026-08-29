/**
 * The one refusal every opaque string entering a stored row passes through.
 *
 * IT IS A LEAF SO THAT EVERY IDENTITY MODULE CAN REACH IT. The operation
 * inbox, the scheduler's identities and the finalizer's each brand text against
 * a bound of their own, and a copy per module is a copy per module to keep
 * current. `.dependency-cruiser.cjs` refuses a cycle at all, so a shared leaf is
 * the shape rather than a preference.
 */

/**
 * Refuses text a bounded column cannot hold, and text that is not text: an
 * opaque string with no cap is an unbounded row, one carrying an unpaired
 * surrogate is a value every UTF-8 encoding of it folds to the replacement
 * character, so two such strings share one digest and one stored row, and one
 * carrying a NUL is a value no PostgreSQL text or `jsonb` holds at all — a row
 * refused by the cast that discovers it rather than by the door that took it.
 */
export function asBoundedText(
  value: string,
  what: string,
  charsMax: number,
): string {
  if (value.length === 0) throw new RangeError(`${what}: a value is empty`);
  if (!value.isWellFormed()) {
    throw new RangeError(
      `${what}: an unpaired surrogate is not a value a digest can separate`,
    );
  }
  if (value.includes("\u0000")) {
    throw new RangeError(`${what}: a NUL is not a value a stored row holds`);
  }
  if (value.length > charsMax) {
    throw new RangeError(
      `${what}: ${String(value.length)} characters is past the ${String(charsMax)} a stored row holds`,
    );
  }
  return value;
}
