/**
 * Every wording the console can be drawn in, and the bundle of each: the base
 * language, the pseudo wording over it, and each vernacular the catalog holds,
 * by its name.
 */

import type { FluentBundle } from "@fluent/bundle";

import { copyCatalogEn, copyLocale } from "./catalog.ts";
import { copyBundleOf } from "./copyBundle.ts";
import { copyPseudoBundleOf, copyPseudoLocale } from "./copyPseudo.ts";

export type CopyVernaculars = Readonly<Record<string, readonly string[]>>;

/** The wordings offered, the base language first. */
export function copyWordingsOf(
  vernaculars: CopyVernaculars,
): readonly string[] {
  return [copyLocale, copyPseudoLocale, ...Object.keys(vernaculars).sort()];
}

export function copyWordingBundle(
  wording: string,
  vernaculars: CopyVernaculars,
): FluentBundle {
  if (wording === copyPseudoLocale) return copyPseudoBundleOf(copyCatalogEn);
  const layer = vernaculars[wording];
  if (wording !== copyLocale && layer === undefined)
    throw new Error(`the copy catalog holds no wording ${wording}`);
  return copyBundleOf(wording, copyCatalogEn, layer);
}
