declare const instantBrand: unique symbol;

/** A database-authored RFC 3339 instant, used only for presentation. */
export type PublicInstant = string & { readonly [instantBrand]: true };

export function asPublicInstant(value: string): PublicInstant {
  if (value.length === 0)
    throw new RangeError("public instant: a value is empty");
  return value as PublicInstant;
}
