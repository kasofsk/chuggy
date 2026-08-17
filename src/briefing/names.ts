/**
 * A transform's name, branded so a bare string cannot be passed where a name is
 * required. Only that direction: an intersection with `string` stays assignable
 * to `string`, so a name can still be passed as prompt text.
 */

declare const transformNameBrand: unique symbol;

export type TransformName = string & { readonly [transformNameBrand]: true };

export function asTransformName(value: string): TransformName {
  if (value.trim() === "") {
    throw new RangeError("transform name: blank");
  }
  return value as TransformName;
}
