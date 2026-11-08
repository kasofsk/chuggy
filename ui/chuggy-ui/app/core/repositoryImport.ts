/**
 * A repository's last configuration import as its line draws it, and what an
 * Import now came to.
 *
 * Every attempt is kept, a refused one included, so the line is the listing's
 * and an Import now only says what its own request was answered with, and
 * nothing where the line already draws what it came to as no fault.
 */

import type {
  ProjectRepositoryListedResponse,
  RepositoryConfigurationImportAttemptResponse,
  RepositoryConfigurationRefusalResponse,
} from "../../../../src/contract/responses.ts";
import type { RepositoryConfigurationFault } from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";
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

/** An attempt's word, or that none was attempted, as the line's pill says it. */
export function repositoryImportWordLabel(
  word: RepositoryImportWord | typeof repositoryImportNever,
): Copy {
  switch (word) {
    case "Imported":
      return { id: "repositories-import-imported" };
    case "Undeclared":
      return { id: "repositories-import-undeclared" };
    case "Missing":
      return { id: "repositories-import-missing" };
    case "Empty":
      return { id: "repositories-import-empty" };
    case "Unavailable":
      return { id: "repositories-unavailable" };
    case "Unreadable":
      return { id: "repositories-unreadable" };
    case "Invalid":
      return { id: "repositories-import-invalid" };
    case "Conflict":
      return { id: "repositories-conflict" };
    case "Stale":
      return { id: "repositories-import-stale" };
    case "Never":
      return { id: "repositories-import-never" };
  }
}

/** What the line's label is. */
export const repositoryImportLabel: Copy = { id: "repositories-import-label" };

/** What the button says, idle and while its request runs. */
export const repositoryImportPress = {
  idle: { id: "repositories-import-now" },
  busy: { id: "repositories-importing" },
} as const satisfies Readonly<Record<string, Copy>>;

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

/** A refused import's answer as one word, the line's own where the route
 * names the outcome it kept, and the word of a refusal that says nothing about
 * the repository otherwise. */
function repositoryImportRefusal(
  result: ApiFailure,
): RepositoryImportWord | Copy {
  if (result.outcome === "Rejected")
    return (
      repositoryImportRefusals[result.code] ?? { id: "repositories-refused" }
    );
  if (result.outcome === "Conflict")
    return repositoryImportRefusals[result.code] ?? "Conflict";
  if (result.outcome === "Retryable") return "Unavailable";
  return repositoryRefusalStatus(result);
}

function repositoryImportRefusalLabel(
  refusal: RepositoryImportWord | Copy,
): Copy {
  return typeof refusal === "string"
    ? repositoryImportWordLabel(refusal)
    : refusal;
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
): Copy | undefined {
  if (pressed === undefined || pressed.answered.outcome === "Ok")
    return undefined;
  const kept = "attemptedAt" in line && line.attemptedAt !== pressed.over;
  if (kept && repositoryImportFaultless(line.word)) return undefined;
  const refusal = repositoryImportRefusal(pressed.answered);
  return typeof refusal === "string" && repositoryImportFaultless(refusal)
    ? undefined
    : repositoryImportRefusalLabel(refusal);
}

/** What a refused Import now says under the line, where it says anything. */
export function repositoryImportRefused(failure: ApiFailure): Copy {
  return {
    id: "repositories-import-refused-now",
    args: {
      word: repositoryImportRefusalLabel(repositoryImportRefusal(failure)),
    },
  };
}

/** Each fault a refused file is refused for, in the console's words. */
const repositoryImportFaultWords: Readonly<
  Record<RepositoryConfigurationFault, Copy>
> = {
  TooManyDeclarations: { id: "repositories-fault-too-many-declarations" },
  PathInvalid: { id: "repositories-fault-path-invalid" },
  SymlinkRefused: { id: "repositories-fault-symlink-refused" },
  ContentTooLarge: { id: "repositories-fault-content-too-large" },
  DocumentUnreadable: { id: "repositories-fault-document-unreadable" },
  EnvelopeInvalid: { id: "repositories-fault-envelope-invalid" },
  NameInvalid: { id: "repositories-fault-name-invalid" },
  ConfigurationInvalid: { id: "repositories-fault-configuration-invalid" },
  ConfigurationTooLong: { id: "repositories-fault-configuration-too-long" },
  DuplicateName: { id: "repositories-fault-duplicate-name" },
  DuplicatePath: { id: "repositories-fault-duplicate-path" },
  ReferenceAbsent: { id: "repositories-fault-reference-absent" },
  TooManyReferences: { id: "repositories-fault-too-many-references" },
};

/** One refusal's fault in words: a configuration too long as its length against the limit, and a missing reference by its path. */
export function repositoryImportFault(
  refusal: RepositoryConfigurationRefusalResponse,
): Copy {
  if (
    refusal.fault === "ConfigurationTooLong" &&
    refusal.chars !== undefined &&
    refusal.charsMax !== undefined
  )
    return {
      id: "repositories-fault-chars",
      args: { chars: refusal.chars, charsMax: refusal.charsMax },
    };
  if (refusal.fault === "ReferenceAbsent" && refusal.reference !== undefined)
    return {
      id: "repositories-fault-reference-named",
      args: { reference: refusal.reference },
    };
  return repositoryImportFaultWords[refusal.fault];
}

/**
 * What a refused import says under its line: the first file refused and its
 * fault, and how many more were. Nothing where the attempt was not refused or
 * keeps no refusals.
 */
export function repositoryImportRefusedFile(
  lastImport: RepositoryConfigurationImportAttemptResponse | undefined,
): Copy | undefined {
  const outcome = lastImport?.outcome;
  if (outcome?.result !== "DeclarationsRefused") return undefined;
  const [first] = outcome.refusals ?? [];
  if (first === undefined) return undefined;
  const more = (outcome.refusalCount ?? 1) - 1;
  const file = {
    path: first.path,
    fault: repositoryImportFault(first),
  };
  return more > 0
    ? { id: "repositories-import-refused-files", args: { ...file, more } }
    : { id: "repositories-import-refused-file", args: file };
}

/** What the notice over a project's tickets and its Inbox says of a refused
 * import, before the first repository refused. */
export const repositoryImportRefusedLabel: Copy = {
  id: "repositories-import-refused-label",
};

/** How many more repositories the notice counts refused, after the first. */
export function repositoryImportRefusedMore(count: number): Copy {
  return { id: "repositories-more", args: { count } };
}

/**
 * The live bindings whose newest import was refused, oldest bound first. A
 * retired binding is never imported again, so its refusal would never clear,
 * and it counts for nothing.
 */
export function repositoryImportsRefused(
  bindings: readonly ProjectRepositoryListedResponse[],
): readonly string[] {
  return bindings
    .filter(
      (binding) =>
        binding.retiredAt === undefined &&
        binding.lastImport?.outcome.result === "DeclarationsRefused",
    )
    .map((binding) => binding.repository);
}
