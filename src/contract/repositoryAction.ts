/**
 * One named action a repository declares: a thing that happens to a
 * repository's commits, carried out by whatever the project already uses for
 * it and reported back rather than run here.
 *
 * THE DOCUMENT SAYS WHAT THE ACTION IS AND NOTHING OF HOW IT RUNS. It carries
 * the identity every report names it by, a display name for a reader, and the
 * repository whose commits it acts on. A trigger, a command or a place to run
 * would read as a promise that something here runs it, and nothing does.
 *
 * A FIELD THE DOCUMENT HAS NO PLACE FOR IS REFUSED RATHER THAN DROPPED, so a
 * declaration written expecting one to mean something is told it does not.
 */

import { z } from "zod";

import { isBoundedText, repositoryIdentityCharsMax } from "./http.ts";

export const repositoryActionIdentityCharsMax = 128;
export const repositoryActionNameCharsMax = 256;

/** The identity every report names an action by: a stable token, never prose. */
export const repositoryActionIdentitySchema = z
  .string()
  .refine(
    (value) =>
      isBoundedText(value, repositoryActionIdentityCharsMax) &&
      /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value),
  );

export const repositoryActionDocumentSchema = z.strictObject({
  version: z.literal(1),
  action: repositoryActionIdentitySchema,
  name: z
    .string()
    .refine((value) => isBoundedText(value, repositoryActionNameCharsMax)),
  repository: z
    .string()
    .refine((value) => isBoundedText(value, repositoryIdentityCharsMax)),
});

export type RepositoryActionDocument = z.infer<
  typeof repositoryActionDocumentSchema
>;
