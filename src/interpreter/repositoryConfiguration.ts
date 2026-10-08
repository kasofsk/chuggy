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
  type ReleaseConfiguration,
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
  repositoryDeclarationContent,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
} from "./repositoryDeclaration.ts";
import {
  repositoryDeclarationUnavailableOutcome,
  type RepositoryDeclarationSnapshotRequest,
  type RepositoryDeclarationUnavailable,
} from "./repositoryDeclarationSnapshot.ts";
import {
  repositoryReadEvidenceHeld,
  type RepositoryReadEvidence,
} from "./repositoryReadEvidence.ts";
export * from "./repositoryConfigurationIdentity.ts";

/** What reading an immutable repository view found before its declarations are interpreted. */
export type RepositoryConfigurationSnapshotRead =
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryDeclarationFile[];
    }
  | {
      readonly read: "Absent";
      readonly absent: "Commit" | "ConfigurationDirectory";
    }
  | ({ readonly read: "Unavailable" } & RepositoryDeclarationUnavailable)
  | {
      readonly read: "Refused";
      readonly refused: "Credential" | "Snapshot";
    };

/** Reads repository configuration bytes at exactly the commit the application pins. */
export interface RepositoryConfigurationSnapshotPort {
  snapshot(
    request: RepositoryDeclarationSnapshotRequest,
  ): Promise<RepositoryConfigurationSnapshotRead>;
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
  readonly configuration: ReleaseConfiguration;
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
  | "DuplicatePath";

export interface RepositoryConfigurationRefusal {
  readonly path: string;
  readonly fault: RepositoryConfigurationFault;
  readonly configurationFault?: ReleaseConfigurationFault;
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
}

export type RepositoryConfigurationImportOutcome =
  | { readonly result: "NotFound" }
  | { readonly result: "RepositoryAbsent" }
  | {
      readonly result: "SnapshotAbsent";
      readonly absent: "Commit" | "ConfigurationDirectory";
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

/** Imports the declarations at one exact repository commit under an already-resolved authority. */
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
  const snapshot = await input.ports.snapshots.snapshot({
    repository: binding,
    commit: input.commit,
  });
  switch (snapshot.read) {
    case "Absent":
      return { result: "SnapshotAbsent", absent: snapshot.absent };
    case "Unavailable":
      return repositoryDeclarationUnavailableOutcome(snapshot);
    case "Refused":
      return { result: "SnapshotRefused", refused: snapshot.refused };
    case "Snapshot": {
      const readiness = repositoryConfigurationImportReadiness({
        repository: binding.repository,
        commit: input.commit,
        files: snapshot.files,
      });
      if (readiness.readiness === "Refused")
        return { result: "DeclarationsRefused", faults: readiness.faults };
      const imported = await input.ports.store.importRepositoryConfigurations({
        partition: input.partition,
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
 * integer but a refused declaration's `path`, which is the tree path `ls-tree`
 * answered and is the one text here a forge supplied.
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
  | { readonly result: "Skipped"; readonly why: Skip }
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
  extends RepositoryConfigurationImportPorts, RepositoryActionImportPorts {
  readonly listing: RepositoryBindingListing;
  readonly heads: RepositoryDefaultBranchPort;
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

/** Where one binding's own default branch points now, read through ports each of which may raise. */
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
    return {
      result: "Skipped",
      why:
        outcome.absent === "Commit"
          ? "CommitAbsent"
          : "ConfigurationDirectoryAbsent",
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

/**
 * One result as the words a line ends in. Every term is a variant of the run's
 * own types or a held integer but a refused declaration's path, which
 * `JSON.stringify` escapes.
 */
function boundRepositoryImportLineWords(
  result: BoundRepositoryImportResult<string, BoundRepositoryImportOutcome>,
): string {
  switch (result.result) {
    case "Imported":
      return `imported at ${result.commit}`;
    case "Skipped":
      return `skipped: ${result.why}`;
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

function repositoryConfigurationEnvelope(
  file: RepositoryDeclarationFile,
  repository: RepositoryId,
  commit: GitObjectId,
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
    Object.keys(record).sort().join(",") !== "configuration,name,version" ||
    record["version"] !== 1
  )
    return { path: file.path, fault: "EnvelopeInvalid" };
  const name = asRepositoryConfigurationName(record["name"]);
  if (name === undefined) return { path: file.path, fault: "NameInvalid" };
  let canonical: CanonicalConfiguration;
  try {
    canonical = canonicalConfigurationOf(record["configuration"]);
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

/** Parses one bounded repository snapshot atomically into ready declarations or refusals. */
export function repositoryConfigurationImportReadiness(input: {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly files: readonly RepositoryDeclarationFile[];
}): RepositoryConfigurationImportReadiness {
  if (input.files.length > repositoryDeclarationsMax)
    return {
      readiness: "Refused",
      faults: [
        { path: repositoryConfigurationRoot, fault: "TooManyDeclarations" },
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
