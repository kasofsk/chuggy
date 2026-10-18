/**
 * Repository-declared configurations before any repository or database I/O.
 *
 * AN IMPORT NAMES THE REPOSITORY IT READS, and works against that repository's
 * binding rather than against whichever the project bound first.
 *
 * A VERSION SEQUENCE STAYS PER PROJECT AND NAME. A name is the project's handle
 * for a configuration — a lead selects by it — so two repositories declaring one
 * name are two sources of one named thing, their numbers interleave into its
 * chronology, and the provenance row is what tells the sources apart.
 */

import {
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  releaseConfigurationReadiness,
  type CanonicalConfiguration,
  type ConfigurationRevisionId,
  type DeclaredConfiguration,
  type ReleaseConfigurationFault,
} from "./authoring.ts";
import type {
  GitObjectId,
  GitRefName,
  RepositoryBinding,
  RepositoryId,
} from "./finalizer.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import { configurationDocumentSchema } from "../contract/configurationDocument.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  importRepositoryActions,
  type RepositoryActionImportOutcome,
  type RepositoryActionImportPorts,
} from "./repositoryAction.ts";
import {
  asRepositoryConfigurationName,
  asRepositoryConfigurationPath,
  repositoryConfigurationRoot,
  type RepositoryConfigurationName,
  type RepositoryConfigurationPath,
} from "./repositoryConfigurationIdentity.ts";
import {
  repositoryConfigurationIgnoredAnsweredMax,
  textCodePointsCount,
} from "../contract/http.ts";
import {
  repositoryDeclarationContent,
  repositoryDeclarationPathCharsMax,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
  type RepositoryDeclarationListing,
} from "./repositoryDeclaration.ts";
import {
  repositoryDeclarationUnavailableOutcome,
  type RepositoryDeclarationSnapshotRequest,
  type RepositoryDeclarationUnavailable,
} from "./repositoryDeclarationSnapshot.ts";
import {
  repositoryConfigurationReferences,
  repositoryConfigurationReferencesMax,
  repositoryConfigurationResolved,
  type RepositoryConfigurationReferenced,
} from "./repositoryConfigurationReference.ts";
import {
  repositoryReadEvidenceHeld,
  type RepositoryReadEvidence,
} from "./repositoryReadEvidence.ts";
export * from "./repositoryConfigurationIdentity.ts";
export type { RepositoryConfigurationReferenced } from "./repositoryConfigurationReference.ts";

/**
 * What under `.chug/` an import that found no configuration read none of, a
 * directory named once with its trailing slash. `truncated` says there is more
 * than `paths` names.
 */
export interface RepositoryConfigurationIgnored {
  readonly paths: readonly string[];
  readonly truncated: boolean;
}

/** The `ignored` a read or an outcome carries, which is none where nothing was named. */
export function repositoryConfigurationIgnoredField(
  ignored: RepositoryConfigurationIgnored | undefined,
): { readonly ignored?: RepositoryConfigurationIgnored } {
  return ignored === undefined ? {} : { ignored };
}

/**
 * What one commit's `.chug/` holds that its configuration import reads none
 * of: each entry directly under it but the configuration directory, and each
 * file `skipped` names there for not being JSON. It is nothing where there is
 * nothing to name, and where `.chug/` went unlisted, which says nothing either
 * way.
 */
export function repositoryConfigurationIgnored(input: {
  readonly listing: RepositoryDeclarationListing;
  readonly skipped: readonly string[];
}): RepositoryConfigurationIgnored | undefined {
  if (input.listing.listed === "Unlisted") return undefined;
  const directory = repositoryConfigurationRoot.slice(0, -1);
  const outside =
    input.listing.listed === "Entries"
      ? input.listing.entries
          .filter((entry) => !(entry.directory && entry.path === directory))
          .map((entry) => (entry.directory ? `${entry.path}/` : entry.path))
      : [];
  const found = [...outside, ...input.skipped];
  const named = found
    .filter(
      (path) => textCodePointsCount(path) <= repositoryDeclarationPathCharsMax,
    )
    .sort();
  const truncated =
    input.listing.listed === "Overflowed" ||
    named.length < found.length ||
    named.length > repositoryConfigurationIgnoredAnsweredMax;
  const paths = named.slice(0, repositoryConfigurationIgnoredAnsweredMax);
  return paths.length === 0 && !truncated ? undefined : { paths, truncated };
}

/** What reading an immutable repository view found before its declarations are interpreted. */
export type RepositoryConfigurationSnapshotRead =
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryDeclarationFile[];
    }
  | { readonly read: "Absent"; readonly absent: "Commit" }
  | {
      readonly read: "Absent";
      readonly absent: "ConfigurationDirectory";
      readonly ignored?: RepositoryConfigurationIgnored;
    }
  | ({ readonly read: "Unavailable" } & RepositoryDeclarationUnavailable)
  | {
      readonly read: "Refused";
      readonly refused: "Credential" | "Snapshot";
    };

/**
 * What reading the files a catalog names came to: each as found, or why none
 * was read, which is what a snapshot of the same commit would have said.
 */
export type RepositoryConfigurationReferencedRead =
  | {
      readonly read: "Referenced";
      readonly files: readonly RepositoryConfigurationReferenced[];
    }
  | Exclude<
      RepositoryConfigurationSnapshotRead,
      | { readonly read: "Snapshot" }
      | { readonly absent: "ConfigurationDirectory" }
    >;

/** Reads repository configuration bytes at exactly the commit the application pins. */
export interface RepositoryConfigurationSnapshotPort {
  snapshot(
    request: RepositoryDeclarationSnapshotRequest,
  ): Promise<RepositoryConfigurationSnapshotRead>;
  /** The files at `paths` in the same commit, each a regular file, a symbolic link, too large, or absent. */
  referenced(
    request: RepositoryDeclarationSnapshotRequest,
    paths: readonly string[],
  ): Promise<RepositoryConfigurationReferencedRead>;
}

/**
 * What reading where a repository's own HEAD points came to. `Absent` is a
 * repository holding no commit under it, which is what a repository created and
 * not yet seeded is, and is not an outage: there is nothing there to read at
 * this commit or any other.
 */
export type RepositoryDefaultBranchRead =
  | {
      readonly read: "Branch";
      readonly branch: GitRefName;
      readonly commit: GitObjectId;
    }
  | { readonly read: "Absent" }
  | {
      readonly read: "Unavailable";
      readonly evidence?: RepositoryReadEvidence;
    };

/**
 * Where a repository's own HEAD points, asked of the remote rather than
 * remembered. It is what a caller holding no ticket to take a commit from
 * imports at, and a binding that named its own branch would be a second place
 * the answer could be stale.
 */
export interface RepositoryDefaultBranchPort {
  defaultBranch(
    repository: RepositoryBinding,
  ): Promise<RepositoryDefaultBranchRead>;
}

export interface RepositoryConfigurationDeclaration {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly name: RepositoryConfigurationName;
  readonly path: RepositoryConfigurationPath;
  readonly revision: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
  readonly configuration: DeclaredConfiguration;
}

export type RepositoryConfigurationFault =
  | "TooManyDeclarations"
  | "PathInvalid"
  | "SymlinkRefused"
  | "ContentTooLarge"
  | "DocumentUnreadable"
  | "EnvelopeInvalid"
  | "NameInvalid"
  | "ConfigurationInvalid"
  | "DuplicateName"
  | "DuplicatePath"
  | "ReferenceAbsent"
  | "TooManyReferences";

/** A file refused, and the file it names by reference where that is what was refused. */
export interface RepositoryConfigurationRefusal {
  readonly path: string;
  readonly fault: RepositoryConfigurationFault;
  readonly configurationFault?: ReleaseConfigurationFault;
  readonly reference?: string;
}

export type RepositoryConfigurationImportReadiness =
  | {
      readonly readiness: "Ready";
      readonly declarations: readonly RepositoryConfigurationDeclaration[];
    }
  | {
      readonly readiness: "Refused";
      readonly faults: readonly RepositoryConfigurationRefusal[];
    };

export type RepositoryConfigurationsImported =
  | { readonly imported: "Imported" }
  | { readonly imported: "IdentityConflict" }
  | { readonly imported: "StaleBinding" };

export interface RepositoryConfigurationStore {
  importRepositoryConfigurations(input: {
    readonly partition: Partition;
    readonly binding: RepositoryBinding;
    readonly authority: Authority;
    readonly declarations: readonly RepositoryConfigurationDeclaration[];
  }): Promise<RepositoryConfigurationsImported>;
}

export interface ProjectRepositoryBindingRead {
  /**
   * The binding of the repository named, or of the project's oldest where a
   * caller names none — which is what a caller holding no ticket to take one
   * from still asks for.
   */
  binding(
    partition: Partition,
    repository?: RepositoryId,
  ): Promise<RepositoryBinding | undefined>;
}

export interface RepositoryConfigurationImportPorts {
  readonly bindings: ProjectRepositoryBindingRead;
  readonly snapshots: RepositoryConfigurationSnapshotPort;
  readonly store: RepositoryConfigurationStore;
  readonly attempts: RepositoryConfigurationImportAttempts;
}

/** An import's ports and where a repository's default branch points, which an import naming no commit is made at. */
export interface RepositoryConfigurationHeadImportPorts extends RepositoryConfigurationImportPorts {
  readonly heads: RepositoryDefaultBranchPort;
}

export type RepositoryConfigurationImportOutcome =
  | { readonly result: "NotFound" }
  | { readonly result: "RepositoryAbsent" }
  | { readonly result: "SnapshotAbsent"; readonly absent: "Commit" }
  | {
      readonly result: "SnapshotAbsent";
      readonly absent: "ConfigurationDirectory";
      readonly ignored?: RepositoryConfigurationIgnored;
    }
  | ({ readonly result: "Unavailable" } & RepositoryDeclarationUnavailable)
  | {
      readonly result: "SnapshotRefused";
      readonly refused: "Credential" | "Snapshot";
    }
  | {
      readonly result: "DeclarationsRefused";
      readonly faults: readonly RepositoryConfigurationRefusal[];
    }
  | { readonly result: "IdentityConflict" }
  | { readonly result: "StaleBinding" }
  | { readonly result: "Imported"; readonly declarations: number };

/** An outcome an import reached once it had read a binding, which is every outcome an attempt is kept for. */
export type RepositoryConfigurationImportAttempted = Exclude<
  RepositoryConfigurationImportOutcome,
  { readonly result: "NotFound" } | { readonly result: "RepositoryAbsent" }
>;

/** Every word an attempt is kept under, which are its outcome's own. */
export const allRepositoryConfigurationImportAttemptResults = [
  "Imported",
  "SnapshotAbsent",
  "Unavailable",
  "SnapshotRefused",
  "DeclarationsRefused",
  "IdentityConflict",
  "StaleBinding",
] as const satisfies readonly RepositoryConfigurationImportAttempted["result"][];

/** What an absent snapshot lacked: the commit, or the configuration directory at it. */
export const allRepositoryConfigurationImportAbsences = [
  "Commit",
  "ConfigurationDirectory",
] as const;

/**
 * How one import came out, as its attempt is kept: the outcome's word, and
 * what was absent where that word is `SnapshotAbsent`. What an outcome carries
 * only for its own answer is not kept.
 */
export type RepositoryConfigurationImportAttemptOutcome =
  | {
      readonly result: Exclude<
        (typeof allRepositoryConfigurationImportAttemptResults)[number],
        "SnapshotAbsent"
      >;
    }
  | {
      readonly result: "SnapshotAbsent";
      readonly absent: (typeof allRepositoryConfigurationImportAbsences)[number];
    };

/**
 * The last import attempted of one binding. `commit` is the one it was read
 * at, and is absent where the default branch named none or could not be read.
 */
export interface RepositoryConfigurationImportAttempt {
  readonly attemptedAt: string;
  readonly commit?: GitObjectId;
  readonly outcome: RepositoryConfigurationImportAttemptOutcome;
}

/** Keeps how one binding's import came out, in place of the attempt kept before it. */
export interface RepositoryConfigurationImportAttempts {
  record(attempt: {
    readonly partition: Partition;
    readonly repository: RepositoryId;
    readonly commit?: GitObjectId;
    readonly outcome: RepositoryConfigurationImportAttemptOutcome;
  }): Promise<void>;
}

/** One outcome as its attempt is kept. */
function importRepositoryConfigurationsAttemptOutcome(
  outcome: RepositoryConfigurationImportAttempted,
): RepositoryConfigurationImportAttemptOutcome {
  switch (outcome.result) {
    case "SnapshotAbsent":
      return { result: outcome.result, absent: outcome.absent };
    case "Unavailable":
    case "SnapshotRefused":
    case "DeclarationsRefused":
    case "IdentityConflict":
    case "StaleBinding":
    case "Imported":
      return { result: outcome.result };
    default:
      return assertNever(outcome);
  }
}

/** Keeps how one binding's import came out, and answers that outcome. */
async function importRepositoryConfigurationsKept(
  attempts: RepositoryConfigurationImportAttempts,
  binding: RepositoryBinding,
  commit: GitObjectId | undefined,
  outcome: RepositoryConfigurationImportAttempted,
): Promise<RepositoryConfigurationImportAttempted> {
  await attempts.record({
    partition: binding.partition,
    repository: binding.repository,
    ...(commit === undefined ? {} : { commit }),
    outcome: importRepositoryConfigurationsAttemptOutcome(outcome),
  });
  return outcome;
}

/** Imports the declarations at one exact repository commit under an already-resolved authority, and keeps how it came out. */
export async function importRepositoryConfigurations(input: {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly authority: Authority;
  readonly ports: RepositoryConfigurationImportPorts;
}): Promise<RepositoryConfigurationImportOutcome> {
  const binding = await input.ports.bindings.binding(
    input.partition,
    input.repository,
  );
  if (binding === undefined) return { result: "RepositoryAbsent" };
  return importRepositoryConfigurationsKept(
    input.ports.attempts,
    binding,
    input.commit,
    await importRepositoryConfigurationsBound({ ...input, binding }),
  );
}

/**
 * Imports at whatever the repository's own default branch points at now, which
 * is what a caller holding no commit asks for, and keeps how it came out.
 */
export async function importRepositoryConfigurationsAtHead(input: {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly authority: Authority;
  readonly ports: RepositoryConfigurationHeadImportPorts;
}): Promise<RepositoryConfigurationImportOutcome> {
  const binding = await input.ports.bindings.binding(
    input.partition,
    input.repository,
  );
  if (binding === undefined) return { result: "RepositoryAbsent" };
  const head = await input.ports.heads.defaultBranch(binding);
  if (head.read !== "Branch")
    return importRepositoryConfigurationsHeadUnread(
      input.ports.attempts,
      binding,
      head,
    );
  return importRepositoryConfigurationsKept(
    input.ports.attempts,
    binding,
    head.commit,
    await importRepositoryConfigurationsBound({
      ...input,
      binding,
      commit: head.commit,
    }),
  );
}

/**
 * A default branch that named no commit, as the outcome an import at it comes
 * to, kept as the binding's attempt: a repository holding no commit is its
 * commit absent, and a read that failed is the repository unavailable, or its
 * credential where only the credential answered.
 */
export function importRepositoryConfigurationsHeadUnread(
  attempts: RepositoryConfigurationImportAttempts,
  binding: RepositoryBinding,
  head: Exclude<RepositoryDefaultBranchRead, { readonly read: "Branch" }>,
): Promise<RepositoryConfigurationImportAttempted> {
  switch (head.read) {
    case "Absent":
      return importRepositoryConfigurationsKept(attempts, binding, undefined, {
        result: "SnapshotAbsent",
        absent: "Commit",
      });
    case "Unavailable":
      return importRepositoryConfigurationsKept(
        attempts,
        binding,
        undefined,
        repositoryDeclarationUnavailableOutcome({
          unavailable:
            head.evidence !== undefined && !("git" in head.evidence)
              ? "Credential"
              : "Repository",
          ...(head.evidence === undefined ? {} : { evidence: head.evidence }),
        }),
      );
    default:
      return assertNever(head);
  }
}

/** The declarations at one commit of a binding already read, imported. */
async function importRepositoryConfigurationsBound(input: {
  readonly binding: RepositoryBinding;
  readonly commit: GitObjectId;
  readonly authority: Authority;
  readonly ports: RepositoryConfigurationImportPorts;
}): Promise<RepositoryConfigurationImportAttempted> {
  const binding = input.binding;
  const request = { repository: binding, commit: input.commit };
  const snapshot = await input.ports.snapshots.snapshot(request);
  switch (snapshot.read) {
    case "Absent":
      return snapshot.absent === "Commit"
        ? { result: "SnapshotAbsent", absent: "Commit" }
        : {
            result: "SnapshotAbsent",
            absent: "ConfigurationDirectory",
            ...repositoryConfigurationIgnoredField(snapshot.ignored),
          };
    case "Unavailable":
      return repositoryDeclarationUnavailableOutcome(snapshot);
    case "Refused":
      return { result: "SnapshotRefused", refused: snapshot.refused };
    case "Snapshot": {
      const referenced = await importRepositoryConfigurationsReferenced(
        input.ports.snapshots,
        request,
        snapshot.files,
      );
      if (!(referenced instanceof Map))
        return importRepositoryConfigurationsUnread(referenced);
      const readiness = repositoryConfigurationImportReadiness({
        repository: binding.repository,
        commit: input.commit,
        files: snapshot.files,
        referenced,
      });
      if (readiness.readiness === "Refused")
        return { result: "DeclarationsRefused", faults: readiness.faults };
      const imported = await input.ports.store.importRepositoryConfigurations({
        partition: binding.partition,
        binding,
        authority: input.authority,
        declarations: readiness.declarations,
      });
      switch (imported.imported) {
        case "Imported":
          return {
            result: "Imported",
            declarations: readiness.declarations.length,
          };
        case "IdentityConflict":
          return { result: "IdentityConflict" };
        case "StaleBinding":
          return { result: "StaleBinding" };
        default:
          return assertNever(imported);
      }
    }
    default:
      return assertNever(snapshot);
  }
}

/**
 * Every file the snapshot's catalogs name, read until what they name is read.
 * Each round reads at least one path not yet read, so one more round than an
 * import reads paths is as many as it can take, and a snapshot naming more
 * than that stops reading for readiness to refuse.
 */
async function importRepositoryConfigurationsReferenced(
  snapshots: RepositoryConfigurationSnapshotPort,
  request: RepositoryDeclarationSnapshotRequest,
  files: readonly RepositoryDeclarationFile[],
): Promise<
  | Map<string, RepositoryConfigurationReferenced>
  | Exclude<
      RepositoryConfigurationReferencedRead,
      { readonly read: "Referenced" }
    >
> {
  const referenced = new Map<string, RepositoryConfigurationReferenced>();
  for (let round = 0; round <= repositoryConfigurationReferencesMax; round++) {
    const named = repositoryConfigurationImportReferences(files, referenced);
    const unread = named.filter((path) => !referenced.has(path));
    if (
      named.length > repositoryConfigurationReferencesMax ||
      unread.length === 0
    )
      return referenced;
    const read = await snapshots.referenced(request, unread);
    if (read.read !== "Referenced") return read;
    for (const file of read.files)
      if (unread.includes(file.path)) referenced.set(file.path, file);
    for (const path of unread)
      if (!referenced.has(path))
        referenced.set(path, { path, found: "Absent" });
  }
  return referenced;
}

/** A reference read that found nothing to read, as the outcome a snapshot saying the same is. */
function importRepositoryConfigurationsUnread(
  read: Exclude<
    RepositoryConfigurationReferencedRead,
    { readonly read: "Referenced" }
  >,
): RepositoryConfigurationImportAttempted {
  switch (read.read) {
    case "Absent":
      return { result: "SnapshotAbsent", absent: "Commit" };
    case "Unavailable":
      return repositoryDeclarationUnavailableOutcome(read);
    case "Refused":
      return { result: "SnapshotRefused", refused: read.refused };
    default:
      return assertNever(read);
  }
}

export interface RepositoryConfigurationPartitionImport {
  readonly partition: Partition;
  readonly outcome: RepositoryConfigurationImportOutcome;
}

/** Attempts every named partition at one repository commit, preserving each outcome for the caller to report. */
export async function importRepositoryConfigurationPartitions(input: {
  readonly partitions: readonly Partition[];
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly authority: Authority;
  readonly ports: RepositoryConfigurationImportPorts;
}): Promise<readonly RepositoryConfigurationPartitionImport[]> {
  const imports: RepositoryConfigurationPartitionImport[] = [];
  for (const partition of input.partitions) {
    imports.push({
      partition,
      outcome: await importRepositoryConfigurations({
        partition,
        repository: input.repository,
        commit: input.commit,
        authority: input.authority,
        ports: input.ports,
      }),
    });
  }
  return imports;
}

/**
 * The most bindings one importer run takes, and the ceiling the door it reads
 * them through enforces. A run that filled it imported a prefix of the estate
 * and says so, rather than reading an estate of unbounded size into one pass.
 */
export const repositoryBindingsPerImportMax = 1_000;

/** One binding a listing answered with: which project binds which repository, and since when. */
export interface RepositoryBindingListed {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly boundAt: string;
}

/**
 * Every binding there is, oldest first and bounded. It crosses partitions
 * because its only caller has no caller of its own: the importer's job is every
 * project's declarations, so a listing that took a partition would need it to
 * already know the answer it is asking for.
 */
export interface RepositoryBindingListing {
  bindings(max: number): Promise<readonly RepositoryBindingListed[]>;
}

/** Why one bound repository was passed over rather than imported or failed. */
export type BoundRepositoryImportSkip =
  | "Unbound"
  | "RepositoryEmpty"
  | "CommitAbsent"
  | "ConfigurationDirectoryAbsent";

/** Why a bound repository's actions were passed over, which is never a directory its head lacks: such a head declares none. */
export type BoundRepositoryActionImportSkip = Exclude<
  BoundRepositoryImportSkip,
  "ConfigurationDirectoryAbsent"
>;

/**
 * Why one bound repository could not be imported. Every term is a variant or an
 * integer but a tree path `ls-tree` answered, which is the one text here a
 * forge supplied.
 */
export type BoundRepositoryImportFailure<
  Outcome = RepositoryConfigurationImportOutcome,
> =
  | {
      readonly failure: "HeadUnavailable";
      readonly evidence?: RepositoryReadEvidence;
    }
  | { readonly failure: "Raised" }
  | { readonly failure: "Import"; readonly outcome: Outcome };

/**
 * What one bound repository came to. A skip is not a failure: a repository
 * holding no commit, or holding no configuration directory at its head, is a
 * repository this run has nothing to do with, and the bootstrap that seeds one
 * belongs to the bind and to the configuration route that runs its step again.
 */
export type BoundRepositoryImportResult<
  Skip = BoundRepositoryImportSkip,
  Outcome = RepositoryConfigurationImportOutcome,
> =
  | {
      readonly result: "Imported";
      readonly commit: GitObjectId;
      readonly declarations: number;
    }
  | {
      readonly result: "Skipped";
      readonly why: Skip;
      readonly ignored?: RepositoryConfigurationIgnored;
    }
  | {
      readonly result: "Failed";
      readonly failure: BoundRepositoryImportFailure<Outcome>;
    };

/** What one bound repository's actions came to, in the terms its configurations are reported in. */
export type BoundRepositoryActionImportResult = BoundRepositoryImportResult<
  BoundRepositoryActionImportSkip,
  RepositoryActionImportOutcome
>;

/** One binding's two imports at one head: `result` is its configurations' and `actions` its actions'. */
export interface BoundRepositoryImport {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly result: BoundRepositoryImportResult;
  readonly actions: BoundRepositoryActionImportResult;
}

export interface BoundRepositoryImportPorts
  extends RepositoryConfigurationHeadImportPorts, RepositoryActionImportPorts {
  readonly listing: RepositoryBindingListing;
}

/** The head one binding is imported at, or what the run reports of everything it would have imported there. */
type BoundRepositoryHead =
  | {
      readonly head: "Commit";
      readonly binding: RepositoryBinding;
      readonly commit: GitObjectId;
    }
  | {
      readonly head: "None";
      readonly result: BoundRepositoryImportResult<
        "Unbound" | "RepositoryEmpty",
        never
      >;
    };

const importBoundRepositoryRaised = {
  result: "Failed",
  failure: { failure: "Raised" },
} as const;

/**
 * Where one binding's own default branch points now, read through ports each
 * of which may raise. A branch naming no commit is kept as the binding's
 * configuration import attempt, which is all an import at it would have been.
 */
async function importBoundRepositoryHead(
  bound: RepositoryBindingListed,
  ports: BoundRepositoryImportPorts,
): Promise<BoundRepositoryHead> {
  try {
    const binding = await ports.bindings.binding(
      bound.partition,
      bound.repository,
    );
    if (binding === undefined)
      return { head: "None", result: { result: "Skipped", why: "Unbound" } };
    const head = await ports.heads.defaultBranch(binding);
    if (head.read !== "Branch")
      await importRepositoryConfigurationsHeadUnread(
        ports.attempts,
        binding,
        head,
      );
    switch (head.read) {
      case "Absent":
        return {
          head: "None",
          result: { result: "Skipped", why: "RepositoryEmpty" },
        };
      case "Unavailable":
        return {
          head: "None",
          result: {
            result: "Failed",
            failure: {
              failure: "HeadUnavailable",
              ...(head.evidence === undefined
                ? {}
                : { evidence: head.evidence }),
            },
          },
        };
      case "Branch":
        return { head: "Commit", binding, commit: head.commit };
      default:
        return assertNever(head);
    }
  } catch {
    return { head: "None", result: importBoundRepositoryRaised };
  }
}

/** One import's result, where a port that raised is that import's failure and carries nothing of what it raised with. */
async function importBoundRepositoryAttempted<Result>(
  attempt: () => Promise<Result>,
): Promise<Result | typeof importBoundRepositoryRaised> {
  try {
    return await attempt();
  } catch {
    return importBoundRepositoryRaised;
  }
}

/** One import's outcome in the terms a run over every binding reports. */
function boundRepositoryImportResult(
  commit: GitObjectId,
  outcome: RepositoryConfigurationImportOutcome,
): BoundRepositoryImportResult {
  if (outcome.result === "Imported")
    return { result: "Imported", commit, declarations: outcome.declarations };
  if (outcome.result === "SnapshotAbsent")
    return outcome.absent === "Commit"
      ? { result: "Skipped", why: "CommitAbsent" }
      : {
          result: "Skipped",
          why: "ConfigurationDirectoryAbsent",
          ...repositoryConfigurationIgnoredField(outcome.ignored),
        };
  return { result: "Failed", failure: { failure: "Import", outcome } };
}

/** One action import's outcome in the terms a run over every binding reports. */
function boundRepositoryActionImportResult(
  commit: GitObjectId,
  outcome: RepositoryActionImportOutcome,
): BoundRepositoryActionImportResult {
  if (outcome.result === "Imported")
    return { result: "Imported", commit, declarations: outcome.declarations };
  if (outcome.result === "CommitAbsent")
    return { result: "Skipped", why: "CommitAbsent" };
  return { result: "Failed", failure: { failure: "Import", outcome } };
}

/**
 * One bound repository, imported at whatever its own default branch points at
 * now. Its configurations and its actions are each attempted for themselves, so
 * what one is refused for or raised with is never the other's result.
 */
async function importBoundRepository(
  bound: RepositoryBindingListed,
  authority: Authority,
  ports: BoundRepositoryImportPorts,
): Promise<Pick<BoundRepositoryImport, "result" | "actions">> {
  const head = await importBoundRepositoryHead(bound, ports);
  if (head.head === "None")
    return { result: head.result, actions: head.result };
  const { binding, commit } = head;
  return {
    result: await importBoundRepositoryAttempted(async () =>
      boundRepositoryImportResult(
        commit,
        await importRepositoryConfigurations({
          partition: bound.partition,
          repository: bound.repository,
          commit,
          authority,
          ports,
        }),
      ),
    ),
    actions: await importBoundRepositoryAttempted(async () =>
      boundRepositoryActionImportResult(
        commit,
        await importRepositoryActions({ binding, commit, ports }),
      ),
    ),
  };
}

/**
 * What one run over the estate came to. `truncated` is a listing that came back
 * at the bound, which means the run imported a prefix and the bindings past it
 * were never attempted.
 */
export interface BoundRepositoryImportRun {
  readonly imports: readonly BoundRepositoryImport[];
  readonly truncated: boolean;
}

/**
 * Imports every binding in the estate at its own default-branch head, one
 * binding's outcome never deciding another's: a forge that is down for one
 * owner, or a repository whose declarations are refused, leaves every other
 * binding imported and is reported on its own line.
 */
export async function importBoundRepositories(input: {
  readonly authority: Authority;
  readonly ports: BoundRepositoryImportPorts;
  readonly bindingsMax?: number;
}): Promise<BoundRepositoryImportRun> {
  const bindingsMax = input.bindingsMax ?? repositoryBindingsPerImportMax;
  const listed = await input.ports.listing.bindings(bindingsMax);
  const imports: BoundRepositoryImport[] = [];
  for (const bound of listed)
    imports.push({
      partition: bound.partition,
      repository: bound.repository,
      ...(await importBoundRepository(bound, input.authority, input.ports)),
    });
  return { imports, truncated: listed.length >= bindingsMax };
}

/** The binding a line is about. */
function boundRepositoryImportLineWhere(bound: BoundRepositoryImport): string {
  return `${bound.partition.tenant}/${bound.partition.project} ${bound.repository}`;
}

/** Either import's outcome, as a line reads it. */
type BoundRepositoryImportOutcome =
  RepositoryConfigurationImportOutcome | RepositoryActionImportOutcome;

/** One failure as it may be printed, its evidence held to the range each integer can honestly take. */
function boundRepositoryImportFailureHeld(
  failure: BoundRepositoryImportFailure<BoundRepositoryImportOutcome>,
): BoundRepositoryImportFailure<BoundRepositoryImportOutcome> {
  switch (failure.failure) {
    case "HeadUnavailable":
      return failure.evidence === undefined
        ? failure
        : {
            ...failure,
            evidence: repositoryReadEvidenceHeld(failure.evidence),
          };
    case "Raised":
      return failure;
    case "Import":
      return failure.outcome.result !== "Unavailable" ||
        failure.outcome.evidence === undefined
        ? failure
        : {
            ...failure,
            outcome: {
              ...failure.outcome,
              evidence: repositoryReadEvidenceHeld(failure.outcome.evidence),
            },
          };
    default:
      return assertNever(failure);
  }
}

/** What under `.chug/` a line says its import read none of, which is nothing where it names none. */
function boundRepositoryImportLineIgnored(
  ignored: RepositoryConfigurationIgnored | undefined,
): string {
  return ignored === undefined ? "" : `; ignored: ${JSON.stringify(ignored)}`;
}

/**
 * One result as the words a line ends in. Every term is a variant of the run's
 * own types or a held integer but a tree path, which `JSON.stringify` escapes.
 */
function boundRepositoryImportLineWords(
  result: BoundRepositoryImportResult<string, BoundRepositoryImportOutcome>,
): string {
  switch (result.result) {
    case "Imported":
      return `imported at ${result.commit}`;
    case "Skipped":
      return `skipped: ${result.why}${boundRepositoryImportLineIgnored(result.ignored)}`;
    case "Failed":
      return `failed: ${JSON.stringify(boundRepositoryImportFailureHeld(result.failure))}`;
    default:
      return assertNever(result);
  }
}

/** One binding's configurations as a line. */
export function boundRepositoryImportLine(
  bound: BoundRepositoryImport,
): string {
  return `${boundRepositoryImportLineWhere(bound)} ${boundRepositoryImportLineWords(bound.result)}`;
}

/** One binding's actions as a line, which one word tells from its configurations' line. */
export function boundRepositoryActionImportLine(
  bound: BoundRepositoryImport,
): string {
  return `${boundRepositoryImportLineWhere(bound)} actions ${boundRepositoryImportLineWords(bound.actions)}`;
}

/** One line of what a run reports, and whether it is a failure's. */
export interface BoundRepositoryImportReported {
  readonly line: string;
  readonly failed: boolean;
}

/** What a run reports of one binding: its configurations and then its actions, each on a line its own result marks. */
export function boundRepositoryImportReport(
  bound: BoundRepositoryImport,
): readonly BoundRepositoryImportReported[] {
  return [
    {
      line: boundRepositoryImportLine(bound),
      failed: bound.result.result === "Failed",
    },
    {
      line: boundRepositoryActionImportLine(bound),
      failed: bound.actions.result === "Failed",
    },
  ];
}

/**
 * Why a run may not leave zero: a binding it could not import whole, or a
 * listing it filled, which leaves every binding past the bound unimported.
 */
export function boundRepositoryImportRefusal(
  run: BoundRepositoryImportRun,
  bindingsMax: number,
): string | undefined {
  const failed = run.imports.filter(
    (bound) =>
      bound.result.result === "Failed" || bound.actions.result === "Failed",
  ).length;
  const refusals = [
    ...(failed === 0
      ? []
      : [`${String(failed)} of ${String(run.imports.length)} bindings`]),
    ...(run.truncated
      ? [
          `the listing filled its bound of ${String(bindingsMax)} bindings and the rest of the estate is unimported`,
        ]
      : []),
  ];
  return refusals.length === 0 ? undefined : refusals.join("; ");
}

function repositoryConfigurationRevision(
  commit: GitObjectId,
  name: RepositoryConfigurationName,
): ConfigurationRevisionId {
  return asConfigurationRevisionId(`repository:${commit}:${name}`);
}

/** Every field a file's envelope holds, which is every field it may. */
const repositoryConfigurationFields = Object.keys(
  configurationDocumentSchema.shape,
)
  .sort()
  .join(",");

/** The configuration a declaration file holds where it holds an envelope, read for the files it names. */
function repositoryConfigurationDeclared(
  file: RepositoryDeclarationFile,
): unknown {
  const content = repositoryDeclarationContent(file);
  if (content.content === "Refused") return undefined;
  const record = content.document;
  return typeof record === "object" && record !== null && !Array.isArray(record)
    ? (record as Record<string, unknown>)["configuration"]
    : undefined;
}

/** Every distinct path the snapshot's configurations name, given the files read so far. */
function repositoryConfigurationImportReferences(
  files: readonly RepositoryDeclarationFile[],
  referenced: ReadonlyMap<string, RepositoryConfigurationReferenced>,
): readonly string[] {
  return [
    ...new Set(
      files.flatMap((file) =>
        repositoryConfigurationReferences(
          repositoryConfigurationDeclared(file),
          referenced,
        ),
      ),
    ),
  ];
}

function repositoryConfigurationEnvelope(
  file: RepositoryDeclarationFile,
  repository: RepositoryId,
  commit: GitObjectId,
  referenced: ReadonlyMap<string, RepositoryConfigurationReferenced>,
): RepositoryConfigurationDeclaration | RepositoryConfigurationRefusal {
  const path = asRepositoryConfigurationPath(file.path);
  if (path === undefined) return { path: file.path, fault: "PathInvalid" };
  const content = repositoryDeclarationContent(file);
  if (content.content === "Refused")
    return { path: file.path, fault: content.fault };
  const value = content.document;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { path: file.path, fault: "EnvelopeInvalid" };
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== repositoryConfigurationFields ||
    !configurationDocumentSchema.shape.version.safeParse(record["version"])
      .success
  )
    return { path: file.path, fault: "EnvelopeInvalid" };
  const name = asRepositoryConfigurationName(record["name"]);
  if (name === undefined) return { path: file.path, fault: "NameInvalid" };
  const resolved = repositoryConfigurationResolved(
    record["configuration"],
    referenced,
  );
  if ("fault" in resolved)
    return {
      path: file.path,
      fault: resolved.fault,
      reference: resolved.reference,
    };
  let canonical: CanonicalConfiguration;
  try {
    canonical = canonicalConfigurationOf(resolved.configuration);
  } catch {
    return { path: file.path, fault: "ConfigurationInvalid" };
  }
  const readiness = releaseConfigurationReadiness(canonical);
  if (readiness.readiness === "Incomplete")
    return {
      path: file.path,
      fault: "ConfigurationInvalid",
      configurationFault: readiness.fault,
    };
  return {
    repository,
    commit,
    name,
    path,
    revision: repositoryConfigurationRevision(commit, name),
    canonical,
    configuration: readiness.configuration,
  };
}

/**
 * Parses one bounded repository snapshot atomically into ready declarations or
 * refusals, with the files its catalogs name as they were read.
 */
export function repositoryConfigurationImportReadiness(input: {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly files: readonly RepositoryDeclarationFile[];
  readonly referenced?: ReadonlyMap<string, RepositoryConfigurationReferenced>;
}): RepositoryConfigurationImportReadiness {
  const referenced = input.referenced ?? new Map();
  if (input.files.length > repositoryDeclarationsMax)
    return {
      readiness: "Refused",
      faults: [
        { path: repositoryConfigurationRoot, fault: "TooManyDeclarations" },
      ],
    };
  if (
    repositoryConfigurationImportReferences(input.files, referenced).length >
    repositoryConfigurationReferencesMax
  )
    return {
      readiness: "Refused",
      faults: [
        { path: repositoryConfigurationRoot, fault: "TooManyReferences" },
      ],
    };
  const declarations: RepositoryConfigurationDeclaration[] = [];
  const faults: RepositoryConfigurationRefusal[] = [];
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.path)) {
      faults.push({ path: file.path, fault: "DuplicatePath" });
      continue;
    }
    paths.add(file.path);
    const parsed = repositoryConfigurationEnvelope(
      file,
      input.repository,
      input.commit,
      referenced,
    );
    if ("fault" in parsed) {
      faults.push(parsed);
      continue;
    }
    if (names.has(parsed.name)) {
      faults.push({ path: file.path, fault: "DuplicateName" });
      continue;
    }
    names.add(parsed.name);
    declarations.push(parsed);
  }
  return faults.length === 0
    ? { readiness: "Ready", declarations }
    : { readiness: "Refused", faults };
}
