import type { TicketId } from "../domain/chuggernaut/task.js";
import type { Lease, Partition } from "./projectStore.ts";
import type {
  TicketMachineInput,
  TicketMachineOutcome,
  TicketMachineReleaseMetadata,
} from "./ticketMachine.ts";

export type TicketMachineAdmissionRefusal =
  | "InputConflict"
  | "LegacyModelUnsupported"
  | "ProjectNotFound"
  | "ProjectNotActive"
  | "Backpressure";
export type TicketMachineAccepted = {
  readonly accepted:
    "Accepted" | "AlreadyAccepted" | TicketMachineAdmissionRefusal;
};
export type TicketMachineReserved =
  | { readonly reserved: "Reserved"; readonly ticket: TicketId }
  | { readonly reserved: TicketMachineAdmissionRefusal };

export interface TicketMachineInbox {
  submit(
    partition: Partition,
    input: TicketMachineInput,
  ): Promise<TicketMachineAccepted>;
  outcome(
    partition: Partition,
    identity: string,
  ): Promise<TicketMachineOutcome | undefined>;
  reserveTicket(
    partition: Partition,
    identity: string,
  ): Promise<TicketMachineReserved>;
  releaseMetadata(
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketMachineReleaseMetadata | undefined>;
  /**
   * Every released ticket's frozen rework limit, for a reader asking about a
   * whole project. Null is the domain's own unbounded policy, which is also
   * what a ticket with no release row runs under, so a ticket absent here and
   * a ticket here with null are the same thing to the machine.
   */
  releaseReworkLimits(
    partition: Partition,
  ): Promise<ReadonlyMap<TicketId, number | null>>;
}

export interface TicketMachineQueue {
  ready(limit: number, after?: Partition): Promise<readonly Partition[]>;
  next(lease: Lease): Promise<TicketMachineInput | undefined>;
}
