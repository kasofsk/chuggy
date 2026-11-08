/**
 * A decision's answer with every descriptor in it formatted by the base
 * language's catalog, so a suite asserts what a reader is shown rather than
 * which ids say it.
 */

import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";

export type SaidEn<T> = T extends Copy
  ? string
  : T extends readonly (infer U)[]
    ? readonly SaidEn<U>[]
    : T extends object
      ? { readonly [K in keyof T]: SaidEn<T[K]> }
      : T;

function isCopy(value: object): value is Copy {
  const keys = Object.keys(value);
  return (
    "id" in value &&
    typeof value.id === "string" &&
    keys.every((key) => key === "id" || key === "args")
  );
}

export function saidEn<T>(value: T): SaidEn<T> {
  if (Array.isArray(value)) return value.map(saidEn) as SaidEn<T>;
  if (typeof value !== "object" || value === null) return value as SaidEn<T>;
  if (isCopy(value)) return copyTextEn(value) as SaidEn<T>;
  return Object.fromEntries(
    Object.entries(value).map(([key, held]) => [key, saidEn(held)]),
  ) as SaidEn<T>;
}
