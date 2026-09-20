import * as ticket from "../domain/chuggernaut/ticket.js";
import type { TaskId, TicketId } from "../domain/chuggernaut/task.js";
import { assertNever } from "../domain/assertNever.ts";
import type { Lease, Partition } from "./projectStore.ts";

export const ticketMachineModel = "Chuggernaut" as const;
export type TicketMachineOrigin = "Author" | "Execution" | "Finalizer";

export interface TicketMachineAuthorization {
  readonly principal: string;
  readonly authorizedOperation: string;
  readonly authorityKind: string;
  readonly authoritySubject: string;
  readonly policyRevision: string;
}

export interface TicketMachineReleaseMetadata {
  readonly stageNames: readonly (readonly [number, string])[];
  readonly evaluatorNames: readonly (readonly [number, string])[];
  readonly reworkLimit: number | null;
  /** The content holding the authored YAML, absent for a release recorded before it was retained. */
  readonly source?: number | undefined;
}

export interface TicketMachineInput {
  readonly identity: string;
  readonly origin: TicketMachineOrigin;
  readonly command: ticket.TicketCommand;
  readonly authorization: TicketMachineAuthorization;
  readonly metadata?: TicketMachineReleaseMetadata;
}

export interface TicketMachineOutcome {
  readonly sequence: number;
  readonly decision: ticket.TicketDecision;
}

export type TicketMachineProcessed =
  | {
      readonly processed: "Committed" | "AlreadyCommitted";
      readonly outcome: TicketMachineOutcome;
    }
  | {
      readonly processed:
        | "LegacyModelUnsupported"
        | "ProjectNotFound"
        | "ProjectNotActive"
        | "Fenced"
        | "InputNotAccepted"
        | "NotNext"
        | "InputConflict";
    };

export interface TicketMachineDelivery {
  readonly identity: string;
  readonly sequence: number;
  readonly position: number;
  readonly obligation: ticket.Obligation;
}

/** The store serializes the callback and commits its event and obligations atomically. */
export interface TicketMachineStore {
  process(
    lease: Lease,
    input: TicketMachineInput,
    decide: (graph: ticket.TicketGraph) => ticket.TicketDecision,
  ): Promise<TicketMachineProcessed>;
  read(
    partition: Partition,
  ): Promise<ticket.TicketGraph | "LegacyModelUnsupported" | undefined>;
  pending(
    partition: Partition,
    limit: number,
  ): Promise<readonly TicketMachineDelivery[]>;
  delivered(partition: Partition, identity: string): Promise<void>;
}

/** Delivery identity is stable across retries; the receiving adapter must deduplicate it. */
export interface TicketMachineEffects {
  execute(
    partition: Partition,
    identity: string,
    obligation: ticket.ExecuteTask,
  ): Promise<boolean>;
  cancel(
    partition: Partition,
    identity: string,
    obligation: ticket.CancelTask,
  ): Promise<boolean>;
  finalize(
    partition: Partition,
    identity: string,
    obligation: ticket.FinalizeTicket,
  ): Promise<boolean>;
}

export function ticketMachineTaskKey(task: TaskId): string {
  switch (task.kind) {
    case "WorkTaskId":
      return `work:${String(task.ticket)}:${String(task.cycle)}`;
    case "EvaluationTaskId":
      return `evaluation:${String(task.ticket)}:${String(task.work_cycle)}:${String(task.stage)}:${String(task.generation)}:${String(task.evaluator)}`;
    default:
      return assertNever(task);
  }
}

/**
 * The ticket an event moved: every event but a creation names it directly, and a
 * creation names the definition it was allocated on. Narrowing on that one
 * exception is what makes an event kind arriving without a `ticket` a compile
 * error here rather than a move nothing publishes.
 */
export function ticketMachineEventTicket(event: ticket.TicketEvent): TicketId {
  return event.kind === "TicketCreated" ? event.definition.id : event.ticket;
}

/**
 * Where `ticketMachineTaskKey` starts for one ticket, one prefix per task kind,
 * so a reader asking about that ticket matches on the key it already stores.
 * A kind added above without a prefix here is a kind such a reader would miss.
 */
export function ticketMachineTaskKeyPrefixes(
  ticket: TicketId,
): readonly string[] {
  return [`work:${String(ticket)}:`, `evaluation:${String(ticket)}:`];
}

export function ticketMachineOrigin(
  command: ticket.TicketCommand,
): TicketMachineOrigin {
  switch (command.kind) {
    case "CreateTicket":
    case "UpdateTicket":
    case "DispatchTicket":
    case "RevokeTicket":
    case "ResumeTicket":
      return "Author";
    case "ReportTaskTerminal":
      return "Execution";
    case "ReportFinalizationResult":
      return "Finalizer";
    default:
      return assertNever(command);
  }
}

export async function ticketMachineProcess(
  store: TicketMachineStore,
  lease: Lease,
  input: TicketMachineInput,
  policy: ticket.EvaluationFailurePolicy,
): Promise<TicketMachineProcessed> {
  if (input.identity.length === 0 || input.identity.length > 256) {
    throw new RangeError("ticket input identity must be nonempty and bounded");
  }
  if (ticketMachineOrigin(input.command) !== input.origin) {
    throw new RangeError("ticket command cannot be submitted by this origin");
  }
  ticket.validate_command(input.command);
  return store.process(lease, input, (graph) => {
    const decision = ticket.decide(graph, input.command, policy);
    if (!ticket.decision_valid(graph, decision)) {
      throw new Error("ticket decision violates the adopted model");
    }
    return decision;
  });
}

function ticketMachineDeliverOne(
  effects: TicketMachineEffects,
  partition: Partition,
  delivery: TicketMachineDelivery,
): Promise<boolean> {
  const { identity, obligation } = delivery;
  switch (obligation.kind) {
    case "ExecuteTask":
      return effects.execute(partition, identity, obligation);
    case "CancelTask":
      return effects.cancel(partition, identity, obligation);
    case "FinalizeTicket":
      return effects.finalize(partition, identity, obligation);
    default:
      return assertNever(obligation);
  }
}

export async function ticketMachineDeliver(
  store: TicketMachineStore,
  effects: TicketMachineEffects,
  partition: Partition,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("ticket delivery limit is outside its bounds");
  }
  const pending = await store.pending(partition, limit);
  if (pending.length > limit)
    throw new Error("ticket store exceeded delivery limit");
  let delivered = 0;
  for (const delivery of pending) {
    if (!(await ticketMachineDeliverOne(effects, partition, delivery))) break;
    await store.delivered(partition, delivery.identity);
    delivered += 1;
  }
  return delivered;
}
