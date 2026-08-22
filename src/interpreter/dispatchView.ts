import { createHash } from "node:crypto";

import { decisionEventEnabled } from "../actor/decisionEvent.ts";
import type { Config } from "../domain/config.ts";
import { ticketAt, ticketIds } from "../domain/core.ts";
import type { Core, Stage } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import {
  decodeFinalizationPricing,
  decodeReworkPolicy,
  decodeStage,
  encodeFinalizationPricing,
  encodeReworkPolicy,
  encodeStage,
  type ModelJson,
} from "../generated/model-api.ts";

export const dispatchViewSchemaVersion = 1;
export const dispatchViewPageLimitMax = 100;
export const selectorDecisionReferenceCharsMax = 256;

export interface DispatchCandidate {
  readonly ticket: TicketId;
  readonly ticketVersion: number;
  readonly dependencies: readonly number[];
  readonly workFanout: number;
  readonly program: readonly Stage[];
  readonly reworkPolicy: {
    readonly type: "BudgetedRework";
    readonly value: number;
  };
  readonly finalizationPricing:
    { readonly type: "Budgeted"; readonly value: number } | "DeadlineOnly";
  readonly resumePricing: "RetryCharged" | "RetryFree";
  readonly finalizer: "NoFinalizer" | "ManagedFinalizer";
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly configurationCanonical: string;
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

export function decodeDispatchProgram(
  value: unknown,
): DispatchCandidate["program"] {
  if (!Array.isArray(value))
    throw new TypeError("dispatch program is not an array");
  return value.map(decodeStage);
}

export function encodeDispatchProgram(
  value: DispatchCandidate["program"],
): ModelJson {
  return value.map(encodeStage);
}

export function decodeDispatchReworkPolicy(
  value: unknown,
): DispatchCandidate["reworkPolicy"] {
  return decodeReworkPolicy(value);
}

export function encodeDispatchReworkPolicy(
  value: DispatchCandidate["reworkPolicy"],
): ModelJson {
  return encodeReworkPolicy(value);
}

export function decodeDispatchFinalizationPricing(
  value: unknown,
): DispatchCandidate["finalizationPricing"] {
  return decodeFinalizationPricing(value);
}

export function encodeDispatchFinalizationPricing(
  value: DispatchCandidate["finalizationPricing"],
): ModelJson {
  return encodeFinalizationPricing(value);
}

function canonicalCandidate(candidate: DispatchCandidate): unknown {
  return {
    ticket: candidate.ticket,
    ticketVersion: candidate.ticketVersion,
    dependencies: [...candidate.dependencies],
    workFanout: candidate.workFanout,
    program: candidate.program.map((stage) => ({
      fanout: stage.fanout,
      combinator: stage.combinator,
    })),
    reworkPolicy: candidate.reworkPolicy,
    finalizationPricing: candidate.finalizationPricing,
    resumePricing: candidate.resumePricing,
    finalizer: candidate.finalizer,
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

/** Derives selection-visible truth from authoritative state and immutable contract pins. */
export function deriveDispatchCandidates(
  config: Config,
  core: Core,
  ticketVersions: ReadonlyMap<number, number>,
  contracts: ReadonlyMap<number, DispatchContractPin>,
): readonly DispatchCandidate[] {
  return ticketIds(core).flatMap((ticket) => {
    if (
      !decisionEventEnabled(config, core, { type: "Dispatch", value: ticket })
    )
      return [];
    const value = ticketAt(core, ticket);
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
        dependencies: [...value.deps].sort((left, right) => left - right),
        workFanout: value.workFanout,
        program: value.program.map((stage) => ({ ...stage })),
        reworkPolicy: value.reworkPolicy,
        finalizationPricing: value.finalizationPricing,
        resumePricing: value.resumePricing,
        finalizer: value.finalizer,
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
    value.length > selectorDecisionReferenceCharsMax ||
    !value.isWellFormed()
  )
    throw new RangeError(
      "selector decision reference is empty, malformed, or too long",
    );
  return value;
}
