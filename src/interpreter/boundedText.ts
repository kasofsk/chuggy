/**
 * The one refusal every opaque string entering a stored row passes through.
 *
 * IT IS A LEAF SO THAT EVERY IDENTITY MODULE CAN REACH IT. The operation
 * inbox, the scheduler's identities and the finalizer's each brand text against
 * a bound of their own, and a copy per module is a copy per module to keep
 * current. `.dependency-cruiser.cjs` refuses a cycle at all, so a shared leaf is
 * the shape rather than a preference.
 */

import { boundedTextRefusal } from "../contract/http.ts";

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
