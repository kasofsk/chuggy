/**
 * A repository's last configuration import as its line draws it, and what an
 * Import now came to.
 *
 * Every attempt is kept, a refused one included, so the line is the listing's
 * and an Import now only says what its own request was answered with, and
 * nothing where the line already draws what it came to as no fault.
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

/** The words that are no fault of the repository's: it declares nothing, holds no commit, or was never asked. */
const repositoryImportFaultlessWords = [
  "Undeclared",
  "Empty",
  repositoryImportNever,
] as const;

export function repositoryImportFaultless(
  word: string,
): word is (typeof repositoryImportFaultlessWords)[number] {
  return (repositoryImportFaultlessWords as readonly string[]).includes(word);
}

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

/** A refused import's answer as one word, the line's own where the route names the outcome it kept. */
function repositoryImportRefusal(
  result: Exclude<ApiResult<{ readonly imported: true }>, { outcome: "Ok" }>,
): string {
  if (result.outcome === "Rejected")
    return repositoryImportRefusals[result.code] ?? "Refused";
  if (result.outcome === "Conflict")
    return repositoryImportRefusals[result.code] ?? "Conflict";
  if (result.outcome === "Retryable") return "Unavailable";
  return repositoryRefusalStatus(result);
}

/** One Import now's answer, and the instant of the attempt the line held when it was pressed. */
export interface RepositoryImportPressed {
  readonly answered: ApiResult<{ readonly imported: true }>;
  readonly over: string | undefined;
}

/**
 * What an Import now leaves to be said under the line: nothing where it
 * imported or came to no fault, and its refusal's word otherwise. An Import now
 * names no commit, so the only miss it keeps is a repository holding none, and
 * a miss beside an attempt newer than the one pressed over is that, which the
 * line says.
 */
export function repositoryImportNote(
  pressed: RepositoryImportPressed | undefined,
  line: RepositoryImportLine,
): string | undefined {
  if (pressed === undefined || pressed.answered.outcome === "Ok")
    return undefined;
  const kept = "attemptedAt" in line && line.attemptedAt !== pressed.over;
  if (kept && repositoryImportFaultless(line.word)) return undefined;
  const word = repositoryImportRefusal(pressed.answered);
  return repositoryImportFaultless(word) ? undefined : word;
}
