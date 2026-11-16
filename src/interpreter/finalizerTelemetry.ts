/**
 * What the finalizer reports about itself, and why nothing it reports can
 * change what it does.
 *
 * TELEMETRY IS NEVER AN AUTHORITY. Every observation answers `void`, so there
 * is no value a branch could read; the sink is held behind a symbol this module
 * does not export, so no caller can take it back out and ask it a question; and
 * `recordFinalizer` runs the observation through `observe`, so a sink that
 * fails cannot fail the move that observed it. The scheduler's sealed sink is
 * the same device for the same reason.
 *
 * A HOLD IS REPORTED WITH ITS REASON. A pass report counts the finalizations
 * left exactly where they were found and cannot say why any one of them was, so
 * a refused permit grant, a storage outage and a decided hold would otherwise be
 * one opaque number. `FinalizerHoldReason` is the closed set every site counting
 * a hold emits alongside it, which is what keeps the count and the reasons in
 * agreement.
 *
 * THREE OBSERVATIONS NAME THEIR REQUEST, AND NONE NAMES ANYTHING ELSE. Every
 * other observation is closed and identifier-free; `advanced` carries the
 * request one advance was about beside the hold it was left at, and
 * `forgeAnswered` and `holdRecorded` carry its ticket and request beside what
 * the forge answered one act or the hold a pass recorded, because a request
 * held on every pass is one an operator has to be able to find. A ticket's
 * number and a request's identity are neither ticket text nor a credential,
 * and a forge's reply is the adapter's, which keeps every credential out of it.
 */

import type {
  CandidateIntegrated,
  CandidatePromoted,
  CommitPermitState,
  FinalizationAttemptOutcome,
  FinalizationFailureKind,
  FinalizationHoldKind,
  FinalizationSubmitted,
  ReconciliationVerdict,
} from "./finalizer.ts";
import type { FinalizationUnavailableKind } from "../contract/rosters.ts";
import type {
  ChangeProposalForgeReply,
  ChangeProposalPort,
} from "./changeProposal.ts";
import type { FinalizationOutcome } from "./projectCommand.ts";
import { observe } from "./ticketService.ts";

/** Which sweep gave a claim back, both of which a pass runs before it draws work. */
export type FinalizerReopenScope = "Epoch" | "Lapsed";

/** Every reopen scope, so a suite iterates rather than restates. */
export const allFinalizerReopenScopes: readonly FinalizerReopenScope[] = [
  "Epoch",
  "Lapsed",
];

/**
 * Why one finalization was left exactly where it was found. The decided holds
 * are the pure pass's own kinds; the rest are the operational answers a port or
 * a durable move gave, none of which is evidence about a ticket.
 */
export type FinalizerHoldReason =
  | FinalizationHoldKind
  | "NoPassedWork"
  | "HandoffUnavailable"
  | "ManifestUnavailable"
  | "TargetUnobserved"
  | "CandidateUnbuilt"
  | "IntegrationUnanswered"
  | "AttemptFenced"
  | "PermitRefused"
  | "PassCeilingReached"
  | "ReconciliationUnrecorded"
  | "ProposalUnattempted"
  | "ProposalUnrecorded"
  | "ProposalUnbranched";

/** One act the finalizer asked a forge of a proposal, named as the port names it. */
export type FinalizerForgeAct = keyof ChangeProposalPort;

/** What one forge act came to: the arm it mapped to, and the forge's reply where it sent anything. */
export interface FinalizerForgeAnswered {
  readonly ticket: number;
  readonly request: string;
  readonly act: FinalizerForgeAct;
  readonly outcome: string;
  readonly reply?: ChangeProposalForgeReply;
}

/** One hold a pass recorded on its request, and whether recording it escalated the request. */
export interface FinalizerHoldRecorded {
  readonly ticket: number;
  readonly request: string;
  readonly kind: FinalizationUnavailableKind;
  readonly passes: number;
  readonly escalated: boolean;
}

/** The finalizer's observations, `advanced`, `forgeAnswered` and `holdRecorded` the ones naming their request. */
export interface FinalizerMetrics {
  claiming(claims: number, ceiling: number): void;
  reopening(scope: FinalizerReopenScope, requests: number): void;
  preparation(restartsSpent: number): void;
  integration(outcome: CandidateIntegrated["integrated"]): void;
  attempt(
    outcome: FinalizationAttemptOutcome,
    failure?: FinalizationFailureKind,
  ): void;
  permit(state: CommitPermitState): void;
  promotion(arm: CandidatePromoted["promoted"]): void;
  reconciliation(verdict: ReconciliationVerdict): void;
  conclusion(
    outcome: FinalizationOutcome,
    submitted: FinalizationSubmitted["submitted"],
  ): void;
  holding(reason: FinalizerHoldReason): void;
  advanced(request: string, held: FinalizerHoldReason | undefined): void;
  forgeAnswered(answered: FinalizerForgeAnswered): void;
  holdRecorded(recorded: FinalizerHoldRecorded): void;
}

/** Emits nothing, which is what a caller that supplies no telemetry gets. */
export const silentFinalizerMetrics: FinalizerMetrics = {
  claiming: () => undefined,
  reopening: () => undefined,
  preparation: () => undefined,
  integration: () => undefined,
  attempt: () => undefined,
  permit: () => undefined,
  promotion: () => undefined,
  reconciliation: () => undefined,
  conclusion: () => undefined,
  holding: () => undefined,
  advanced: () => undefined,
  forgeAnswered: () => undefined,
  holdRecorded: () => undefined,
};

/**
 * The key a sealed sink is held under. It is not exported, so no module but
 * this one can read a sink back out of the value below or build one of its own.
 */
const finalizerSink: unique symbol = Symbol("chuggy:finalizer-telemetry");

/** A sink the finalizer may write to and cannot read, gate on, or be interrupted by. */
export interface FinalizerTelemetry {
  readonly [finalizerSink]: FinalizerMetrics;
}

/** Seals a deployment's sink, which is the only way one enters the finalizer. */
export function finalizerTelemetry(
  metrics: FinalizerMetrics,
): FinalizerTelemetry {
  return { [finalizerSink]: metrics };
}

/**
 * Records one observation. It answers nothing and raises nothing, so nothing a
 * sink does can reach the move that observed it.
 */
export function recordFinalizer(
  telemetry: FinalizerTelemetry,
  observation: (metrics: FinalizerMetrics) => void,
): void {
  observe(() => {
    observation(telemetry[finalizerSink]);
  });
}

/** The sealed sink a caller that supplies no telemetry gets. */
export const silentFinalizerTelemetry: FinalizerTelemetry = finalizerTelemetry(
  silentFinalizerMetrics,
);

/** The most requests a hold log remembers, and the bound it is built under where none is named. */
export const finalizerHoldLogRequestsMax = 1_024;

/** What a hold log remembers of one request: where its advances have been left, how many in a row, and at which count it writes next. */
interface FinalizerHoldLogged {
  readonly reason: FinalizerHoldReason;
  readonly advances: number;
  readonly writesAt: number;
}

/**
 * A sink that writes a line for a request held where it was found, on the
 * first advance of a run held at one reason and again each time that run
 * doubles, and nothing for any other observation. A request moved, held
 * somewhere else, or forgotten as the longest remembered once the bound on
 * requests is reached starts its run again.
 */
export function finalizerHoldLog(
  write: (line: string) => void,
  requestsMax: number = finalizerHoldLogRequestsMax,
): FinalizerTelemetry {
  return finalizerTelemetry(finalizerHoldLogMetrics(write, requestsMax));
}

/** The observations a hold log is, which a process log extends. */
function finalizerHoldLogMetrics(
  write: (line: string) => void,
  requestsMax: number,
): FinalizerMetrics {
  if (!Number.isSafeInteger(requestsMax) || requestsMax < 1) {
    throw new RangeError("finalizer hold log: requestsMax must be positive");
  }
  const logged = new Map<string, FinalizerHoldLogged>();
  return {
    ...silentFinalizerMetrics,
    advanced: (request, held) => {
      const prior = logged.get(request);
      logged.delete(request);
      if (held === undefined) return;
      const run = prior?.reason === held ? prior : { advances: 0, writesAt: 1 };
      const advances = run.advances + 1;
      const writes = advances === run.writesAt;
      if (logged.size >= requestsMax) {
        const first = logged.keys().next();
        if (first.done !== true) logged.delete(first.value);
      }
      logged.set(request, {
        reason: held,
        advances,
        writesAt: writes ? run.writesAt * 2 : run.writesAt,
      });
      if (writes) {
        write(
          `finalizer: request ${JSON.stringify(request)} held at ${held}, ${String(advances)} advances in a row\n`,
        );
      }
    },
  };
}

/** The fields of one forge reply a line carries, flat beside the act's own. */
function finalizerProcessLogReplyFields(
  reply: ChangeProposalForgeReply | undefined,
): Record<string, string | number | boolean> {
  if (reply === undefined) return {};
  return reply.reached === "Unreached"
    ? { failure: reply.failure }
    : {
        status: reply.status,
        ...(reply.message === undefined ? {} : { message: reply.message }),
        ...(reply.messageCut === true ? { messageCut: true } : {}),
      };
}

/**
 * The finalizer process's own log: the hold log's lines, and one JSON object
 * per line for every forge act a pass made and every hold it recorded or
 * escalated, each naming its ticket and request.
 */
export function finalizerProcessLog(
  write: (line: string) => void,
  requestsMax: number = finalizerHoldLogRequestsMax,
): FinalizerTelemetry {
  const line = (fields: Record<string, unknown>): void => {
    write(`${JSON.stringify(fields)}\n`);
  };
  return finalizerTelemetry({
    ...finalizerHoldLogMetrics(write, requestsMax),
    forgeAnswered: (answered) => {
      line({
        finalizer: "forgeAct",
        ticket: answered.ticket,
        request: answered.request,
        act: answered.act,
        outcome: answered.outcome,
        ...finalizerProcessLogReplyFields(answered.reply),
      });
    },
    holdRecorded: (recorded) => {
      line({
        finalizer: "hold",
        ticket: recorded.ticket,
        request: recorded.request,
        hold: recorded.kind,
        passes: recorded.passes,
        escalated: recorded.escalated,
      });
    },
  });
}
