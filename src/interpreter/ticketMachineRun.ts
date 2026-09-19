import * as ticket from "../domain/chuggernaut/ticket.js";
import type { TicketId } from "../domain/chuggernaut/task.js";
import type {
  ProjectStore,
  OwnerId,
  Partition,
  Lease,
} from "./projectStore.ts";
import {
  ticketMachineProcess,
  ticketMachineDeliver,
  type TicketMachineStore,
  type TicketMachineEffects,
} from "./ticketMachine.ts";
import type {
  TicketMachineInbox,
  TicketMachineQueue,
} from "./ticketMachineInbox.ts";

export interface TicketMachineRuntime {
  readonly projects: ProjectStore;
  readonly store: TicketMachineStore;
  readonly inbox: TicketMachineInbox;
  readonly queue: TicketMachineQueue;
  readonly effects: TicketMachineEffects;
  readonly owner: OwnerId;
}

export interface TicketMachineRunConfig {
  readonly projectsPerPassMax: number;
  readonly inputsPerProjectMax: number;
  readonly obligationsPerProjectMax: number;
  readonly leaseSeconds: number;
}

export interface TicketMachineRunReport {
  readonly processed: number;
  readonly delivered: number;
  readonly failures: readonly {
    readonly partition: Partition;
    readonly message: string;
  }[];
  readonly resumeAfter?: Partition;
}

function machineCommandTicket(command: ticket.TicketCommand): TicketId {
  switch (command.kind) {
    case "CreateTicket":
      return command.definition.id;
    case "UpdateTicket":
    case "DispatchTicket":
    case "RevokeTicket":
    case "ResumeTicket":
      return command.ticket;
    case "ReportTaskTerminal":
    case "ReportFinalizationResult":
      return command.report.ticket;
  }
}

export function ticketMachineReworkPolicy(
  limit: number | null,
): ticket.EvaluationFailurePolicy {
  if (limit === null) return ticket.rework_policy;
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError("invalid rework limit");
  return (evaluation) =>
    evaluation.work_cycle < limit
      ? new ticket.ReworkEvaluationFailure()
      : new ticket.EscalateEvaluationFailure();
}

async function ticketMachineTurn(
  service: TicketMachineRuntime,
  config: TicketMachineRunConfig,
  lease: Lease,
): Promise<{ processed: number; delivered: number }> {
  let processed = 0;
  for (let index = 0; index < config.inputsPerProjectMax; index += 1) {
    const input = await service.queue.next(lease);
    if (input === undefined) break;
    const metadata = await service.inbox.releaseMetadata(
      lease.partition,
      machineCommandTicket(input.command),
    );
    const outcome = await ticketMachineProcess(
      service.store,
      lease,
      input,
      ticketMachineReworkPolicy(metadata?.reworkLimit ?? null),
    );
    if (
      outcome.processed !== "Committed" &&
      outcome.processed !== "AlreadyCommitted"
    )
      break;
    processed += 1;
  }
  const renewed = await service.projects.renew(lease, config.leaseSeconds);
  if (renewed.renewed !== "Extended") return { processed, delivered: 0 };
  const delivered = await ticketMachineDeliver(
    service.store,
    service.effects,
    lease.partition,
    config.obligationsPerProjectMax,
  );
  return { processed, delivered };
}

export async function ticketMachineRunOnce(
  service: TicketMachineRuntime,
  config: TicketMachineRunConfig,
  after?: Partition,
): Promise<TicketMachineRunReport> {
  for (const value of [
    config.projectsPerPassMax,
    config.inputsPerProjectMax,
    config.obligationsPerProjectMax,
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000)
      throw new RangeError("invalid ticket service count bound");
  if (!Number.isFinite(config.leaseSeconds) || config.leaseSeconds <= 0)
    throw new RangeError("invalid ticket service lease duration");
  const projects = await service.queue.ready(config.projectsPerPassMax, after);
  let processed = 0;
  let delivered = 0;
  const failures: { partition: Partition; message: string }[] = [];
  for (const partition of projects) {
    try {
      const acquired = await service.projects.acquire(
        partition,
        service.owner,
        config.leaseSeconds,
      );
      if (acquired.acquired !== "Granted") continue;
      try {
        const turn = await ticketMachineTurn(service, config, acquired.lease);
        processed += turn.processed;
        delivered += turn.delivered;
      } finally {
        await service.projects.release(acquired.lease);
      }
    } catch (error) {
      failures.push({
        partition,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const last = projects.at(-1);
  return {
    processed,
    delivered,
    failures,
    ...(projects.length === config.projectsPerPassMax && last !== undefined
      ? { resumeAfter: last }
      : {}),
  };
}
