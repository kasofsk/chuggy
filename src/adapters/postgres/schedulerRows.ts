/**
 * The execution and attempt rows as PostgreSQL returns them, and their
 * translation into the values `src/interpreter/executionScheduler.ts` declares.
 *
 * WHY A TRANSLATION AT ALL. The same reason `./rows.ts` has one: the driver
 * hands back `bigint` columns as strings and `text` columns as unbranded
 * strings, so a row is a foreign shape and the port's types are this tree's.
 * Parsing once, here, is what stops the widening from happening at each call
 * site, and it is where a counter too large for an exact integer is refused
 * rather than silently rounded.
 *
 * A REGISTRATION CARRIES NO PROVENANCE OF ITS OWN, so reading one is a join.
 * The authorizing sequence, the effect position, the ticket version, the task
 * kind and the stage all belong to the request and the task row that authorized
 * the registration, and issue #180 has the
 * registration pin the request rather than copy them — a copy is a second
 * version of a fact that can drift from the effect that authorized it. So every
 * read of an execution names the same join, once, below.
 *
 * A NARROWING IS A REFUSAL AND NEVER A DEFAULT. A status, outcome or attempt
 * state outside the closed set is a row no migration can have written, so it
 * raises rather than resolving to whichever member the reader thought most
 * likely.
 */

import { asStageIndex, asTaskId, asTicketId } from "../../domain/ids.ts";
import {
  allAttemptStates,
  allExecutionOutcomes,
  allExecutionStatuses,
  asAttemptId,
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
  asWorkloadId,
  type AttemptState,
  type ExecutionOutcome,
  type ExecutionStatus,
  type ExecutionTaskKind,
  type LogicalExecution,
  type PhysicalAttempt,
} from "../../interpreter/executionScheduler.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { asResultManifestId } from "../../interpreter/resultManifest.ts";
import { projectRowCounter } from "./rows.ts";

/** One execution row joined to the request and task row that authorized it. */
export interface ExecutionRow {
  readonly tenant: string;
  readonly project: string;
  readonly execution: string;
  readonly ticket: string;
  readonly task: string;
  readonly task_kind: string;
  readonly stage: string | null;
  readonly source_request: string;
  readonly source_seq: string;
  readonly source_effect: string;
  readonly ticket_version: string;
  readonly account: string;
  readonly cluster: string;
  readonly configuration_revision: string;
  readonly configuration_digest: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly result_manifest: string | null;
  readonly completion_operation: string | null;
  readonly attempts_opened: string;
  readonly retries_spent: string;
}

/** One attempt row as the fence and the lease leave it. */
export interface AttemptRow {
  readonly tenant: string;
  readonly project: string;
  readonly execution: string;
  readonly attempt: string;
  readonly attempt_number: string;
  readonly generation: string;
  readonly recovery_epoch: string;
  readonly state: string;
  readonly workload: string | null;
  readonly authoritative: boolean;
}

/**
 * The relations every read of an execution draws from, named once so no two
 * queries can join the provenance differently.
 */
export const executionRowFrom = `
  execution e
  JOIN execution_request q
    ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
  JOIN execution_request_task t
    ON t.tenant = e.tenant AND t.project = e.project
   AND t.request = e.source_request AND t.task = e.task
`;

/** The columns those reads select, cast so every counter arrives as text to parse. */
export const executionRowColumns = `
  e.tenant, e.project, e.execution, e.ticket::text AS ticket, e.task::text AS task,
  t.kind AS task_kind, t.stage::text AS stage, e.source_request,
  q.authorizing_seq::text AS source_seq, q.effect_position::text AS source_effect,
  q.ticket_version::text AS ticket_version, e.account, e.cluster,
  e.configuration_revision, e.configuration_digest, e.status, e.outcome,
  e.result_manifest, e.completion_operation,
  (e.attempt_next - 1)::text AS attempts_opened, e.retries_spent::text AS retries_spent
`;

/**
 * The columns every read of an attempt selects, with the liveness the database
 * computed. They carry no table qualifier, because the one statement that
 * returns them is the insert that opens an attempt and a `RETURNING` clause has
 * no alias to qualify them with.
 */
export const attemptRowColumns = `
  tenant, project, execution, attempt, attempt_number::text AS attempt_number,
  generation::text AS generation, recovery_epoch, state, workload,
  (state IN ('Placing', 'Running')) AS authoritative
`;

/** The partition a scheduler row belongs to. */
export function schedulerRowPartition(row: {
  readonly tenant: string;
  readonly project: string;
}): Partition {
  return { tenant: asTenantId(row.tenant), project: asProjectId(row.project) };
}

/** Narrows a status column to the closed set, refusing a value no migration can have written. */
function executionRowStatus(value: string): ExecutionStatus {
  const found = allExecutionStatuses.find((status) => status === value);
  if (found === undefined) {
    throw new Error(
      `execution row: ${value} is not a logical status this code knows`,
    );
  }
  return found;
}

/** Narrows an outcome column to the closed set, refusing a value no settlement can have written. */
function executionRowOutcome(value: string): ExecutionOutcome {
  const found = allExecutionOutcomes.find((outcome) => outcome === value);
  if (found === undefined) {
    throw new Error(
      `execution row: ${value} is not a terminal outcome this code knows`,
    );
  }
  return found;
}

/** Narrows an attempt state column to the closed set. */
function attemptRowState(value: string): AttemptState {
  const found = allAttemptStates.find((state) => state === value);
  if (found === undefined) {
    throw new Error(
      `execution attempt row: ${value} is not an attempt state this code knows`,
    );
  }
  return found;
}

/** Narrows a task kind column, which the request declared and the registration mirrors. */
function executionRowTaskKind(value: string): ExecutionTaskKind {
  if (value !== "Work" && value !== "Evaluation") {
    throw new Error(
      `execution row: ${value} is not a task kind a spawn request declares`,
    );
  }
  return value;
}

/** The settled half of one registration, which is present exactly when it is terminal. */
function executionRowSettlement(row: ExecutionRow) {
  return {
    ...(row.outcome === null
      ? {}
      : { outcome: executionRowOutcome(row.outcome) }),
    ...(row.result_manifest === null
      ? {}
      : { resultManifest: asResultManifestId(row.result_manifest) }),
    ...(row.completion_operation === null
      ? {}
      : { completionOperation: asOperationId(row.completion_operation) }),
  };
}

/** What one joined execution row says about itself. */
export function executionRowLogical(row: ExecutionRow): LogicalExecution {
  return {
    partition: schedulerRowPartition(row),
    execution: asExecutionId(row.execution),
    ticket: asTicketId(projectRowCounter(row.ticket, "execution ticket")),
    task: asTaskId(projectRowCounter(row.task, "execution task")),
    taskKind: executionRowTaskKind(row.task_kind),
    ...(row.stage === null
      ? {}
      : { stage: asStageIndex(projectRowCounter(row.stage, "task stage")) }),
    sourceRequest: row.source_request,
    sourceSeq: projectRowCounter(row.source_seq, "authorizing sequence"),
    sourceEffect: projectRowCounter(row.source_effect, "effect position"),
    ticketVersion: projectRowCounter(row.ticket_version, "ticket version"),
    account: asCapacityAccountId(row.account),
    cluster: asClusterId(row.cluster),
    configurationRevision: row.configuration_revision,
    configurationDigest: row.configuration_digest,
    status: executionRowStatus(row.status),
    ...executionRowSettlement(row),
    attemptsOpened: projectRowCounter(row.attempts_opened, "attempts opened"),
    retriesSpent: projectRowCounter(row.retries_spent, "retries spent"),
  };
}

/** What one attempt row says about itself, fence and lease included. */
export function attemptRowPhysical(row: AttemptRow): PhysicalAttempt {
  return {
    partition: schedulerRowPartition(row),
    execution: asExecutionId(row.execution),
    attempt: asAttemptId(row.attempt),
    generation: projectRowCounter(row.generation, "attempt generation"),
    attemptNumber: projectRowCounter(row.attempt_number, "attempt number"),
    recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
    state: attemptRowState(row.state),
    authoritative: row.authoritative,
    ...(row.workload === null ? {} : { workload: asWorkloadId(row.workload) }),
  };
}
