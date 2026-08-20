/** Versioned native authoring state, outside the journaled ticket core. */

import {
  releaseAuthoringOf,
  releaseTicketEvent,
  type ReleaseAuthoring,
} from "../actor/decisionEvent.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import { encodeDecisionEventText, parseDecisionEventText } from "./wire.ts";

declare const configurationRevisionBrand: unique symbol;
declare const canonicalConfigurationBrand: unique symbol;

export type ConfigurationRevisionId = string & {
  readonly [configurationRevisionBrand]: true;
};

export type CanonicalConfiguration = string & {
  readonly [canonicalConfigurationBrand]: true;
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

const prohibitedConfigurationKeys = /(?:password|secret|token|credential)/iu;

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
