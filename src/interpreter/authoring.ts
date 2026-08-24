/** Versioned native authoring state, outside the journaled ticket core. */

import {
  releaseAuthoringOf,
  releaseTicketEvent,
  type ReleaseAuthoring,
} from "../actor/decisionEvent.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";
import { encodeDecisionEventText, parseDecisionEventText } from "./wire.ts";
import { executionRequirementConfigurationIsValid } from "./executionRequirement.ts";
import {
  authoredTaskConfigurationReadiness,
  type AuthoredTaskConfiguration,
  type TaskConfigurationFault,
} from "./taskConfiguration.ts";

declare const configurationRevisionBrand: unique symbol;
declare const canonicalConfigurationBrand: unique symbol;

export type ConfigurationRevisionId = string & {
  readonly [configurationRevisionBrand]: true;
};

export type CanonicalConfiguration = string & {
  readonly [canonicalConfigurationBrand]: true;
};

export type ReleaseConfiguration = Readonly<Record<string, unknown>> & {
  readonly version: 1;
  readonly image: string;
} & AuthoredTaskConfiguration;

export type ReleaseConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: ReleaseConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: "ReleaseShapeInvalid" | TaskConfigurationFault;
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

/** Applies the release-time semantic minimum without restricting draft authoring. */
export function releaseConfigurationReadiness(
  configuration: CanonicalConfiguration,
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

export interface DraftResource {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly authoringVersion: number;
  readonly state: DraftState;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly authoring: ReleaseAuthoring;
}

export interface ConfigurationRevisionResource {
  readonly partition: Partition;
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
  readonly digest: string;
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
}

export type ConfigurationRevisionSummary =
  | (ConfigurationRevisionSummaryBase & { readonly readiness: "Incomplete" })
  | (ConfigurationRevisionSummaryBase & {
      readonly readiness: "Ready";
      readonly image: string;
      readonly practices: readonly string[];
      readonly workInstructionsCount: number;
      readonly reviewInstructionsCount: number;
    });

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
}): ConfigurationRevisionSummary {
  const readiness = releaseConfigurationReadiness(input.canonical);
  const base = {
    revision: input.revision,
    ...(input.parent === undefined ? {} : { parent: input.parent }),
    digest: input.digest,
    createdAt: input.createdAt,
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
  | { readonly created: "ConfigurationNotFound" };

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
    readonly authoring: ReleaseAuthoring;
  }): Promise<DraftCreated>;
  reviseDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly ticket: TicketId;
    readonly expectedVersion: number;
    readonly configurationRevision: ConfigurationRevisionId;
    readonly authoring: ReleaseAuthoring;
  }): Promise<DraftRevised>;
  deleteDraft(input: {
    readonly partition: Partition;
    readonly authority: Authority;
    readonly ticket: TicketId;
    readonly expectedVersion: number;
  }): Promise<DraftDeleted>;
}
