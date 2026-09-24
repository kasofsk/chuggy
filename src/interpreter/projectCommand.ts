/**
 * The command envelopes a project operation carries, and the ticket commands
 * no principal may offer inside one.
 *
 * AN ENVELOPE IS NOT A TICKET COMMAND. `ProjectCommand` is what a principal
 * submits and the inbox stores; the `TicketCommand` the writer hands `decide`
 * (`src/actor/command.ts`) is built from an envelope and the rows it names by
 * `./commandMap.ts`, and only a `Decide` carries one outright.
 *
 * `ReportFinalizationResult` IS NOT A PUBLIC TICKET COMMAND. Only the
 * finalizer service may conclude a finalizing ticket, so the command is
 * excluded from `OperationTicketCommand` and the finalizer's own envelope is
 * excluded from `ProjectCommand` — a `Decide` carrying one and a submission
 * offering one are both unspellable rather than merely refused. `CreateTicket`
 * has been kept out this way since I3, and this is the same device at a second
 * seam.
 *
 * `DispatchTicket` IS THE FOURTH SEAM, AND IT IS THE SOURCE THAT CLOSES IT. A
 * dispatch carries the commit its work is observed at, and nobody outside the
 * writer observes one: a principal offering the command would be authoring the
 * source, and a source the world did not answer with is a ticket whose work
 * runs at a commit nobody read. So a dispatch is asked for by
 * `ManualDispatch` and `ProposeDispatch`, which name a ticket and no source,
 * and the command itself is unspellable in a `Decide`.
 *
 * `ReportTaskTerminal` IS THE THIRD SEAM. Only the execution scheduler settles
 * a logical task, and settling one is not a decision a principal holding
 * `Mutate` may offer: a forged completion would conclude work that never ran,
 * or mark an evaluator stopped that no infrastructure refused. So it leaves
 * `OperationTicketCommand` for the same reason the finalizer's command did,
 * and `SchedulerCompletion` below is the envelope the scheduler's own boundary
 * writes. It arrives at a writer through `parseStoredProjectCommand` and never
 * through the ingress parser, which is what makes the exclusion a shape rather
 * than a check that could be skipped.
 *
 * `UpdateTicket` IS KEPT OUT FOR `CreateTicket`'S REASON. Its definition is
 * what a release resolves from the draft and the configuration revision the
 * draft pins, which no principal authors; the `UpdateTicket` envelope names
 * that draft revision and the ticket revision it was written against, and the
 * writer resolves the definition as the first release does.
 */

import type { TicketCommand } from "../actor/command.ts";
import type { FinalizationUnavailableKind } from "../contract/rosters.ts";
import type { FinalizationResult } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type { DispatchViewToken } from "./dispatchView.ts";

export type OperationTicketCommand = Exclude<
  TicketCommand,
  {
    readonly type:
      | "CreateTicket"
      | "UpdateTicket"
      | "ReportFinalizationResult"
      | "ReportTaskTerminal"
      | "DispatchTicket";
  }
>;

/** The one ticket command only the execution scheduler's own boundary submits. */
export type CompletionTicketCommand = Extract<
  TicketCommand,
  { readonly type: "ReportTaskTerminal" }
>;

/** Every ticket command a `Decide` envelope may carry that no principal may offer. */
export const completionCommandTypes = [
  "ReportTaskTerminal",
] as const satisfies readonly CompletionTicketCommand["type"][];

/** Whether one ticket command is a completion the scheduler alone may submit. */
export function isCompletionTicketCommand(
  command: TicketCommand,
): command is CompletionTicketCommand {
  return completionCommandTypes.some((type) => type === command.type);
}

/**
 * What each kind of native action asks a person for, and the answers it admits.
 * The pairing is the roster this layer, the command grammar and the database
 * constraint all read, so none of them can offer an answer another would refuse.
 */
export const nativeActionResolutions = {
  TicketEscalation: ["Resume", "Revoke"],
  FinalizationApproval: ["Approve", "Decline"],
} as const;

/** The kinds of question a native action puts to a person. */
export type NativeActionKind = keyof typeof nativeActionResolutions;

/** Every action kind, so a suite and a database CHECK iterate rather than restate. */
export const allNativeActionKinds = Object.keys(
  nativeActionResolutions,
) as readonly NativeActionKind[];

/** The two answers an escalation admits, each of which names a ticket command. */
export type EscalationResolution =
  (typeof nativeActionResolutions)["TicketEscalation"][number];

/**
 * The two answers a finalization approval admits, and the only resolutions that
 * name no ticket command at all. Answering one settles its operation and
 * journals nothing, because approval is operational protocol and not `TicketGraph` state.
 */
export type ApprovalResolution =
  (typeof nativeActionResolutions)["FinalizationApproval"][number];

export type NativeActionResolution = EscalationResolution | ApprovalResolution;

/** Every resolution, so a suite and a database CHECK iterate rather than restate. */
export const allNativeActionResolutions: readonly NativeActionResolution[] =
  allNativeActionKinds.flatMap((kind) => [...nativeActionResolutions[kind]]);

/**
 * The one answer that reduces outstanding correctness risk rather than adding
 * any, which is why acceptance admits it into a project no other answer may
 * enter and takes it ahead of everything else.
 */
export const safetyResolution: NativeActionResolution = "Revoke";

/** Whether an answer is one of the two that name no ticket command. */
export function isApprovalResolution(
  resolution: NativeActionResolution,
): resolution is ApprovalResolution {
  return nativeActionResolutions.FinalizationApproval.some(
    (each) => each === resolution,
  );
}

export function asOperationTicketCommand(
  command: TicketCommand,
): OperationTicketCommand {
  if (
    command.type === "CreateTicket" ||
    command.type === "UpdateTicket" ||
    command.type === "ReportFinalizationResult" ||
    command.type === "DispatchTicket" ||
    isCompletionTicketCommand(command)
  ) {
    throw new RangeError("command is not a public ticket command");
  }
  return command;
}

export type ProjectCommand =
  | {
      readonly version: 1;
      readonly command: "Decide";
      readonly ticketCommand: OperationTicketCommand;
    }
  | {
      readonly version: 1;
      readonly command: "ResolveNativeAction";
      readonly action: string;
      readonly authorizingSeq: number;
      readonly resolution: NativeActionResolution;
    }
  | {
      readonly version: 1;
      readonly command: "ReleaseDraft";
      readonly ticket: TicketId;
      readonly authoringVersion: number;
      readonly configurationRevision: string;
    }
  | {
      readonly version: 1;
      readonly command: "UpdateTicket";
      readonly ticket: TicketId;
      /** The ticket revision the author read, which `decide` refuses once it has moved. */
      readonly expectedRevision: number;
      readonly authoringVersion: number;
      readonly configurationRevision: string;
    }
  | {
      readonly version: 1;
      readonly command: "ManualDispatch";
      readonly ticket: TicketId;
      readonly expectedTicketVersion: number;
    }
  | {
      readonly version: 1;
      readonly command: "ProposeDispatch";
      readonly ticket: TicketId;
      readonly expectedTicketVersion: number;
      readonly observedViewToken: DispatchViewToken;
      readonly selectorDecisionReference: string;
    };

/** Which way a finalizer's pass concluded, as its submission names it: a finalization result's arm. */
export type FinalizationOutcome = FinalizationResult["type"];

/**
 * The finalizer's own submission, which its authenticated boundary builds from
 * durable rows. It names the request it answers, the request generation and the
 * epoch it was made under, and the attempt it concluded on except where none
 * was prepared — a brief that lands nothing, or a finalization that reached no
 * result at all — so a writer can fence it and find its evidence before
 * constructing a command.
 */
export interface FinalizationSubmission {
  readonly version: 1;
  readonly command: "SubmitFinalizationResult";
  readonly request: string;
  readonly attempt?: string;
  readonly requestGeneration: number;
  readonly recoveryEpoch: string;
  readonly outcome: FinalizationOutcome;
  /**
   * Which hold the pass could not get past, carried exactly when the outcome is
   * the one it explains. The command the writer decides names the outcome
   * alone, so this is the evidence the escalation records and the only account
   * of it that leaves the boundary.
   */
  readonly kind?: FinalizationUnavailableKind;
}

/**
 * The execution scheduler's own submission, which only a writer reading its
 * inbox reads: the report `submit_task_completion` built from the durable
 * execution, attempt and result rows it had already locked — the settled fact
 * itself rather than a binding a writer would resolve a second time, which is
 * the one way this envelope differs from the finalizer's above. Which edge a
 * failed stage is taken on is not here: that is this deployment's rework cap
 * over the replayed ticket, which the writer hands `decide` as its policy and
 * the boundary holds neither half of.
 */
export interface SchedulerCompletion {
  readonly version: 1;
  readonly command: "Decide";
  readonly ticketCommand: CompletionTicketCommand;
}

/** What a stored operation may carry: a public command, or one of the two envelopes only a boundary writes. */
export type StoredProjectCommand =
  ProjectCommand | FinalizationSubmission | SchedulerCompletion;

/**
 * Whether a stored envelope is the scheduler's completion, which its command's
 * tag decides on its own: no public `Decide` may carry one, so a `Decide` that
 * does was written by the boundary.
 */
export function isSchedulerCompletion(
  command: StoredProjectCommand,
): command is SchedulerCompletion {
  return (
    command.command === "Decide" &&
    isCompletionTicketCommand(command.ticketCommand)
  );
}
