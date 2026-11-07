/**
 * The catalog made into what formats a descriptor, for a browser and for Node
 * alike.
 *
 * A VERNACULAR IS A LAYER OVER A LANGUAGE, NOT A LANGUAGE OF ITS OWN. One
 * bundle holds the base resources and then the vernacular's, each allowed to
 * override what is already there, so a term it renames is renamed inside every
 * base message that references it. A chain of bundles would not do this: a
 * message found in the base resolves its terms against the base. A vernacular
 * is named `en-x-<name>`, a private use of the language it layers.
 */

import { FluentBundle, FluentResource } from "@fluent/bundle";

import type { Copy, CopyText } from "../core/copy.ts";

export function copyBundleOf(
  locale: string,
  base: readonly string[],
  layer: readonly string[] = [],
): FluentBundle {
  const bundle = new FluentBundle(locale, { useIsolating: false });
  for (const source of base) copyResourceAdded(bundle, source, false);
  for (const source of layer) copyResourceAdded(bundle, source, true);
  return bundle;
}

function copyResourceAdded(
  bundle: FluentBundle,
  source: string,
  allowOverrides: boolean,
): void {
  const errors = bundle.addResource(new FluentResource(source), {
    allowOverrides,
  });
  if (errors.length > 0)
    throw new Error(
      `the copy catalog does not load: ${errors.map(String).join("; ")}`,
    );
}

/** The words of a descriptor, as a bundle formats them. */
export function copyTextOf(bundle: FluentBundle): CopyText {
  return (copy: Copy) => {
    const pattern = bundle.getMessage(copy.id)?.value;
    if (pattern === undefined || pattern === null)
      throw new Error(`the copy catalog has no message ${copy.id}`);
    const errors: Error[] = [];
    const text = bundle.formatPattern(
      pattern,
      "args" in copy ? copy.args : null,
      errors,
    );
    if (errors.length > 0)
      throw new Error(
        `the copy catalog cannot format ${copy.id}: ${errors.map(String).join("; ")}`,
      );
    return text;
  };
}
