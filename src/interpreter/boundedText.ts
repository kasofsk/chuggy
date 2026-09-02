/**
 * The one refusal every opaque string entering a stored row passes through.
 *
 * IT IS A LEAF SO THAT EVERY IDENTITY MODULE CAN REACH IT. The operation
 * inbox, the scheduler's identities and the finalizer's each brand text against
 * a bound of their own, and a copy per module is a copy per module to keep
 * current. `.dependency-cruiser.cjs` refuses a cycle at all, so a shared leaf is
 * the shape rather than a preference.
 */

/** Why one string is not text a bounded column holds, or nothing where it is. */
type BoundedTextRefusal =
  | { readonly refused: "Empty" }
  | { readonly refused: "Unpaired" }
  | { readonly refused: "Nul" }
  | { readonly refused: "TooLong"; readonly chars: number };

/**
 * The whole rule, asked once so the door and the brand cannot answer it
 * differently: an opaque string with no cap is an unbounded row, one carrying
 * an unpaired surrogate is a value every UTF-8 encoding of it folds to the
 * replacement character, so two such strings share one digest and one stored
 * row, and one carrying a NUL is a value no PostgreSQL text or `jsonb` holds at
 * all — a row refused by the cast that discovers it rather than by the door
 * that took it.
 */
function boundedTextRefusal(
  value: string,
  charsMax: number,
): BoundedTextRefusal | undefined {
  if (value.length === 0) return { refused: "Empty" };
  if (!value.isWellFormed()) return { refused: "Unpaired" };
  if (value.includes("\u0000")) return { refused: "Nul" };
  return value.length > charsMax
    ? { refused: "TooLong", chars: value.length }
    : undefined;
}

/**
 * Whether text is one a bounded column holds, which is `asBoundedText`'s own
 * question without its raise. A route reading a caller's body needs the answer
 * rather than the refusal: a value a stored row could not hold is a status to
 * answer with, where a raise crossing a route is an internal message in a body
 * the caller has no arm for.
 */
export function isBoundedText(value: string, charsMax: number): boolean {
  return boundedTextRefusal(value, charsMax) === undefined;
}

/** Refuses text a bounded column cannot hold, and text that is not text. */
export function asBoundedText(
  value: string,
  what: string,
  charsMax: number,
): string {
  const refusal = boundedTextRefusal(value, charsMax);
  if (refusal === undefined) return value;
  switch (refusal.refused) {
    case "Empty":
      throw new RangeError(`${what}: a value is empty`);
    case "Unpaired":
      throw new RangeError(
        `${what}: an unpaired surrogate is not a value a digest can separate`,
      );
    case "Nul":
      throw new RangeError(`${what}: a NUL is not a value a stored row holds`);
    case "TooLong":
      throw new RangeError(
        `${what}: ${String(refusal.chars)} characters is past the ${String(charsMax)} a stored row holds`,
      );
  }
}
