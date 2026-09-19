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
}

export interface TicketMachineQueue {
  ready(limit: number, after?: Partition): Promise<readonly Partition[]>;
  next(lease: Lease): Promise<TicketMachineInput | undefined>;
}
