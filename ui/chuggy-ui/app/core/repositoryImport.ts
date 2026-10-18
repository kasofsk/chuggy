/**
 * A repository's last configuration import as its line draws it, and what an
 * Import now came to.
 *
 * Every attempt is kept, a refused one included, so the line is the listing's
 * and an Import now only says what its own request was answered with.
 */

import type { RepositoryConfigurationImportAttemptResponse } from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { commitLabel, type Label } from "./labels.ts";
import { repositoryRefusalStatus } from "./projectRepositories.ts";

/** How an attempt came out, as one word. */
export type RepositoryImportWord =
  | "Imported"
  | "Undeclared"
  | "Missing"
  | "Empty"
  | "Unavailable"
  | "Unreadable"
  | "Invalid"
  | "Conflict"
  | "Stale";

/** What the line says of a repository no import was attempted of. */
export const repositoryImportNever = "Never";

/** What the line's label is. */
export const repositoryImportLabel = "Last import";

/** What the button says, idle and while its request runs. */
export const repositoryImportPress = {
  idle: "Import now",
  busy: "Importing…",
} as const;

/**
 * A commit holding no configuration directory is Undeclared. One the snapshot
 * could not find is Missing, and a head that named no commit is an Empty
 * repository.
 */
export function repositoryImportWord(
  attempt: RepositoryConfigurationImportAttemptResponse,
): RepositoryImportWord {
  const outcome = attempt.outcome;
  switch (outcome.result) {
    case "Imported":
      return "Imported";
    case "SnapshotAbsent":
      if (outcome.absent === "ConfigurationDirectory") return "Undeclared";
      return attempt.commit === undefined ? "Empty" : "Missing";
    case "Unavailable":
      return "Unavailable";
    case "SnapshotRefused":
      return "Unreadable";
    case "DeclarationsRefused":
      return "Invalid";
    case "IdentityConflict":
      return "Conflict";
    case "StaleBinding":
      return "Stale";
  }
}

/** The line: the outcome's word, and when and at which commit where there is an attempt. */
export type RepositoryImportLine =
  | { readonly word: typeof repositoryImportNever }
  | {
      readonly word: RepositoryImportWord;
      readonly attemptedAt: string;
      readonly commit?: Label;
    };

export function repositoryImportLine(
  lastImport: RepositoryConfigurationImportAttemptResponse | undefined,
): RepositoryImportLine {
  if (lastImport === undefined) return { word: repositoryImportNever };
  return {
    word: repositoryImportWord(lastImport),
    attemptedAt: lastImport.attemptedAt,
    ...(lastImport.commit === undefined
      ? {}
      : { commit: commitLabel(lastImport.commit) }),
  };
}

/** The refusals the import route answers with a code of its own, as the words the line draws the attempt in. */
const repositoryImportRefusals: Readonly<
  Record<string, RepositoryImportWord | undefined>
> = {
  RepositoryConfigurationsAbsent: "Undeclared",
  RepositorySnapshotRefused: "Unreadable",
  RepositoryConfigurationsRefused: "Invalid",
  ConfigurationIdentityConflict: "Conflict",
  RepositoryBindingChanged: "Stale",
};

/** What an Import now leaves to be said: nothing where the route imported, and its refusal's word otherwise. */
export function repositoryImportNote(
  result: ApiResult<{ readonly imported: true }>,
): string | undefined {
  if (result.outcome === "Ok") return undefined;
  if (result.outcome === "Rejected")
    return repositoryImportRefusals[result.code] ?? "Refused";
  if (result.outcome === "Conflict")
    return repositoryImportRefusals[result.code] ?? "Conflict";
  if (result.outcome === "Retryable") return "Unavailable";
  return repositoryRefusalStatus(result);
}
