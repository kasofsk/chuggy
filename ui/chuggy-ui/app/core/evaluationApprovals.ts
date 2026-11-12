/**
 * A ticket's open evaluation approvals as the places that answer them draw
 * them: which step of which cycle each one judges, what its workload tells the
 * approver to look at, who may answer it, and the runs it stands beside.
 *
 * EACH QUESTION IS NAMED BY ITS OWN STEP. A ticket can hold several open
 * actions, and an approval can sit in a stage beside evaluators still running,
 * so every approval is named by its stage, and by its evaluator's key where its
 * stage holds more than one, which is the name its own row in the Runs tab has,
 * or where another open approval would otherwise read the same.
 */

import type { ApprovalRole } from "../../../../src/contract/rosters.ts";
import type {
  ExecutionResponse,
  NativeActionResponse,
} from "../../../../src/contract/responses.ts";
import { copyOrDataText } from "./copy.ts";
import type { Copy, CopyText } from "./copy.ts";
import { nativeActionAnswers } from "./nativeActionAnswers.ts";
import type { TicketAction } from "./ticketActions.ts";
import { stageEvaluatorsCurrent, stageLabel } from "./ticketLedger.ts";
import type { Ledger, StageNames } from "./ticketLedger.ts";

type ApprovalAsks = NonNullable<NativeActionResponse["approval"]>;

/** Who may answer an approval: everyone holding a role, or the people it lists. */
export type ApprovalApprovers =
  | { readonly by: "Role"; readonly role: Copy }
  | { readonly by: "People"; readonly people: readonly string[] };

/** One open evaluation approval, as the page draws its question. */
export interface ApprovalAsked {
  readonly action: string;
  /** What the reader may answer it with, which is nothing where it does not ask them. */
  readonly answers: readonly TicketAction[];
  readonly step: string;
  readonly cycle: number;
  readonly instructions: string | undefined;
  readonly approvers: ApprovalApprovers;
  /** The approval's own run, by its task's number, where the page holds it. */
  readonly run: number | undefined;
  /** The work run of the cycle it judges, whose result and artifacts are what it judges. */
  readonly work: number | undefined;
}

function approvalRoleLabel(role: ApprovalRole): Copy {
  switch (role) {
    case "Developer":
      return { id: "ticket-approval-approvers-developer" };
    case "Admin":
      return { id: "ticket-approval-approvers-admin" };
  }
}

export function approvalApproversOf(
  approvers: ApprovalAsks["approvers"],
): ApprovalApprovers {
  return typeof approvers === "string"
    ? { by: "Role", role: approvalRoleLabel(approvers) }
    : { by: "People", people: approvers };
}

/** The approval's step as its row in the Runs tab names it. */
function approvalStepName(
  asks: ApprovalAsks,
  ledger: Ledger | undefined,
  names: StageNames,
  text: CopyText,
): string {
  const name = copyOrDataText(text, stageLabel(asks.stage, names));
  const stage = ledger?.cycles
    .find((cycle) => cycle.ordinal === asks.workCycle)
    ?.stages.find((row) => row.kind === "Ran" && row.stage === asks.stage);
  const many =
    stage?.kind === "Ran" && stageEvaluatorsCurrent(stage).length > 1;
  return many ? `${name} · ${String(asks.evaluator)}` : name;
}

function approvalRuns(
  asks: ApprovalAsks,
  ledger: Ledger | undefined,
): { readonly run: number | undefined; readonly work: number | undefined } {
  const cycle = ledger?.cycles.find((held) => held.ordinal === asks.workCycle);
  const run = cycle?.stages
    .flatMap((row) => (row.kind === "Ran" ? row.evaluators : []))
    .flatMap((row) => row.set.executions)
    .find((execution) => execution.execution === asks.execution)?.task;
  return { run, work: cycle?.work?.executions.at(-1)?.task };
}

/** Every open evaluation approval among a ticket's open actions, in the order the read listed them. */
export function evaluationApprovalsAsked(
  open: readonly NativeActionResponse[],
  ledger: Ledger | undefined,
  names: StageNames,
  text: CopyText,
): readonly ApprovalAsked[] {
  const asked = open.flatMap((action) => {
    const asks = action.approval;
    if (action.kind !== "EvaluationApproval" || asks === undefined) return [];
    return [
      {
        asks,
        approval: {
          action: action.action,
          answers: nativeActionAnswers(action),
          step: approvalStepName(asks, ledger, names, text),
          cycle: asks.workCycle,
          instructions: asks.instructions,
          approvers: approvalApproversOf(asks.approvers),
          ...approvalRuns(asks, ledger),
        },
      },
    ];
  });
  return asked.map(({ asks, approval }) =>
    asked.some(
      (other) =>
        other.approval !== approval &&
        other.approval.step === approval.step &&
        other.approval.cycle === approval.cycle,
    )
      ? { ...approval, step: `${approval.step} · ${String(asks.evaluator)}` }
      : approval,
  );
}

/** Whether any of a ticket's open approvals asks this reader. */
export function evaluationApprovalsAnswerable(
  asked: readonly ApprovalAsked[],
): boolean {
  return asked.some((approval) => approval.answers.length > 0);
}

/** Who answered an approval and how, as the line its row and its page lead
 * with, and nothing for a run no person answered. */
export function approvalAnsweredLine(
  read: ExecutionResponse,
): Copy | undefined {
  const answered = read.result?.approval;
  if (answered === undefined) return undefined;
  switch (answered.resolution) {
    case "Approve":
      return { id: "ticket-approval-approved-by" };
    case "Reject":
      return { id: "ticket-approval-rejected-by" };
  }
}
