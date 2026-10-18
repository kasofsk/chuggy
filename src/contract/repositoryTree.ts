/**
 * What a read of one directory of a bound repository's tree is asked and
 * answers.
 *
 * A READ NAMES A REPOSITORY THE PROJECT BINDS, a directory, and a commit where
 * it names one. An absent commit is the default branch's head, and an absent or
 * empty directory is the root.
 *
 * A LISTING NAMES THE COMMIT IT WAS READ AT, so the read of a subdirectory can
 * name that same commit. Every other answer says which way there was none, and
 * none of them is an error.
 */

import { z } from "zod";

import { repositoryTreeEntriesAnsweredMax } from "./http.ts";

/** One entry by its name in its directory. */
export const repositoryTreeEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    name: z.string().min(1),
    kind: z.literal("File"),
    executable: z.boolean(),
  }),
  z.strictObject({
    name: z.string().min(1),
    kind: z.enum(["Directory", "Symlink", "Submodule"]),
  }),
]);

export const repositoryTreeResponseSchema = z.discriminatedUnion("read", [
  z.strictObject({
    read: z.literal("Listed"),
    commit: z.string().regex(/^[0-9a-f]+$/u),
    directory: z.string(),
    entries: z
      .array(repositoryTreeEntrySchema)
      .max(repositoryTreeEntriesAnsweredMax),
    truncated: z.boolean(),
  }),
  z.strictObject({
    read: z.literal("Absent"),
    absent: z.enum(["Commit", "Directory"]),
  }),
  z.strictObject({
    read: z.literal("Unavailable"),
    unavailable: z.enum(["Scratch", "Repository"]),
  }),
]);
export type RepositoryTreeResponse = z.infer<
  typeof repositoryTreeResponseSchema
>;
