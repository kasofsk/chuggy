/**
 * The pseudo wording: the base language with every word it says altered, so a
 * string still spelled outside the catalog is the plain English beside it.
 *
 * Each letter is accented and each vowel doubled, which keeps a word readable,
 * makes it longer as a translation would be, and leaves it breaking where it
 * did; a whole
 * message is bracketed, so one cut short shows where. A variable's value is
 * not the catalog's text, so the transform never reaches it.
 */

import { FluentBundle } from "@fluent/bundle";

import { copyCatalogAdded } from "./copyBundle.ts";

export const copyPseudoLocale = "en-x-pseudo";

const copyPseudoPlain = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const copyPseudoAccented = [
  ..."ȦƁƇḒḖƑƓĦĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐȧƀƈḓḗƒɠħīĵķŀḿƞǿƥɋřşŧŭṽẇẋẏẑ",
];

/** A text element of the catalog, as the pseudo wording says it. */
export function copyPseudoText(text: string): string {
  return [...text]
    .map((letter) => {
      const at = copyPseudoPlain.indexOf(letter);
      if (at < 0) return letter;
      const accented = copyPseudoAccented[at] ?? letter;
      return "AEIOUaeiou".includes(letter) ? accented + accented : accented;
    })
    .join("");
}

class CopyPseudoBundle extends FluentBundle {
  override formatPattern(
    ...given: Parameters<FluentBundle["formatPattern"]>
  ): string {
    return `[${super.formatPattern(...given)}]`;
  }
}

/** The base language's catalog, said in the pseudo wording. */
export function copyPseudoBundleOf(base: readonly string[]): FluentBundle {
  return copyCatalogAdded(
    new CopyPseudoBundle(copyPseudoLocale, {
      useIsolating: false,
      transform: copyPseudoText,
    }),
    base,
  );
}
