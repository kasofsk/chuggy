/**
 * The document a repository declares one action in, under `.chug/actions/`.
 *
 * AN ACTION IS REPORTED, NOT RUN. The document names what happens to a
 * repository's commits and nothing about how, when or where it happens, so no
 * field here can read as a promise that Chuggy will run it.
 *
 * A FIELD THE DOCUMENT HAS NO PLACE FOR IS REFUSED RATHER THAN DROPPED, as
 * `src/interpreter/taskConfiguration.ts` does for a block: a dropped field is a
 * declaration its author believes was read.
 */

import { z } from "zod";

import {
  boundedTextRefusal,
  repositoryConfigurationNameCharsMax,
} from "./http.ts";

/** The one envelope version this tree reads and writes. */
export const actionDocumentVersion = 1;

/** The longest display name a reader is shown. */
export const actionDisplayNameCharsMax = 256;

/** The longest repository identity a document may name, the bound every repository identity is branded under. */
export const actionRepositoryCharsMax = 256;

/** Text a bounded column holds at `max` code points, held to `pattern` where one is given. */
function actionDocumentText(max: number, pattern?: RegExp): z.ZodString {
  const text = z
    .string()
    .refine((value) => boundedTextRefusal(value, max) === undefined);
  return pattern === undefined ? text : text.regex(pattern);
}

/**
 * One action. `action` is its identity, stable across commits and named by
 * every report, and is held to the rule a configuration name is; `name` is what
 * a reader is shown; `repository` is the binding whose commits it acts on.
 */
export const actionDocumentSchema = z.strictObject({
  version: z.literal(actionDocumentVersion),
  action: actionDocumentText(
    repositoryConfigurationNameCharsMax,
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u,
  ),
  name: actionDocumentText(actionDisplayNameCharsMax),
  repository: actionDocumentText(actionRepositoryCharsMax),
});

export type ActionDocument = z.infer<typeof actionDocumentSchema>;
