/**
 * The coded values the wire sends a person, as the short labels a ledger page
 * draws them in.
 *
 * Each switch is total over the roster it speaks for, so a member the wire
 * gains stops compiling here rather than reaching a reader as an unexplained
 * word. Where a code belongs to no roster the fallback names itself as one, so
 * a reader is told the console has nothing for it.
 *
 * WHY THIS IS NOT `codeSentences.ts`. That module answers the same rosters in
 * the console's older voice, and the pages still drawing that voice read it
 * unchanged; this one is the ledger page's, where a label is a noun and a
 * status is one or two words. The two are a migration in progress and not a
 * pair to keep: when the last page leaves the sentences, the sentences go, and
 * the one path that still reaches a reader through them is kasofsk/chuggy#460.
 */

import {
  operationRefusalCodes,
  type EscalationReason,
  type OperationRefusalCode,
  type OperationState,
  type TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { ApiFailure } from "./apiRequest.ts";
import {
  mutationDeferralCodes,
  mutationRefusalCodes,
  type MutationDeferralCode,
  type MutationRefusalCode,
} from "./codeSentences.ts";
import type { OperationStep } from "./operationFollow.ts";
import type { ResumeConsequence } from "./resumePoint.ts";
import type { ClosedSet } from "./ticketLedger.ts";
import { stageLabel } from "./ticketLedger.ts";
import type { TicketActionName } from "./ticketActions.ts";

/** Which wall the ticket hit, as the noun the reader scans for. */
export function escalationReasonLabel(reason: EscalationReason): string {
  switch (reason) {
    case "WorkFailed":
      return "Work failed";
    case "ReworkBudgetExhausted":
      return "Rework budget exhausted";
    case "FinalizationBudgetExhausted":
      return "Finalization budget exhausted";
    case "GasExhausted":
      return "Out of gas";
    case "DependencyRevoked":
      return "Dependency revoked";
    case "ExecutionPolicyDenied":
      return "Execution denied by policy";
    case "TicketConfigIncompatible":
      return "Configuration incompatible";
    case "ExecutionProfileUnavailable":
      return "No matching execution profile";
    case "RuntimeVersionUnsupported":
      return "Runtime version unsupported";
    case "RequiredCapabilityUnavailable":
      return "Required capability unavailable";
  }
}

/** What the page knows about the wall, which is what the second line can name. */
export interface WallFacts {
  readonly lastSet: ClosedSet | undefined;
  readonly stageCount: number;
  readonly reworkMax: number | undefined;
  readonly finalizationMax: number | undefined;
}

function walledStageLabel(facts: WallFacts): string | undefined {
  const set = facts.lastSet;
  if (set === undefined || set.taskKind !== "Evaluation") return undefined;
  if (set.stage === undefined) return undefined;
  return stageLabel(set.stage, facts.stageCount);
}

function budgetSpentLabel(
  name: string,
  max: number | undefined,
): string | undefined {
  return max === undefined
    ? undefined
    : `${name} ${String(max)}/${String(max)} used`;
}

/** The fragments the wall's second line is joined from, dropping what is absent. */
function detailJoined(
  parts: readonly (string | undefined)[],
): string | undefined {
  const held = parts.filter((part) => part !== undefined);
  return held.length === 0 ? undefined : held.join(" · ");
}

/** The stage the wall interrupted, said as the thing that happened to it. */
function walledStageFailed(facts: WallFacts): string | undefined {
  const stage = walledStageLabel(facts);
  return stage === undefined ? undefined : `${stage} failed`;
}

/** What the interrupted set was, for the walls the fabric rather than the ticket hit. */
function interruptedLabel(facts: WallFacts): string | undefined {
  const set = facts.lastSet;
  if (set === undefined) return undefined;
  switch (set.taskKind) {
    case "Work":
      return "Work cancelled";
    case "Evaluation":
      return "Evaluation cancelled";
  }
}

/**
 * The one optional line under the wall, from the facts the page already holds.
 * It is absent where those facts are not on the page rather than guessed at.
 */
export function escalationDetailLine(
  reason: EscalationReason,
  facts: WallFacts,
): string | undefined {
  switch (reason) {
    case "WorkFailed":
      return "Failed work is not reworked";
    case "ReworkBudgetExhausted":
      return detailJoined([
        walledStageFailed(facts),
        budgetSpentLabel("Rework", facts.reworkMax),
      ]);
    case "GasExhausted":
      return walledStageFailed(facts) ?? "Finalization failed";
    case "FinalizationBudgetExhausted":
      return budgetSpentLabel("Finalization", facts.finalizationMax);
    case "DependencyRevoked":
      return "Only Revoke exits this wall";
    case "ExecutionPolicyDenied":
    case "TicketConfigIncompatible":
    case "ExecutionProfileUnavailable":
    case "RuntimeVersionUnsupported":
    case "RequiredCapabilityUnavailable":
      return interruptedLabel(facts);
  }
}

/** Where the ticket is, in the machine's own word for the phase. */
export function phaseLabel(phase: TicketPhase): string {
  switch (phase) {
    case "PublishingHandoff":
      return "Publishing";
    case "HandoffBlocked":
      return "Handoff blocked";
    case "Pending":
    case "Working":
    case "Evaluating":
    case "Finalizing":
    case "Done":
    case "Abandoned":
    case "Escalated":
    case "Revoked":
      return phase;
  }
}

/**
 * What a mutation does, what it costs, and at most one consequence that
 * matters. `offered` is false where the machine admits no such answer at all,
 * which is a wall the console must not draw a button into.
 */
export interface ActionEffect {
  readonly effect: string;
  readonly cost: string;
  readonly more?: string;
  readonly offered: boolean;
}

function resumeEffect(resume: ResumeConsequence): string {
  switch (resume.point) {
    case "ResumeWorking":
      return "Re-runs the work · new artifact";
    case "ResumeEvaluating":
      return "Re-runs evaluation from stage 1";
    case "ResumeFinalizing":
      return "Re-runs finalization";
    case "ResumePublishingHandoff":
      return "Republishes the handoff";
  }
}

/** What a rework account left over a resume looks like, which is unchanged. */
export interface ReworkStanding {
  readonly left: number;
  readonly max: number;
}

function resumeMore(
  resume: ResumeConsequence,
  rework: ReworkStanding | undefined,
): string | undefined {
  if (resume.point !== "ResumeEvaluating" || rework === undefined)
    return undefined;
  return `Keeps the current artifact · rework stays ${String(rework.left)}/${String(rework.max)}`;
}

function actionCost(charge: number): string {
  return charge > 0 ? `costs ${String(charge)} gas` : "free";
}

/** An answer the machine admits, which is every one but a resume with no point. */
function offered(effect: string, cost: string): ActionEffect {
  return { effect, cost, offered: true };
}

/**
 * What answering the action does to the ticket. A resume is priced and named by
 * the point the machine stamped, which is why it takes the consequence rather
 * than the word alone.
 */
export function ticketActionEffect(
  action: TicketActionName,
  resume: ResumeConsequence | undefined,
  rework: ReworkStanding | undefined,
): ActionEffect {
  switch (action) {
    case "Dispatch":
      return offered("Dispatches the observed version", "free");
    case "Resume": {
      if (resume === undefined)
        return {
          effect: "Nothing to resume",
          cost: "free",
          more: "only Revoke exits this wall",
          offered: false,
        };
      const more = resumeMore(resume, rework);
      return {
        effect: resumeEffect(resume),
        cost: actionCost(resume.cost),
        ...(more === undefined ? {} : { more }),
        offered: true,
      };
    }
    case "Revoke":
      return offered("Parks every dependent ticket", "free");
    case "Retry":
      return offered("Republishes the handoff", "free");
    case "Abandon":
      return offered("Abandons dependents too", "free");
    case "Approve":
      return offered("Lets finalization proceed", "free");
    case "Decline":
      return offered("Holds finalization back", "free");
  }
}

/** What the actor did with the submission, before any refusal code refines it. */
export function operationStateLabel(state: OperationState): string {
  switch (state) {
    case "Pending":
      return "Pending";
    case "Succeeded":
      return "Accepted";
    case "Refused":
      return "Refused";
    case "Answered":
      return "Answered";
    case "Cancelled":
      return "Cancelled";
  }
}

/** Why the actor declined the mutation, as the fragment that goes after it. */
export function operationRefusalLabel(code: OperationRefusalCode): string {
  switch (code) {
    case "NotEnabled":
      return "Not allowed in this phase";
    case "AuthoringChanged":
      return "Authoring changed";
    case "ConfigurationInvalid":
      return "Configuration not runnable";
    case "TicketChanged":
      return "Ticket changed";
    case "SelectionChanged":
      return "Dispatch selection changed";
    case "CommandUnreadable":
      return "Command unreadable";
    case "ExecutionSourceUnreadable":
      return "Source ref not on remote";
    case "ExecutionSourceDenied":
      return "Remote refused credentials";
  }
}

/** Why the boundary would not carry the request to the actor at all. */
export function mutationRefusalLabel(code: MutationRefusalCode): string {
  switch (code) {
    case "IdempotencyConflict":
      return "Key already used";
    case "InvalidMutation":
      return "Invalid mutation";
    case "MutationNotAdmitted":
      return "Not admitted right now";
    case "OperationNotPending":
      return "Already decided";
  }
}

function mutationDeferralCodeOf(
  code: string,
): MutationDeferralCode | undefined {
  return mutationDeferralCodes.find((known) => known === code);
}

/** Why the boundary asked for the same request again, each meaning try later. */
export function mutationDeferralLabel(code: string): string {
  switch (mutationDeferralCodeOf(code)) {
    case "DispatchBacklog":
      return "Dispatch backlog";
    case "MailboxBackpressure":
      return "Actor mailbox full";
    case "MailboxUnavailable":
      return "Actor unreachable";
    case undefined:
      return `Deferred (${code})`;
  }
}

function operationRefusalCodeOf(
  code: string,
): OperationRefusalCode | undefined {
  return operationRefusalCodes.find((known) => known === code);
}

function mutationRefusalCodeOf(code: string): MutationRefusalCode | undefined {
  return mutationRefusalCodes.find((known) => known === code);
}

/** What went wrong, named thing first and cause second, as fragments. */
export function operationFailureLabel(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Unauthenticated":
      return "Not signed in";
    case "Absent":
      return "Operation not found";
    case "Retryable":
      return `Kept deferring · ${mutationDeferralLabel(failure.code)}`;
    case "Unreachable":
      return `API unreachable · ${failure.reason}`;
    case "Unreadable":
      return `Unreadable response · ${failure.reason}`;
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const refusal = operationRefusalCodeOf(failure.code);
      if (refusal !== undefined) return operationRefusalLabel(refusal);
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalLabel(declined);
      return `Refused (${failure.code})`;
    }
  }
}

/** How far a submission has got, and whether that is a state to stop on. */
export interface StepLabel {
  readonly text: string;
  readonly settled: boolean;
  readonly wrong: boolean;
}

/**
 * Every step a follow passes through, as the one line the page draws for it.
 * The settled line names the action, because by then the button it came from
 * may no longer be on screen.
 */
export function operationStepLabel(
  step: OperationStep,
  action: TicketActionName,
): StepLabel {
  switch (step.step) {
    case "Submitting":
      return { text: "Submitting…", settled: false, wrong: false };
    case "Backlogged":
      return {
        text: `${mutationDeferralLabel(step.code)} · retry in ${String(step.retryAfterSeconds)}s`,
        settled: false,
        wrong: false,
      };
    case "Following":
      return { text: "Waiting for actor…", settled: false, wrong: false };
    case "Confirming":
      return {
        text: `Syncing to seq ${String(step.minimumSequence)}…`,
        settled: false,
        wrong: false,
      };
    case "Settled": {
      const state = operationStateLabel(step.state);
      const refusal =
        step.refusalCode === undefined
          ? ""
          : ` · ${operationRefusalLabel(step.refusalCode)}`;
      return {
        text: `${action} ${state.toLowerCase()}${refusal}`,
        settled: true,
        wrong: step.state !== "Succeeded",
      };
    }
    case "Abandoned":
      return { text: step.reason, settled: true, wrong: true };
  }
}
