/** Versioned native authoring state, outside the journaled ticket core. */

import {
  releaseAuthoringOf,
  releaseTicketEvent,
  type ReleaseAuthoring,
} from "../actor/decisionEvent.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import {
  defaultProgram,
  finalizationPricingChoices,
  finalizerChoices,
  reworkPolicyChoices,
  resumePricingChoices,
  stageChoices,
  workFanoutChoices,
  type Config,
} from "../domain/config.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import type {
  ConfigurationVersion,
  RepositoryConfigurationName,
  RepositoryConfigurationPath,
} from "./repositoryConfigurationIdentity.ts";
import type { Worker } from "./workerCatalog.ts";
import { encodeDecisionEventText, parseDecisionEventText } from "./wire.ts";
import { executionRequirementConfigurationIsValid } from "./executionRequirement.ts";
import {
  authoredHandoffConfigurationReadiness,
  handoffConfigurationField,
  type HandoffConfigurationFault,
} from "./handoffConfiguration.ts";
import type { CanonicalConfiguration } from "./canonicalConfiguration.ts";
import type { BriefFinalization, DraftBrief } from "./ticketBrief.ts";
import {
  authoredTaskConfigurationReadiness,
  type AuthoredTaskConfiguration,
  type TaskConfigurationFault,
} from "./taskConfiguration.ts";

declare const configurationRevisionBrand: unique symbol;

export type ConfigurationRevisionId = string & {
  readonly [configurationRevisionBrand]: true;
};

export type { CanonicalConfiguration } from "./canonicalConfiguration.ts";

export type ReleaseConfiguration = Readonly<Record<string, unknown>> & {
  readonly version: 1;
  readonly image: string;
} & AuthoredTaskConfiguration;

/**
 * Why one configuration is not releasable. `HandoffProposesChange` is the one
 * fault about the pairing rather than the document: a configuration carrying a
 * handoff and a brief that opens a change proposal contradict each other, and
 * the document alone is fine.
 */
export type ReleaseConfigurationFault =
  | "ReleaseShapeInvalid"
  | "HandoffProposesChange"
  | TaskConfigurationFault
  | HandoffConfigurationFault;

export type ReleaseConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: ReleaseConfiguration;
    }
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

/** Accepts already-canonical configuration bytes after the transport's schema validation. */
export function asCanonicalConfiguration(
  value: string,
): CanonicalConfiguration {
  const bounded = boundedText(value, "canonical configuration", 65_536);
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
 * Applies the release-time semantic minimum without restricting draft
 * authoring. The brief's finalization is read where the caller has one, because
 * a handoff configuration and a brief that proposes a change contradict each
 * other and release is the last moment either can still be edited.
 */
export function releaseConfigurationReadiness(
  configuration: CanonicalConfiguration,
  finalization?: BriefFinalization,
): ReleaseConfigurationReadiness {
  const value: unknown = JSON.parse(configuration);
  const authored = authoredTaskConfigurationReadiness(value);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>)["version"] !== 1 ||
    typeof (value as Record<string, unknown>)["image"] !== "string" ||
    (value as Record<string, unknown>)["image"] === "" ||
    !executionRequirementConfigurationIsValid(value)
  ) {
    return { readiness: "Incomplete", fault: "ReleaseShapeInvalid" };
  }
  if (authored.readiness === "Incomplete") return authored;
  if (
    (value as Record<string, unknown>)[handoffConfigurationField] !== undefined
  ) {
    if (finalization?.mode === "PullRequest")
      return { readiness: "Incomplete", fault: "HandoffProposesChange" };
    const handoff = authoredHandoffConfigurationReadiness(value);
    if (handoff.readiness === "Incomplete") return handoff;
  }
  return {
    readiness: "Ready",
    configuration: value as ReleaseConfiguration,
  };
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

/** Canonicalizes draft semantics through the generated model codec. */
export function encodeDraftAuthoring(authoring: ReleaseAuthoring): string {
  return encodeDecisionEventText(releaseTicketEvent(asTicketId(1), authoring));
}

/** Reads stored draft semantics through the same model codec used by the journal. */
export function parseDraftAuthoring(value: string): ReleaseAuthoring {
  const parsed = parseDecisionEventText(value);
  if (parsed.parsed === "Refused")
    throw new TypeError(`draft authoring is unreadable: ${parsed.why}`);
  const event = parsed.value;
  return releaseAuthoringOf(event);
}

export type DraftState = "Draft" | "Released" | "Deleted";

/** The brief is absent exactly for a draft authored before a draft carried one. */
export interface DraftResource {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly authoringVersion: number;
  readonly state: DraftState;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly configurationVersion?: ConfigurationVersion;
  readonly authoring: ReleaseAuthoring;
  readonly brief?: DraftBrief;
}

export interface ConfigurationRevisionResource {
  readonly partition: Partition;
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
  readonly digest: string;
  readonly version?: ConfigurationVersion;
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

export type ConfigurationRevisionSummary =
  | (ConfigurationRevisionSummaryBase & { readonly readiness: "Incomplete" })
  | (ConfigurationRevisionSummaryBase & {
      readonly readiness: "Ready";
      readonly image: string;
      readonly worker?: Worker;
      readonly practices: readonly string[];
      readonly workInstructionsCount: number;
      readonly reviewInstructionsCount: number;
    });

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
}

export const configurationPageLimitMax = 100;

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
  return readiness.readiness === "Incomplete"
    ? { ...base, readiness: "Incomplete" }
    : {
        ...base,
        readiness: "Ready",
        image: readiness.configuration.image,
        practices: readiness.configuration.practices,
        workInstructionsCount: readiness.configuration.work.instructions.length,
        reviewInstructionsCount:
          readiness.configuration.review.instructions.length,
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

export type DraftCreated =
  | { readonly created: "Created"; readonly draft: DraftResource }
  | { readonly created: "ConfigurationNotFound" }
  | { readonly created: "Stale" };

export interface DraftInitialization {
  readonly configuration: ConfigurationRevisionResource;
  readonly projectSequence: number;
  readonly defaults: ReleaseAuthoring;
  readonly choices: {
    readonly stages: readonly {
      readonly fanout: number;
      readonly combinator: "UnanimousPass" | "AnyPass";
    }[];
    readonly programStagesMax: number;
    readonly workFanouts: readonly number[];
    readonly reworkPolicies: readonly ReleaseAuthoring["reworkPolicy"][];
    readonly finalizationPricings: readonly ReleaseAuthoring["finalizationPricing"][];
    readonly resumePricings: readonly ReleaseAuthoring["resumePricing"][];
    readonly finalizers: readonly ReleaseAuthoring["finalizer"][];
  };
  readonly dependencyCandidates: readonly TicketId[];
  readonly dependencyCandidatesTruncated: boolean;
}

export type DraftInitializationRead =
  | { readonly initialized: "Initialized"; readonly value: DraftInitialization }
  | { readonly initialized: "ConfigurationNotFound" }
  | { readonly initialized: "ConfigurationIncomplete" }
  | { readonly initialized: "PolicyUnavailable" };

export interface DraftInitializationSnapshot extends Omit<
  DraftInitialization,
  "defaults" | "choices"
> {
  readonly domain: Config;
}

/** The deployment policy exposed to authors; release validation consumes the same universes. */
export function draftInitializationPolicy(
  config: Config,
  configuration?: ReleaseConfiguration,
): Pick<DraftInitialization, "defaults" | "choices"> {
  const programStagesMax = Math.min(
    config.maxStages,
    configuration?.evaluations?.length ?? config.maxStages,
  );
  return {
    defaults: {
      deps: new Set(),
      prog:
        configuration?.evaluations === undefined
          ? defaultProgram(config)
          : configuration.evaluations.map(() => ({
              fanout: 1,
              combinator: "UnanimousPass" as const,
            })),
      workFanout: 1,
      reworkPolicy: config.reworkPolicy,
      finalizationPricing: "DeadlineOnly",
      resumePricing: "RetryCharged",
      finalizer: "ManagedFinalizer",
    },
    choices: {
      stages: stageChoices(config),
      programStagesMax,
      workFanouts: workFanoutChoices(config),
      reworkPolicies: reworkPolicyChoices(config),
      finalizationPricings: finalizationPricingChoices(config),
      resumePricings: resumePricingChoices,
      finalizers: finalizerChoices,
    },
  };
}

export type DraftRevised =
  | { readonly revised: "Revised"; readonly draft: DraftResource }
  | { readonly revised: "NotFound" }
  | { readonly revised: "Stale"; readonly currentVersion: number }
  | {
      readonly revised: "NotDraft";
      readonly state: Exclude<DraftState, "Draft">;
    }
  | { readonly revised: "ConfigurationNotFound" };

export type DraftDeleted =
  | { readonly deleted: "Deleted"; readonly draft: DraftResource }
  | { readonly deleted: "NotFound" }
  | { readonly deleted: "Stale"; readonly currentVersion: number }
  | {
      readonly deleted: "NotDraft";
      readonly state: Exclude<DraftState, "Draft">;
    };

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
  }): Promise<DraftCreated>;
  reviseDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly ticket: TicketId;
    readonly expectedVersion: number;
    readonly configurationRevision: ConfigurationRevisionId;
    readonly authoring: ReleaseAuthoring;
    readonly brief: DraftBrief;
  }): Promise<DraftRevised>;
  deleteDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly ticket: TicketId;
    readonly expectedVersion: number;
  }): Promise<DraftDeleted>;
}
