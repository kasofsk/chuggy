/** Versioned native authoring state, outside the journaled ticket core. */

import { createHash } from "node:crypto";

import {
  authoringSchema,
  type ReleaseAuthoringBody,
  type ReleaseAuthoringProgram,
} from "../contract/authoring.ts";
import {
  configurationWithOverrides,
  type ConfigurationOverrides,
} from "../contract/configurationOverrides.ts";
import {
  configurationSelectionEmpty,
  type ConfigurationSelection,
} from "../contract/configurationSelection.ts";
import {
  configurationCanonicalCharsMax,
  nativeHttpPageItemsDefault,
  nativeHttpPageItemsMax,
} from "../contract/http.ts";
import {
  bootstrapConfigurationName,
  bootstrapConfigurationRevisionPrefix,
} from "../contract/responses.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import { defaultPlan, type Config } from "../domain/config.ts";
import type { SessionId } from "./agentSession.ts";
import type { Authority } from "./operationInbox.ts";
import type { Lifecycle, Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import type {
  ConfigurationVersion,
  RepositoryConfigurationName,
  RepositoryConfigurationPath,
} from "./repositoryConfigurationIdentity.ts";
import type { Worker } from "./workerCatalog.ts";
import { executionRequirementConfigurationIsValid } from "./executionRequirement.ts";
import { handoffApprovalRequired } from "./finalizerPreparation.ts";
import type { CanonicalConfiguration } from "./canonicalConfiguration.ts";
import type {
  BriefFinalization,
  DraftBrief,
  ReleaseBrief,
} from "./ticketBrief.ts";
import type { BoundaryRefusalCode } from "./refusal.ts";
import {
  authoredTaskConfigurationReadiness,
  briefsAnyAgent,
  firstCommandedCheckStage,
  type AuthoredTaskConfiguration,
  type TaskConfigurationFault,
} from "./taskConfiguration.ts";
import {
  catalogPlansCommanded,
  declaredConfigurationVersion,
  selectedCatalogEntries,
  selectedFirstCommandsEvaluator,
  workloadConfigurationReadiness,
  type CatalogSelection,
  type WorkloadConfiguration,
  type WorkloadConfigurationFault,
} from "./workloadConfiguration.ts";
export { declaredConfigurationVersion } from "./workloadConfiguration.ts";

declare const configurationRevisionBrand: unique symbol;

export type ConfigurationRevisionId = string & {
  readonly [configurationRevisionBrand]: true;
};

export type { CanonicalConfiguration } from "./canonicalConfiguration.ts";

/** A ready version 1 configuration: one document whose stages are its blocks. */
export type ReleaseConfiguration = Readonly<Record<string, unknown>> & {
  readonly version: 1;
  readonly image: string;
} & AuthoredTaskConfiguration;

/** A ready configuration of either version, told apart by its own `version`. */
export type DeclaredConfiguration =
  ReleaseConfiguration | WorkloadConfiguration;

/**
 * What one ticket runs on: a version 1 configuration as it stands, or a catalog
 * with the entries the ticket selected from it. Every reader of a released
 * ticket's tasks switches on this, so each version's behaviour has one home.
 */
export type TicketConfiguration =
  | { readonly version: 1; readonly configuration: ReleaseConfiguration }
  | {
      readonly version: 2;
      readonly configuration: WorkloadConfiguration;
      readonly selection: CatalogSelection;
    };

/**
 * The faults about the pairing of a brief and a configuration rather than
 * either document, either alone being fine: a configuration commanding no check
 * stage contradicts a brief that appends check lines to it, a brief naming no
 * repository has nothing to pair with, a configuration imported from a
 * repository contradicts a brief working in a different one, and a program
 * leaving out the task a brief's check lines join would never run them. A
 * revision of the draft mends each, so each is refused under its own code
 * rather than as the configuration's.
 */
export const releasePairingFaults = [
  "BriefChecksUncommanded",
  "BriefNamesNoRepository",
  "ConfigurationFromAnotherRepository",
  "SelectionUnknown",
  "SelectionUnsupported",
  "ProgramExceedsPlan",
  "ProgramSkipsBriefChecks",
  "OverridesUnsupported",
  "OverridesUnknown",
] as const satisfies readonly BoundaryRefusalCode[];
export type ReleasePairingFault = (typeof releasePairingFaults)[number];

/** Why one configuration is not releasable: a fault of the document, or of its pairing with a brief. */
export type ReleaseConfigurationFault =
  | "ReleaseShapeInvalid"
  | "WorkerUndeclared"
  | TaskConfigurationFault
  | WorkloadConfigurationFault
  | ReleasePairingFault;

export type DraftReleaseRefusalCode =
  ReleasePairingFault | "ConfigurationInvalid";

/**
 * What a release refused for one fault is answered with: a pairing fault under
 * its own code, and a fault of the configuration document, which no revision of
 * the brief mends, as `ConfigurationInvalid`.
 */
export function draftReleaseRefusalCode(
  fault: ReleaseConfigurationFault,
): DraftReleaseRefusalCode {
  return (
    releasePairingFaults.find((pairing) => pairing === fault) ??
    "ConfigurationInvalid"
  );
}

export type ReleaseConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: DeclaredConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: ReleaseConfigurationFault;
    };

/** Whether one draft releases, and what its ticket runs on where it does. */
export type TicketConfigurationReadiness =
  | { readonly readiness: "Ready"; readonly ticket: TicketConfiguration }
  | {
      readonly readiness: "Incomplete";
      readonly fault: ReleaseConfigurationFault;
    };

function boundedText(value: string, what: string, maximum: number): string {
  if (value.length === 0) throw new RangeError(`${what}: a value is empty`);
  if (!value.isWellFormed())
    throw new RangeError(`${what}: a value contains an unpaired surrogate`);
  if (value.length > maximum)
    throw new RangeError(
      `${what}: a value exceeds ${String(maximum)} characters`,
    );
  return value;
}

export function asConfigurationRevisionId(
  value: string,
): ConfigurationRevisionId {
  return boundedText(
    value,
    "configuration revision",
    256,
  ) as ConfigurationRevisionId;
}

/**
 * The one revision a repository's bootstrap is authored at. A digest rather
 * than the repository itself, because a repository may be as long as a
 * revision is.
 */
export function bootstrapConfigurationRevision(
  repository: RepositoryId,
): ConfigurationRevisionId {
  return asConfigurationRevisionId(
    bootstrapConfigurationRevisionPrefix.concat(
      createHash("sha256").update(repository).digest("hex"),
    ),
  );
}

/**
 * The repository one configuration revision releases from alone, where there
 * is one: the repository it was imported from, or the one a bootstrap's
 * revision is named for.
 */
export type ConfigurationRepository =
  | { readonly from: "Imported"; readonly repository: RepositoryId }
  | { readonly from: "Bootstrap"; readonly revision: ConfigurationRevisionId };

/** The repository a revision releases from alone, from what was imported of it and the revision itself. */
export function configurationRepositoryOf(
  revision: ConfigurationRevisionId,
  imported: RepositoryId | undefined,
): ConfigurationRepository | undefined {
  if (imported !== undefined) return { from: "Imported", repository: imported };
  return revision.startsWith(bootstrapConfigurationRevisionPrefix)
    ? { from: "Bootstrap", revision }
    : undefined;
}

/**
 * The repository a new release under a revision releases from alone. The
 * project's one bootstrap from before each repository had its own is named for
 * none, so nothing new releases under it, while a ticket already released
 * under it is still judged as under any authored revision.
 */
export function releaseConfigurationRepositoryOf(
  revision: ConfigurationRevisionId,
  imported: RepositoryId | undefined,
): ConfigurationRepository | undefined {
  return imported === undefined && revision === bootstrapConfigurationName
    ? { from: "Bootstrap", revision }
    : configurationRepositoryOf(revision, imported);
}

/** Whether a ticket in one repository releases under a revision scoped to one repository. */
function configurationRepositoryReleases(
  scoped: ConfigurationRepository,
  repository: RepositoryId,
): boolean {
  switch (scoped.from) {
    case "Imported":
      return scoped.repository === repository;
    case "Bootstrap":
      return scoped.revision === bootstrapConfigurationRevision(repository);
    default:
      return assertNever(scoped);
  }
}

/** Accepts already-canonical configuration bytes after the transport's schema validation. */
export function asCanonicalConfiguration(
  value: string,
): CanonicalConfiguration {
  const bounded = boundedText(
    value,
    "canonical configuration",
    configurationCanonicalCharsMax,
  );
  const parsed: unknown = JSON.parse(bounded);
  const canonical = canonicalJson(parsed);
  if (canonical !== bounded)
    throw new RangeError(
      "canonical configuration: keys and values are not canonically encoded",
    );
  return bounded as CanonicalConfiguration;
}

/** Canonically encodes one parsed configuration document. */
export function canonicalConfigurationOf(
  value: unknown,
): CanonicalConfiguration {
  return asCanonicalConfiguration(canonicalJson(value));
}

/**
 * Whether one configuration is ready to release anything, asked of a
 * configuration nobody is releasing: at import, at creation and at draft
 * initialization. A brief is read where the caller has one, against a
 * catalog's defaults.
 */
export function releaseConfigurationReadiness(
  configuration: CanonicalConfiguration,
  brief?: ReleaseBrief,
): ReleaseConfigurationReadiness {
  const value: unknown = JSON.parse(configuration);
  if (declaredConfigurationVersion(value) !== 2)
    return releaseDocumentReadiness(value, brief);
  const readiness = workloadTicketReadiness(value, brief, undefined, undefined);
  return readiness.readiness === "Incomplete"
    ? readiness
    : { readiness: "Ready", configuration: readiness.ticket.configuration };
}

type ReleaseDocumentReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: ReleaseConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: ReleaseConfigurationFault;
    };

function releaseDocumentReadiness(
  value: unknown,
  brief: ReleaseBrief | undefined,
): ReleaseDocumentReadiness {
  const authored = authoredTaskConfigurationReadiness(value);
  if (!executionRequirementConfigurationIsValid(value))
    return { readiness: "Incomplete", fault: "ReleaseShapeInvalid" };
  if (authored.readiness === "Incomplete") return authored;
  if (
    authored.configuration.worker === undefined &&
    briefsAnyAgent(authored.configuration)
  )
    return { readiness: "Incomplete", fault: "WorkerUndeclared" };
  if (
    brief !== undefined &&
    brief.checks.length > 0 &&
    firstCommandedCheckStage(authored.configuration) === undefined
  )
    return { readiness: "Incomplete", fault: "BriefChecksUncommanded" };
  return {
    readiness: "Ready",
    configuration: value as ReleaseConfiguration,
  };
}

/**
 * A version 1 ticket: its configuration with the overrides applied, and no
 * selection, there being nothing in one document to select.
 */
function releaseDocumentTicketReadiness(
  value: unknown,
  brief: ReleaseBrief | undefined,
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
): TicketConfigurationReadiness {
  if (!configurationSelectionEmpty(selection))
    return { readiness: "Incomplete", fault: "SelectionUnsupported" };
  if (overrides?.workloads !== undefined)
    return { readiness: "Incomplete", fault: "OverridesUnsupported" };
  const readiness = releaseDocumentReadiness(
    configurationWithOverrides(value, overrides),
    brief,
  );
  return readiness.readiness === "Incomplete"
    ? readiness
    : {
        readiness: "Ready",
        ticket: { version: 1, configuration: readiness.configuration },
      };
}

/** Whether a catalog ticket's overrides name a workload, or a prompt file, its catalog does not hold. */
function workloadTicketOverridesUnknown(
  catalog: WorkloadConfiguration,
  workloads: NonNullable<ConfigurationOverrides["workloads"]>,
): boolean {
  const prompts = new Set(
    Object.values(catalog.workloads).flatMap((workload) =>
      workload.runner === "Agent" && workload.prompt.path !== undefined
        ? [workload.prompt.path]
        : [],
    ),
  );
  return Object.entries(workloads).some(
    ([name, override]) =>
      !Object.hasOwn(catalog.workloads, name) ||
      (override.prompt !== undefined &&
        "path" in override.prompt &&
        !prompts.has(override.prompt.path)),
  );
}

/**
 * A version 2 ticket: the catalog with the ticket's workload overrides
 * applied, and the entries the ticket selected from it. A catalog ticket
 * overrides workloads alone, since every other field it could name is one a
 * catalog does not have.
 */
function workloadTicketReadiness(
  value: unknown,
  brief: ReleaseBrief | undefined,
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
): TicketConfigurationReadiness {
  const { workloads, ...unsupported } = overrides ?? {};
  if (Object.values(unsupported).some((field) => field !== undefined))
    return { readiness: "Incomplete", fault: "OverridesUnsupported" };
  const pinned = workloadConfigurationReadiness(value);
  if (pinned.readiness === "Incomplete") return pinned;
  if (
    workloads !== undefined &&
    workloadTicketOverridesUnknown(pinned.configuration, workloads)
  )
    return { readiness: "Incomplete", fault: "OverridesUnknown" };
  const readiness =
    workloads === undefined
      ? pinned
      : workloadConfigurationReadiness(
          configurationWithOverrides(value, { workloads }),
        );
  if (readiness.readiness === "Incomplete") return readiness;
  const selected = selectedCatalogEntries(readiness.configuration, selection);
  if (selected.selected === "Unknown")
    return { readiness: "Incomplete", fault: "SelectionUnknown" };
  if (
    brief !== undefined &&
    brief.checks.length > 0 &&
    selectedFirstCommandsEvaluator(selected.value) === undefined
  )
    return { readiness: "Incomplete", fault: "BriefChecksUncommanded" };
  return {
    readiness: "Ready",
    ticket: {
      version: 2,
      configuration: readiness.configuration,
      selection: selected.value,
    },
  };
}

/**
 * What one ticket would run on: the configuration with what the draft asks of
 * it applied, judged by the configuration's own version, with no repository
 * held to it.
 */
export function ticketConfigurationReadiness(
  configuration: CanonicalConfiguration,
  brief: ReleaseBrief | undefined,
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
): TicketConfigurationReadiness {
  const value: unknown = JSON.parse(configuration);
  return declaredConfigurationVersion(value) === 2
    ? workloadTicketReadiness(value, brief, overrides, selection)
    : releaseDocumentTicketReadiness(value, brief, overrides, selection);
}

/**
 * Whether a program names only tasks its ticket's configuration defines. A
 * document's stages each run one block whatever evaluator keys a stage lists;
 * a catalog's evaluator key is a position in its plan's stage, so a key past
 * that stage's evaluators names nothing.
 */
function ticketProgramFits(
  ticket: TicketConfiguration,
  program: ReleaseAuthoringProgram,
): boolean {
  if (ticket.version === 1) return true;
  const stages = ticket.selection.plan.stages;
  return (
    program.length <= stages.length &&
    program.every((stage) =>
      stage.evaluators.every(
        (entry) => entry.key <= (stages[stage.key - 1]?.evaluators.length ?? 0),
      ),
    )
  );
}

/** Whether a program runs one task: the stage keyed `stage`, and in it the evaluator keyed `evaluator` where one is named. */
function ticketProgramRuns(
  program: ReleaseAuthoringProgram,
  stage: number,
  evaluator?: number,
): boolean {
  const evaluators =
    program.find((entry) => entry.key === stage)?.evaluators ?? [];
  return evaluator === undefined
    ? evaluators.length > 0
    : evaluators.some((entry) => entry.key === evaluator);
}

/**
 * Whether a program runs less than its ticket's configuration plans: a stage of
 * a catalog's selected plan it does not run, or an evaluator of one it does;
 * for a document, a block of its `evaluations` it runs no stage under. A
 * document's stage runs one block whatever evaluator keys it lists, so only its
 * stages count, and a document listing no `evaluations` plans none.
 */
export function ticketProgramShort(
  ticket: TicketConfiguration,
  program: ReleaseAuthoringProgram,
): boolean {
  if (ticket.version === 1)
    return (ticket.configuration.evaluations ?? []).some(
      (_block, index) => !ticketProgramRuns(program, index + 1),
    );
  return ticket.selection.plan.stages.some((stage, index) =>
    stage.evaluators.some(
      (_entry, position) =>
        !ticketProgramRuns(program, index + 1, position + 1),
    ),
  );
}

/**
 * Whether a program runs the task a brief's own check lines join: the stage
 * `ticketCommandedCheckStage` names, and for a catalog the evaluator in it that
 * runs commands. A configuration commanding none has nothing to leave out.
 */
function ticketProgramRunsBriefChecks(
  ticket: TicketConfiguration,
  program: ReleaseAuthoringProgram,
): boolean {
  if (ticket.version === 1) {
    const stage = ticketCommandedCheckStage(ticket);
    return stage === undefined || ticketProgramRuns(program, stage);
  }
  const commanded = selectedFirstCommandsEvaluator(ticket.selection);
  return (
    commanded === undefined ||
    ticketProgramRuns(program, commanded.stage, commanded.evaluator)
  );
}

/**
 * The release-time minimum for one draft: the configuration's own readiness
 * with what the draft asks of it applied, plus the repository the brief and the
 * configuration have to agree on. An imported revision was read out of a
 * repository and a bootstrap was authored for one, so each releases from that
 * binding alone, and any other configuration releases under any binding.
 */
export function draftReleaseReadiness(
  configuration: CanonicalConfiguration,
  brief: ReleaseBrief | undefined,
  configurationRepository: ConfigurationRepository | undefined,
  overrides: ConfigurationOverrides | undefined,
  selection?: ConfigurationSelection,
  program?: ReleaseAuthoringProgram,
): TicketConfigurationReadiness {
  const readiness = ticketConfigurationReadiness(
    configuration,
    brief,
    overrides,
    selection,
  );
  if (readiness.readiness === "Incomplete") return readiness;
  if (program !== undefined && !ticketProgramFits(readiness.ticket, program))
    return { readiness: "Incomplete", fault: "ProgramExceedsPlan" };
  if (
    program !== undefined &&
    brief !== undefined &&
    brief.checks.length > 0 &&
    !ticketProgramRunsBriefChecks(readiness.ticket, program)
  )
    return { readiness: "Incomplete", fault: "ProgramSkipsBriefChecks" };
  const repository = brief?.repository;
  if (repository === undefined)
    return { readiness: "Incomplete", fault: "BriefNamesNoRepository" };
  if (
    configurationRepository !== undefined &&
    !configurationRepositoryReleases(configurationRepository, repository)
  )
    return {
      readiness: "Incomplete",
      fault: "ConfigurationFromAnotherRepository",
    };
  return readiness;
}

const prohibitedConfigurationKeys =
  /(?:password|secret|token|credential(?!s$))/iu;

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object")
    throw new TypeError("canonical configuration: unsupported JSON value");
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (prohibitedConfigurationKeys.test(key))
      throw new RangeError(
        `canonical configuration: prohibited secret-bearing field ${key}`,
      );
    result[key] = canonicalValue(record[key]);
  }
  return result;
}

function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalValue(value));
  if (encoded === undefined)
    throw new TypeError("canonical configuration: value is not JSON");
  return encoded;
}

/**
 * WHAT AN AUTHOR CHOSE, WHICH IS NOT WHAT A RELEASE FREEZES. The dependencies
 * and the stages are the draft's; the definition the ticket runs at is
 * resolved against the configuration revision the release names, so a draft
 * cannot hold one and this is all a draft holds.
 */
export interface ReleaseAuthoring {
  readonly deps: ReadonlySet<number>;
  readonly prog: ReleaseAuthoringProgram;
}

/**
 * Canonicalizes draft semantics through the wire's own authoring schema, which
 * is the only shape a draft has ever carried: it was stored as an encoded
 * release event while a release carried nothing else, and a release now carries
 * a definition no draft can resolve.
 */
export function encodeDraftAuthoring(authoring: ReleaseAuthoring): string {
  return JSON.stringify(
    authoringSchema.parse({
      dependencies: [...authoring.deps].sort((left, right) => left - right),
      program: authoring.prog.map((stage) => ({
        key: stage.key,
        evaluators: stage.evaluators.map((entry) => ({ key: entry.key })),
      })),
    } satisfies ReleaseAuthoringBody),
  );
}

/** Reads stored draft semantics through the same schema that wrote them. */
export function parseDraftAuthoring(value: string): ReleaseAuthoring {
  const parsed = authoringSchema.safeParse(JSON.parse(value));
  if (!parsed.success)
    throw new TypeError(
      `draft authoring is unreadable: ${parsed.error.issues[0]?.message ?? "malformed"}`,
    );
  return { deps: new Set(parsed.data.dependencies), prog: parsed.data.program };
}

export type DraftState = "Draft" | "Released" | "Deleted";

/** The brief is absent exactly for a draft authored before a draft carried one. */
export interface DraftResource {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly authoringVersion: number;
  readonly state: DraftState;
  /**
   * The authoring version the ticket's live revision was released from,
   * carried exactly when the draft is released. A released draft whose ticket
   * is still Pending takes revisions again, so this and `authoringVersion`
   * differ exactly when the draft holds changes nobody has released.
   */
  readonly releasedAuthoringVersion?: number;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly configurationVersion?: ConfigurationVersion;
  readonly authoring: ReleaseAuthoring;
  readonly brief?: DraftBrief;
  readonly overrides?: ConfigurationOverrides;
  readonly selection?: ConfigurationSelection;
}

export interface ConfigurationRevisionResource {
  readonly partition: Partition;
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
  readonly digest: string;
  readonly version?: ConfigurationVersion;
  /** The file each catalog workload named by path was read from, where an import kept any. */
  readonly workloadPaths?: Readonly<Record<string, string>>;
}

export interface ConfigurationPageCursor {
  readonly createdAt: PublicInstant;
  readonly revision: ConfigurationRevisionId;
}

interface ConfigurationRevisionSummaryBase {
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly digest: string;
  readonly createdAt: PublicInstant;
  readonly provenance: ConfigurationRevisionProvenance;
  readonly version?: ConfigurationVersion;
}

export type ConfigurationRevisionProvenance =
  | { readonly source: "Authored" }
  | {
      readonly source: "Repository";
      readonly repository: RepositoryId;
      readonly commit: GitObjectId;
      readonly path: RepositoryConfigurationPath;
      readonly name: RepositoryConfigurationName;
    };

/**
 * What one ready configuration decides about finishing, for a reader choosing
 * between configurations without opening either.
 */
export interface ConfigurationFinalization {
  readonly approvalRequired: boolean;
}

export type ConfigurationRevisionSummary =
  | (ConfigurationRevisionSummaryBase & { readonly readiness: "Incomplete" })
  | (ConfigurationRevisionSummaryBase & {
      readonly readiness: "Ready";
      readonly image: string;
      readonly worker?: Worker;
      readonly practices: readonly string[];
      readonly finalization: ConfigurationFinalization;
      readonly evaluationStagesCount: number;
    } & ConfigurationDocumentSummary);

/**
 * What a summary says of one version's own shape: a document's instruction
 * counts, or a catalog's entry names and defaults.
 */
export type ConfigurationDocumentSummary =
  | {
      readonly workInstructionsCount: number;
      readonly reviewInstructionsCount: number;
      readonly catalog?: undefined;
    }
  | {
      readonly workInstructionsCount?: undefined;
      readonly reviewInstructionsCount?: undefined;
      readonly catalog: ConfigurationCatalogSummary;
    };

/** The names a catalog holds, and the ones a ticket selecting nothing runs on. */
export interface ConfigurationCatalogSummary {
  readonly workloads: readonly string[];
  readonly plans: readonly string[];
  readonly finalizers: readonly string[];
  readonly defaults: WorkloadConfiguration["defaults"];
}

/**
 * The same summary carrying the label its image is catalogued under. An
 * incomplete revision pins nothing, and an image no catalog names keeps none.
 */
export function configurationRevisionSummaryLabelled(
  summary: ConfigurationRevisionSummary,
  workers: ReadonlyMap<string, Worker>,
): ConfigurationRevisionSummary {
  if (summary.readiness !== "Ready") return summary;
  const worker = workers.get(summary.image);
  return worker === undefined ? summary : { ...summary, worker };
}

export interface ConfigurationPage {
  readonly partition: Partition;
  readonly configurations: readonly ConfigurationRevisionSummary[];
  readonly nextAfter?: ConfigurationPageCursor;
}

export interface ConfigurationPageQuery {
  readonly after?: ConfigurationPageCursor;
  readonly limit: number;
  /** Only the newest revision of each repository configuration; a revision imported from none is its own. */
  readonly latest?: boolean;
}

export const configurationPageLimitMax = 100;

/**
 * What a ready configuration decides about finishing. An approval policy this
 * tree cannot read is not read as no approval: the finalizer refuses such a
 * candidate rather than promoting it, so the summary says a person is in the
 * way of one.
 */
function configurationFinalizationOf(
  canonical: CanonicalConfiguration,
): ConfigurationFinalization {
  return { approvalRequired: handoffApprovalRequired(canonical) ?? true };
}

export function configurationRevisionSummary(input: {
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
  readonly digest: string;
  readonly createdAt: PublicInstant;
  readonly provenance: ConfigurationRevisionProvenance;
  readonly version?: ConfigurationVersion;
}): ConfigurationRevisionSummary {
  const readiness = releaseConfigurationReadiness(input.canonical);
  const base = {
    revision: input.revision,
    ...(input.parent === undefined ? {} : { parent: input.parent }),
    digest: input.digest,
    createdAt: input.createdAt,
    provenance: input.provenance,
    ...(input.version === undefined ? {} : { version: input.version }),
  };
  if (readiness.readiness === "Incomplete")
    return { ...base, readiness: "Incomplete" };
  const configuration = readiness.configuration;
  const shared = {
    ...base,
    readiness: "Ready" as const,
    image: configuration.image,
    finalization: configurationFinalizationOf(input.canonical),
  };
  if (configuration.version === 2)
    return {
      ...shared,
      practices: [],
      evaluationStagesCount:
        configuration.plans[configuration.defaults.evaluation]?.length ?? 0,
      catalog: {
        workloads: Object.keys(configuration.workloads).sort(),
        plans: Object.keys(configuration.plans).sort(),
        finalizers: Object.keys(configuration.finalizers ?? {}).sort(),
        defaults: configuration.defaults,
      },
    };
  return {
    ...shared,
    practices: configuration.practices,
    workInstructionsCount: configuration.work.instructions?.length ?? 0,
    reviewInstructionsCount: configuration.review.instructions.length,
    evaluationStagesCount: configuration.evaluations?.length ?? 0,
  };
}

export function checkedConfigurationPageQuery(
  query: ConfigurationPageQuery,
): ConfigurationPageQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > configurationPageLimitMax
  )
    throw new RangeError(
      `configuration page limit must be between 1 and ${String(configurationPageLimitMax)}`,
    );
  if (query.latest !== undefined && typeof query.latest !== "boolean")
    throw new TypeError("configuration page latest must be a boolean");
  return query;
}

/**
 * Where a page of drafts resumes, which is the last ticket the page before it
 * answered. A draft's ticket is allocated ascending and never reused, so it
 * orders the collection and positions a cursor in it at once.
 */
export type DraftPageCursor = TicketId;

/** One page of a project's drafts, ascending by ticket, `more` saying whether the page ends them. */
export interface DraftPage {
  readonly partition: Partition;
  readonly drafts: readonly DraftResource[];
  readonly nextCursor?: DraftPageCursor;
  readonly more: boolean;
}

/** What one page of drafts is asked for: where to resume, and how many to answer. */
export interface DraftPageQuery {
  readonly cursor?: DraftPageCursor;
  readonly limit: number;
}

/** What a page of drafts answers where the caller named no limit. */
export const draftPageLimitDefault = nativeHttpPageItemsDefault;

/** Refuses a page limit outside what one wire body carries. */
export function checkedDraftPageQuery(query: DraftPageQuery): DraftPageQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > nativeHttpPageItemsMax
  )
    throw new RangeError(
      `draft page limit must be between 1 and ${String(nativeHttpPageItemsMax)}`,
    );
  return query;
}

export type ConfigurationCreated =
  | {
      readonly created: "Created";
      readonly revision: ConfigurationRevisionResource;
    }
  | {
      readonly created: "AlreadyExists";
      readonly revision: ConfigurationRevisionResource;
    }
  | { readonly created: "IdentityConflict" }
  | { readonly created: "ParentNotFound" };

/**
 * `RepositoryNotBound` is the brief's repository refused and `ArtifactNotBound`
 * is the same claim about an image it names, the door reading the store itself
 * where the referent is a filesystem fact rather than a row a foreign key could
 * raise on, both refusals like `ConfigurationNotFound` and not a fault; that
 * same read answers `Unavailable` instead when the store itself cannot be
 * asked, a fault a caller told to retry must never be told is a missing image.
 * `LandingUnbranched` is the same for a brief whose resolved landing proposes
 * and which names no branch to propose from: the landing it is refused for is
 * the repository's, which the caller never named and cannot see.
 */
export type DraftCreated =
  | { readonly created: "Created"; readonly draft: DraftResource }
  | { readonly created: "ConfigurationNotFound" }
  | { readonly created: "RepositoryNotBound" }
  | { readonly created: "ArtifactNotBound" }
  | { readonly created: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly created: "LandingUnbranched" }
  /** The project head moved past the one the initialization answered, and is at this one now. */
  | { readonly created: "Stale"; readonly currentProjectSequence: number }
  /** The project's lifecycle mints no ticket at any head, so no head to retry with is answered. */
  | { readonly created: "NotActive"; readonly lifecycle: Lifecycle };

export interface DraftInitialization {
  readonly configuration: ConfigurationRevisionResource;
  readonly projectSequence: number;
  readonly defaults: ReleaseAuthoring;
  /** The two bounds an author draws a program within: how many stages, and how far an evaluator key reaches. */
  readonly choices: {
    readonly programStagesMax: number;
    readonly evaluatorsMax: number;
  };
  readonly dependencyCandidates: readonly TicketId[];
  readonly dependencyCandidatesTruncated: boolean;
  /**
   * The stage this configuration runs as commands and a ticket's own check
   * lines would join, by its program stage key, absent where it commands none
   * — which is what makes a brief carrying them unreleasable against this
   * configuration.
   */
  readonly commandedCheckStage?: number;
  /** The same fact in words, stated whether or not a stage takes them. */
  readonly commandedCheckStageNote: string;
}

export type DraftInitializationRead =
  | { readonly initialized: "Initialized"; readonly value: DraftInitialization }
  | { readonly initialized: "ConfigurationNotFound" }
  | { readonly initialized: "ConfigurationIncomplete" }
  | { readonly initialized: "SelectionUnknown" }
  | { readonly initialized: "PolicyUnavailable" };

export interface DraftInitializationSnapshot extends Omit<
  DraftInitialization,
  "defaults" | "choices" | "commandedCheckStage" | "commandedCheckStageNote"
> {
  readonly domain: Config;
}

/** The deployment policy exposed to authors; release validation consumes the same universes. */
export function draftInitializationPolicy(
  config: Config,
  ticket?: TicketConfiguration,
): Pick<DraftInitialization, "defaults" | "choices"> {
  const program = draftInitializationProgram(config, ticket);
  return {
    defaults: { deps: new Set(), prog: program },
    choices: {
      programStagesMax: Math.min(
        config.maxStages,
        draftInitializationStagesMax(config, ticket),
      ),
      evaluatorsMax: config.nTasks,
    },
  };
}

/**
 * The most stages a program may have: as many as a catalog's selected plan or
 * a document's `evaluations` list, and the domain's bound where neither
 * names any.
 */
function draftInitializationStagesMax(
  config: Config,
  ticket: TicketConfiguration | undefined,
): number {
  if (ticket?.version === 2) return ticket.selection.plan.stages.length;
  return ticket?.configuration.evaluations?.length ?? config.maxStages;
}

/**
 * The program a draft starts from: one stage per block a document lists, each
 * with one evaluator; one stage per stage of a catalog's selected plan, each
 * with its plan's evaluators; or the domain's default plan where the document
 * lists none.
 */
function draftInitializationProgram(
  config: Config,
  ticket: TicketConfiguration | undefined,
): ReleaseAuthoringProgram {
  if (ticket?.version === 2)
    return ticket.selection.plan.stages.map((stage, index) => ({
      key: index + 1,
      evaluators: stage.evaluators.map((_entry, position) => ({
        key: position + 1,
      })),
    }));
  const evaluations = ticket?.configuration.evaluations;
  return evaluations === undefined
    ? defaultPlan(config).map((stage) => ({
        key: stage.key,
        evaluators: stage.evaluators.map((entry) => ({ key: entry.key })),
      }))
    : evaluations.map((_block, index) => ({
        key: index + 1,
        evaluators: [{ key: 1 }],
      }));
}

/**
 * The stage a ticket's own check lines join, by the key its program stage
 * takes, counted from one: the first block a document runs as commands, or the
 * stage holding the first evaluator a catalog's selected plan runs as commands.
 */
export function ticketCommandedCheckStage(
  ticket: TicketConfiguration,
): number | undefined {
  if (ticket.version === 1) {
    const at = firstCommandedCheckStage(ticket.configuration);
    return at === undefined ? undefined : at + 1;
  }
  return selectedFirstCommandsEvaluator(ticket.selection)?.stage;
}

const ticketCommandedCheckStageNoteNone =
  "This configuration commands no check stage, so a brief carrying checks is refused at release as BriefChecksUncommanded.";

/**
 * Where a ticket's own check lines join, said in words: the stage counted from
 * one, and for a catalog the selected plan and that stage by name, or where no
 * stage takes them, that a brief carrying them is refused and which plans would.
 */
export function ticketCommandedCheckStageNote(
  ticket: TicketConfiguration,
): string {
  const stage = ticketCommandedCheckStage(ticket);
  if (ticket.version === 1)
    return stage === undefined
      ? ticketCommandedCheckStageNoteNone
      : `A brief's checks run in evaluation stage ${String(stage)}, counted from one, after the commands this configuration runs there.`;
  const plan = ticket.selection.plan;
  if (stage === undefined) {
    const commanded = catalogPlansCommanded(ticket.configuration);
    return commanded.length === 0
      ? ticketCommandedCheckStageNoteNone
      : `Plan "${plan.name}" commands no check stage, so a brief carrying checks is refused at release as BriefChecksUncommanded unless the ticket selects a plan that does: ${commanded.map((name) => `"${name}"`).join(", ")}.`;
  }
  const named = plan.stages[stage - 1]?.name;
  if (named === undefined)
    throw new RangeError(
      `catalog: plan ${plan.name} has no stage ${String(stage)}`,
    );
  return `Under plan "${plan.name}", a brief's checks run in evaluation stage ${String(stage)}, counted from one, named "${named}", after the commands the plan runs there.`;
}

/**
 * `RepositoryNotBound`, `ArtifactNotBound`, `Unavailable` and `LandingUnbranched`
 * are the refusals `DraftCreated` documents. A released draft is revisable
 * while its ticket is Pending, and past it `NotDraft`.
 */
export type DraftRevised =
  | { readonly revised: "Revised"; readonly draft: DraftResource }
  | { readonly revised: "NotFound" }
  | { readonly revised: "Stale"; readonly currentVersion: number }
  | {
      readonly revised: "NotDraft";
      readonly state: Exclude<DraftState, "Draft">;
    }
  | { readonly revised: "ConfigurationNotFound" }
  | { readonly revised: "RepositoryNotBound" }
  | { readonly revised: "ArtifactNotBound" }
  | { readonly revised: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly revised: "LandingUnbranched" };

/**
 * Who named the landing a write stored a draft's brief with, in the order the
 * write asks: the brief, the finalizer its catalog selection lands with, the
 * repository it names, and `briefFinalizationDefault` where none of them does,
 * which is a brief naming no repository.
 */
export type DraftLandingSource =
  "Brief" | "Finalizer" | "Repository" | "Default";

/** The landing one write stored a draft's brief with, and who named it. */
export type DraftLanding = BriefFinalization & {
  readonly source: DraftLandingSource;
};

export type DraftDeleted =
  | { readonly deleted: "Deleted"; readonly draft: DraftResource }
  | { readonly deleted: "NotFound" }
  | { readonly deleted: "Stale"; readonly currentVersion: number }
  | {
      readonly deleted: "NotDraft";
      readonly state: Exclude<DraftState, "Draft">;
    };

/**
 * One retained draft revision as a release of it is judged: the program it
 * runs and what its configuration plans, from the configuration revision it
 * pins with its overrides and selection. A revision is written once and never
 * changed, so this is what the release's decision resolves.
 */
export interface DraftRevisionPlan {
  readonly canonical: CanonicalConfiguration;
  readonly overrides?: ConfigurationOverrides;
  readonly selection?: ConfigurationSelection;
  readonly program: ReleaseAuthoringProgram;
}

export interface AuthoringStore {
  initializeDraft(
    partition: Partition,
    revision: ConfigurationRevisionId,
    dependencyCandidatesMax: number,
  ): Promise<DraftInitializationSnapshot | "PolicyUnavailable" | undefined>;
  configurations(
    partition: Partition,
    query: ConfigurationPageQuery,
  ): Promise<ConfigurationPage>;
  configuration(
    partition: Partition,
    revision: ConfigurationRevisionId,
  ): Promise<ConfigurationRevisionResource | undefined>;
  draft(
    partition: Partition,
    ticket: TicketId,
  ): Promise<DraftResource | undefined>;
  /** One page of the drafts a project still holds open, ascending by ticket. */
  drafts(partition: Partition, query: DraftPageQuery): Promise<DraftPage>;
  /** The revision a release or an update names, undefined where the project retains none at those keys. */
  draftRevision(
    partition: Partition,
    revision: {
      readonly ticket: TicketId;
      readonly authoringVersion: number;
      readonly configurationRevision: string;
    },
  ): Promise<DraftRevisionPlan | undefined>;
  createConfiguration(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly revision: ConfigurationRevisionId;
    readonly parent?: ConfigurationRevisionId;
    readonly canonical: CanonicalConfiguration;
  }): Promise<ConfigurationCreated>;
  createDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly configurationRevision: ConfigurationRevisionId;
    readonly configurationDigest: string;
    readonly expectedProjectSequence: number;
    readonly authoring: ReleaseAuthoring;
    readonly brief: DraftBrief;
    readonly overrides?: ConfigurationOverrides;
    readonly selection?: ConfigurationSelection;
    /** The session the draft was created through, absent where no session's bearer carried it; no revision moves it. */
    readonly originSession?: SessionId;
  }): Promise<DraftCreated>;
  reviseDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly ticket: TicketId;
    readonly expectedVersion: number;
    readonly configurationRevision: ConfigurationRevisionId;
    readonly authoring: ReleaseAuthoring;
    readonly brief: DraftBrief;
    readonly overrides?: ConfigurationOverrides;
    readonly selection?: ConfigurationSelection;
  }): Promise<DraftRevised>;
  deleteDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly ticket: TicketId;
    readonly expectedVersion: number;
  }): Promise<DraftDeleted>;
}
