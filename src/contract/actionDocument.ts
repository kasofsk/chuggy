/**
 * The document a repository declares one action in.
 *
 * CHUGGY DOES NOT RUN AN ACTION. The document names something that happens to
 * a repository's commits and nothing about how, when or where it happens, so
 * no field here can read as a promise that Chuggy will run it.
 *
 * A DOCUMENT NAMES NO REPOSITORY. Its action belongs to the repository it is
 * read from, whose identity the reader holds and the tree does not.
 *
 * A FIELD THE DOCUMENT HAS NO PLACE FOR IS REFUSED RATHER THAN DROPPED: a
 * dropped field is a declaration its author believes was read.
 */

import { z } from "zod";

import { isBoundedText } from "./http.ts";

/** The one document version this tree reads. */
export const actionDocumentVersion = 1;

/** The longest identity an action is declared under. */
export const actionIdentityCharsMax = 128;

/** The longest name a reader is shown for an action. */
export const actionNameCharsMax = 256;

/**
 * One action: `action` is its identity, letters and digits with `.`, `_` and
 * `-` only between them, which makes it one URL path segment exactly as
 * written. `name` is what a reader is shown, bounded here and held to one
 * printable line where the document is read.
 */
export const actionDocumentSchema = z.strictObject({
  version: z.literal(actionDocumentVersion),
  action: z
    .string()
    .max(actionIdentityCharsMax)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u),
  name: z.string().refine((value) => isBoundedText(value, actionNameCharsMax)),
});
