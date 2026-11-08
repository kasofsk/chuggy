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

import type { CodesCopy } from "./generated/codesCopy.ts";
import type { FiguresCopy } from "./generated/figuresCopy.ts";
import type { SentencesCopy } from "./generated/sentencesCopy.ts";
import type { SetupCopy } from "./generated/setupCopy.ts";
import type { ShellCopy } from "./generated/shellCopy.ts";
import type { StandingCopy } from "./generated/standingCopy.ts";
import type { TonesCopy } from "./generated/tonesCopy.ts";

type CopyCatalog = CodesCopy<CopyArgument> &
  FiguresCopy<CopyArgument> &
  SentencesCopy<CopyArgument> &
  SetupCopy &
  ShellCopy<CopyArgument> &
  StandingCopy &
  TonesCopy<CopyArgument>;

export type CopyId = keyof CopyCatalog;

export type Copy = {
  readonly [Id in CopyId]: keyof CopyCatalog[Id] extends never
    ? { readonly id: Id }
    : { readonly id: Id; readonly args: CopyCatalog[Id] };
}[CopyId];

/** What a message is formatted with: a value, or another descriptor, whose
 * words stand in its place, so a line a decision joins from two is still
 * worded by the catalog alone. */
export type CopyArgument = string | number | CopyHanded;

/** A descriptor handed to another as a variable, held by its id: its own
 * variables were checked where it was made, as a `Copy`, and an interface is
 * what lets a descriptor be one of the variables that type it. */
export interface CopyHanded {
  readonly id: CopyId;
  readonly args?: object;
}

/** The port a decision that needs the words themselves, to measure or to
 * print them, is handed. */
export type CopyText = (copy: Copy) => string;
