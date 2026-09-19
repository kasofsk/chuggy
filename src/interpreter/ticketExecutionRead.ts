/**
 * What an outside reader may ask about an attempt: what ran, what it spent and
 * what it left behind.
 *
 * A READ IS AUTHORIZED AS THE PROJECT IT NAMES. Every method takes the asking
 * principal and answers `NotFound` for a project that principal may not see, so
 * a caller cannot tell a project it is not a member of from one that does not
 * exist. That is the same concealment the ticket application already makes, and
 * it is why these live behind the same kind of result.
 *
 * NOTHING HERE IS A MEASURE OF THIS TREE'S OWN. The figures are what a workload
 * reported about itself, and a reader of them is reading a claim that was
 * bounded and shaped on arrival rather than one that was checked.
 */

import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type { Principal } from "./principal.ts";
import type { TicketApplicationResult } from "./ticketApplication.ts";
import type {
  TicketExecutionRunModelUsage,
  TicketExecutionRunTotals,
  TicketExecutionRunTurn,
} from "./ticketExecutionRun.ts";

/** One task's execution as a reader sees it, which is its standing and its last measure. */
export interface TicketExecutionSummary {
  readonly taskKey: string;
  readonly state: "Queued" | "Running" | "Terminal" | "Cancelled";
  readonly attempt: number;
  readonly attemptsUnreported: number;
  readonly queuedAt: string;
  readonly lastReportedAt?: string;
  readonly pool?: string;
  readonly totals?: TicketExecutionRunTotals;
}

/** A page of turns, and where a reader asks for the next one. */
export interface TicketExecutionTurnPage {
  readonly turns: readonly (TicketExecutionRunTurn & {
    readonly recordedAt: string;
  })[];
  readonly nextAfter?: number;
}

/** One stored batch of a transcript, as the plane measured it and the store holds it. */
export interface TicketExecutionTranscriptBatch {
  readonly batch: number;
  readonly bytes: number;
  readonly events: number;
  readonly recordedAt: string;
  readonly read: "Content" | "Missing" | "Corrupt";
  readonly content?: string;
}

export interface TicketExecutionTranscriptPage {
  readonly batches: readonly TicketExecutionTranscriptBatch[];
  readonly nextAfter?: number;
}

/** The snapshot one attempt recorded of what it ran under. */
export interface TicketExecutionConfiguration {
  readonly digest: string;
  readonly bytes: number;
  readonly recordedAt: string;
  readonly read: "Content" | "Missing" | "Corrupt";
  readonly content?: string;
}

/** One accepted input as the record of it reads: who asked, for what, and what came of it. */
export interface TicketOperationEntry {
  readonly identity: string;
  readonly sequence: number;
  readonly origin: "Author" | "Execution" | "Finalizer";
  readonly attribution: string;
  readonly command: string;
}

/** Where the rows behind these reads are drawn from, with no authorization of its own. */
export interface TicketExecutionReadStore {
  executions(
    partition: Partition,
    limit: number,
  ): Promise<readonly TicketExecutionSummary[]>;
  execution(
    partition: Partition,
    taskKey: string,
  ): Promise<TicketExecutionSummary | undefined>;
  models(
    partition: Partition,
    taskKey: string,
    attempt: number,
  ): Promise<readonly TicketExecutionRunModelUsage[]>;
  turns(
    partition: Partition,
    taskKey: string,
    attempt: number,
    after: number,
    limit: number,
  ): Promise<TicketExecutionTurnPage>;
  transcript(
    partition: Partition,
    taskKey: string,
    attempt: number,
    after: number,
  ): Promise<TicketExecutionTranscriptPage>;
  configuration(
    partition: Partition,
    taskKey: string,
    attempt: number,
  ): Promise<TicketExecutionConfiguration | undefined>;
  operations(
    partition: Partition,
    limit: number,
  ): Promise<readonly TicketOperationEntry[]>;
}

/** What the reads answer, each concealing a project the asker may not see. */
export interface TicketExecutionReads {
  admitted(
    principal: Principal,
    partition: Partition,
  ): Promise<TicketApplicationResult<{ readonly admitted: true }>>;
  executions(
    principal: Principal,
    partition: Partition,
    limit: number,
  ): Promise<TicketApplicationResult<readonly TicketExecutionSummary[]>>;
  execution(
    principal: Principal,
    partition: Partition,
    taskKey: string,
  ): Promise<TicketApplicationResult<TicketExecutionSummary | undefined>>;
  turns(
    principal: Principal,
    partition: Partition,
    taskKey: string,
    attempt: number,
    after: number,
    limit: number,
  ): Promise<TicketApplicationResult<TicketExecutionTurnPage>>;
  transcript(
    principal: Principal,
    partition: Partition,
    taskKey: string,
    attempt: number,
    after: number,
  ): Promise<TicketApplicationResult<TicketExecutionTranscriptPage>>;
  configuration(
    principal: Principal,
    partition: Partition,
    taskKey: string,
    attempt: number,
  ): Promise<TicketApplicationResult<TicketExecutionConfiguration | undefined>>;
  operations(
    principal: Principal,
    partition: Partition,
    limit: number,
  ): Promise<TicketApplicationResult<readonly TicketOperationEntry[]>>;
}

/**
 * Holds every read to the membership the asker has. One authorization stands
 * for the whole call, so a page and the row it pages over are answered under
 * the same decision rather than re-asked partway through.
 */
export function ticketExecutionReads(ports: {
  readonly access: ProjectAccess;
  readonly store: TicketExecutionReadStore;
}): TicketExecutionReads {
  const permitted = async (
    principal: Principal,
    partition: Partition,
  ): Promise<boolean> =>
    (await ports.access.authorize(principal, partition, "Read")) !== undefined;
  const answered = async <Value>(
    principal: Principal,
    partition: Partition,
    read: () => Promise<Value>,
  ): Promise<TicketApplicationResult<Value>> =>
    (await permitted(principal, partition))
      ? { result: "Authorized", value: await read() }
      : { result: "NotFound" };
  return {
    admitted: (principal, partition) =>
      answered(principal, partition, () =>
        Promise.resolve({ admitted: true } as const),
      ),
    executions: (principal, partition, limit) =>
      answered(principal, partition, () =>
        ports.store.executions(partition, limit),
      ),
    execution: (principal, partition, taskKey) =>
      answered(principal, partition, () =>
        ports.store.execution(partition, taskKey),
      ),
    turns: (principal, partition, taskKey, attempt, after, limit) =>
      answered(principal, partition, () =>
        ports.store.turns(partition, taskKey, attempt, after, limit),
      ),
    transcript: (principal, partition, taskKey, attempt, after) =>
      answered(principal, partition, () =>
        ports.store.transcript(partition, taskKey, attempt, after),
      ),
    configuration: (principal, partition, taskKey, attempt) =>
      answered(principal, partition, () =>
        ports.store.configuration(partition, taskKey, attempt),
      ),
    operations: (principal, partition, limit) =>
      answered(principal, partition, () =>
        ports.store.operations(partition, limit),
      ),
  };
}
