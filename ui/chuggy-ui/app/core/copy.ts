/**
 * What a reader is told, as the decision layer says it: a catalog id and the
 * variables its message is formatted with, never the words. The words are the
 * catalog's, in `ui/chuggy-ui/app/copy/`, and what formats a descriptor is the
 * layer that draws it.
 *
 * Each section's ids are typed by the module generated from its catalog file,
 * so an id the catalog lacks, or a message handed other variables than its
 * own, does not compile.
 */

import type { SetupCopy } from "./generated/setupCopy.ts";
import type { ShellCopy } from "./generated/shellCopy.ts";
import type { StandingCopy } from "./generated/standingCopy.ts";

type CopyCatalog = SetupCopy & ShellCopy & StandingCopy;

export type CopyId = keyof CopyCatalog;

export type Copy = {
  readonly [Id in CopyId]: keyof CopyCatalog[Id] extends never
    ? { readonly id: Id }
    : { readonly id: Id; readonly args: CopyCatalog[Id] };
}[CopyId];

/** The port a decision that needs the words themselves, to measure or to
 * print them, is handed. */
export type CopyText = (copy: Copy) => string;
