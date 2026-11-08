/**
 * A decision's answer with every descriptor in it formatted by the base
 * language's catalog, so a suite holds what a reader is shown in the words
 * they read rather than in ids.
 */

import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";

function copiedWordsDescriptor(value: object): value is Copy {
  const keys = Object.keys(value);
  return (
    "id" in value &&
    typeof value.id === "string" &&
    keys.every((key) => key === "id" || key === "args")
  );
}

export function copiedWords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copiedWords);
  if (typeof value !== "object" || value === null) return value;
  if (copiedWordsDescriptor(value)) return copyTextEn(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, held]) => [key, copiedWords(held)]),
  );
}
