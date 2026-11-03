import { createHash } from "node:crypto";

import {
  dispatchViewPageLimitMax,
  dispatchViewSchemaVersion,
  textCodePointsCount,
} from "../contract/http.ts";

import { authoringSchema } from "../contract/authoring.ts";
import type { ReleaseAuthoringProgram } from "../contract/authoring.ts";
import { readiesIn } from "../domain/enablement.ts";
import { ticketAt } from "../domain/ticketGraph.ts";
import type { TicketGraph } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type { ConfigurationVersion } from "./repositoryConfigurationIdentity.ts";

/** How many candidates one page carries, surfaced where every reader of it looks. */
export { dispatchViewPageLimitMax };
export const selectorDecisionReferenceCharsMax = 256;

export interface DispatchCandidate {
  readonly ticket: TicketId;
  readonly ticketVersion: number;
  readonly dependencies: readonly number[];
  readonly program: ReleaseAuthoringProgram;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly configurationCanonical: string;
  /** The label a read attaches beside the digested value, which `canonicalCandidate` omits. */
  readonly configurationVersion?: ConfigurationVersion;
}

/** A candidate naming its configuration by revision and digest rather than carrying it. */
export type DispatchCandidateNamed = Omit<
  DispatchCandidate,
  "configurationCanonical"
>;

export interface DispatchConfiguration {
  readonly revision: string;
  readonly digest: string;
  readonly canonical: string;
}

/**
 * Candidates with each configuration they name carried once, however many of
 * them name it: what an observation is weighed and stored as, since one
 * project's ready tickets are mostly on a few configurations.
 */
export interface DispatchCandidatesByConfiguration {
  readonly candidates: readonly DispatchCandidateNamed[];
  readonly configurations: readonly DispatchConfiguration[];
}

function dispatchConfigurationKey(revision: string, digest: string): string {
  return JSON.stringify([revision, digest]);
}

export function dispatchCandidatesByConfiguration(
  candidates: readonly DispatchCandidate[],
): DispatchCandidatesByConfiguration {
  const configurations = new Map<string, DispatchConfiguration>();
  const named = candidates.map((candidate): DispatchCandidateNamed => {
    const key = dispatchConfigurationKey(
      candidate.configurationRevision,
      candidate.configurationDigest,
    );
    const known = configurations.get(key);
    if (known === undefined)
      configurations.set(key, {
        revision: candidate.configurationRevision,
        digest: candidate.configurationDigest,
        canonical: candidate.configurationCanonical,
      });
    else if (known.canonical !== candidate.configurationCanonical)
      throw new TypeError(
        "candidates naming one configuration disagree on its canonical",
      );
    return {
      ticket: candidate.ticket,
      ticketVersion: candidate.ticketVersion,
      dependencies: candidate.dependencies,
      program: candidate.program,
      configurationRevision: candidate.configurationRevision,
      configurationDigest: candidate.configurationDigest,
      ...(candidate.configurationVersion === undefined
        ? {}
        : { configurationVersion: candidate.configurationVersion }),
    };
  });
  return { candidates: named, configurations: [...configurations.values()] };
}

/**
 * The candidates back whole and frozen, refusing a configuration named and not
 * carried or carried and not named.
 */
export function dispatchCandidatesJoined(
  separated: DispatchCandidatesByConfiguration,
): readonly DispatchCandidate[] {
  const configurations = new Map(
    separated.configurations.map((configuration) => [
      dispatchConfigurationKey(configuration.revision, configuration.digest),
      configuration,
    ]),
  );
  if (configurations.size !== separated.configurations.length)
    throw new TypeError("a configuration is carried twice");
  const named = new Set<string>();
  const joined = separated.candidates.map((candidate): DispatchCandidate => {
    const key = dispatchConfigurationKey(
      candidate.configurationRevision,
      candidate.configurationDigest,
    );
    const configuration = configurations.get(key);
    if (configuration === undefined)
      throw new TypeError("a candidate names a configuration not carried");
    named.add(key);
    return Object.freeze({
      ...candidate,
      configurationCanonical: configuration.canonical,
    });
  });
  if (named.size !== configurations.size)
    throw new TypeError("a configuration is carried that no candidate names");
  return Object.freeze(joined);
}

export interface DispatchContractPin {
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly configurationCanonical: string;
}

export interface DispatchViewToken {
  readonly tenant: string;
  readonly project: string;
  readonly recoveryEpoch: string;
  readonly schemaVersion: number;
  readonly watermark: number;
  readonly digest: string;
}

export interface DispatchView extends DispatchViewToken {
  readonly candidates: readonly DispatchCandidate[];
}

export interface DispatchViewQuery {
  readonly after?: TicketId;
  readonly limit: number;
  readonly watermark?: number;
}

export type DispatchViewPage =
  | { readonly result: "Reset" }
  | {
      readonly result: "Page";
      readonly token: DispatchViewToken;
      readonly candidates: readonly DispatchCandidate[];
      readonly nextAfter?: TicketId;
      readonly notificationCursor: number;
    };

export interface DispatchViewStore {
  read(
    partition: { readonly tenant: string; readonly project: string },
    query: DispatchViewQuery,
  ): Promise<DispatchViewPage>;
}

/**
 * The program a stored candidate carries, read and written through the
 * authoring schema the wire states. A candidate offers a selector what its
 * author chose, not what the release resolved: the task definitions a released
 * stage hangs off each evaluator are no part of a choice, and a reader that was
 * handed them would be reading a second copy of the journal.
 */
const dispatchProgramSchema = authoringSchema.shape.program;

export function decodeDispatchProgram(
  value: unknown,
): DispatchCandidate["program"] {
  if (!Array.isArray(value))
    throw new TypeError("dispatch program is not an array");
  return dispatchProgramSchema.parse(value);
}

export function encodeDispatchProgram(
  value: DispatchCandidate["program"],
): unknown {
  return dispatchProgramSchema.parse(
    value.map((stage) => ({
      key: stage.key,
      evaluators: stage.evaluators.map((entry) => ({ key: entry.key })),
    })),
  );
}

function canonicalCandidate(candidate: DispatchCandidate): unknown {
  return {
    ticket: candidate.ticket,
    ticketVersion: candidate.ticketVersion,
    dependencies: [...candidate.dependencies],
    program: candidate.program.map((stage) => ({
      key: stage.key,
      evaluators: stage.evaluators.map((evaluator) => ({
        key: evaluator.key,
      })),
    })),
    configurationRevision: candidate.configurationRevision,
    configurationDigest: candidate.configurationDigest,
    configurationCanonical: candidate.configurationCanonical,
  };
}

/** The strict, presentation-independent digest of one complete candidate set. */
export function dispatchViewDigest(
  candidates: readonly DispatchCandidate[],
  schemaVersion = dispatchViewSchemaVersion,
): string {
  const ordered = [...candidates].sort(
    (left, right) => left.ticket - right.ticket,
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion,
        candidates: ordered.map(canonicalCandidate),
      }),
    )
    .digest("hex");
}

/**
 * Derives selection-visible truth from authoritative state and immutable
 * contract pins. A candidate is a ticket a dispatch is enabled at, which is a
 * ready ticket: the source the dispatch would carry is observed when it is
 * decided and is no part of whether there is one to decide.
 */
export function deriveDispatchCandidates(
  graph: TicketGraph,
  ticketVersions: ReadonlyMap<number, number>,
  contracts: ReadonlyMap<number, DispatchContractPin>,
): readonly DispatchCandidate[] {
  return readiesIn(graph).flatMap((ticket) => {
    const value = ticketAt(graph, ticket);
    const ticketVersion = ticketVersions.get(ticket);
    const contract = contracts.get(ticket);
    if (ticketVersion === undefined || contract === undefined)
      throw new Error(
        `dispatch view: ticket ${String(ticket)} has no retained versioned contract`,
      );
    return [
      {
        ticket,
        ticketVersion,
        dependencies: [...value.definition.dependencies].sort(
          (left, right) => left - right,
        ),
        program: value.definition.evaluationPlan.stages.map((stage) => ({
          key: stage.key,
          evaluators: stage.evaluators.map((entry) => ({ key: entry.key })),
        })),
        ...contract,
      },
    ];
  });
}

export function checkedDispatchViewQuery(
  query: DispatchViewQuery,
): DispatchViewQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > dispatchViewPageLimitMax
  )
    throw new RangeError(
      `dispatch view limit must be between 1 and ${String(dispatchViewPageLimitMax)}`,
    );
  if (
    query.watermark !== undefined &&
    (!Number.isSafeInteger(query.watermark) || query.watermark < 0)
  )
    throw new RangeError(
      "dispatch view watermark must be a non-negative safe integer",
    );
  return query;
}

export function checkedSelectorDecisionReference(value: string): string {
  if (
    value.length === 0 ||
    textCodePointsCount(value) > selectorDecisionReferenceCharsMax ||
    !value.isWellFormed()
  )
    throw new RangeError(
      "selector decision reference is empty, malformed, or too long",
    );
  return value;
}
