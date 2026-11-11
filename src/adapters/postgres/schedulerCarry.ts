/**
 * The scheduler's half of a carried verdict: the rows `verdictCarrySource`
 * decides from, read under the launch's row lock, and the transaction that
 * settles an evaluation on an earlier one's passing verdict.
 *
 * ONLY AN `OnChange` WORKLOAD IS READ FOR. An evaluation whose workload is
 * `Always`, or that has opened an attempt, makes no read here and launches as
 * it always did. The rows are the same evaluator's of the same stage of the
 * ticket, latest first, bounded; an older one past the bound is not read, and
 * a task that might have carried it launches instead. Whether a work cycle's
 * stack landed is `ticket_cycle_beneath_landed`'s answer, because the scheduler
 * reads neither the stack relations nor the journal.
 *
 * THE CARRY IS SETTLED IN ITS OWN TRANSACTION, MODELLED ON
 * `schedulerSettleUnreported`. It takes the request, the execution and the
 * project in `./scheduler.ts`'s order, and settles nothing for an execution
 * that has opened an attempt since the launch read. The manifest needs an
 * attempt of its own execution, so it opens one that never places and ends as
 * it opens, `Carried`; no lease, pool, invocation or secret is ever written to
 * it, and no sweep reads that state. The manifest is a real one, sealed by the
 * acceptance every manifest goes through under that attempt's binding: a pass,
 * no handoffs, no diagnostics, no source, and the earlier result's report, so a
 * later work cycle's briefing reads the review it carried. It is submitted
 * through `submit_task_completion` as `Passed`, and the carry is recorded in
 * `execution_verdict_carry` once it is.
 *
 * THE EXPECTED TREE IS NOT CHECKED. That check is on the worker's report, and
 * a carried verdict was earned on another tree by design: the change identity
 * is what it is held to.
 */

import { sql } from "@ts-safeql/sql-tag";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import { resultManifestSchemaVersion } from "../../contract/workerDocuments.ts";
import { assertNever } from "../../domain/assertNever.ts";
import { asTicketId } from "../../domain/ids.ts";
import {
  allExecutionOutcomes,
  asAttemptId,
  asExecutionId,
  executionOwnsSlot,
  type AttemptOpening,
  type ExecutionId,
  type LogicalExecution,
  type Terminalized,
} from "../../interpreter/executionScheduler.ts";
import {
  acceptResultManifest,
  asResultManifestId,
  type ResultManifest,
} from "../../interpreter/resultManifest.ts";
import {
  allVerdictCarryStacks,
  verdictCarryReevaluation,
  verdictCarrySource,
  type VerdictCarryEarlier,
  type VerdictCarryStack,
  type VerdictCarryTask,
} from "../../interpreter/verdictCarry.ts";
import { projectRowCounter } from "./rows.ts";
import {
  schedulerEvidence,
  schedulerRecordIncident,
  schedulerSettle,
  schedulerSettledAlready,
  schedulerTerminalStanding,
} from "./schedulerCompletion.ts";
import {
  executionRowTaskKind,
  schedulerRowWorkloadTask,
  type ExecutionRow,
} from "./schedulerRows.ts";

/** The most earlier evaluations of one evaluator a launch reads, latest first. */
const schedulerCarryCandidatesMax = 64;

/** One evaluation of the evaluator, as the launch read takes it. */
interface CarryRow {
  readonly execution: string;
  readonly stage: string;
  readonly evaluator: string;
  readonly cycle: string;
  readonly generation: string | null;
  readonly outcome: string | null;
  readonly workload_digest: string | null;
  readonly handoffs: string;
  readonly change_identity: string | null;
  readonly stack: string | null;
}

function schedulerCarryStack(value: string | null): VerdictCarryStack {
  const found = allVerdictCarryStacks.find((stack) => stack === value);
  if (found === undefined)
    throw new Error(
      `postgres scheduler: ${String(value)} is not a stack answer this code knows`,
    );
  return found;
}

function schedulerCarryTask(
  row: CarryRow,
  ticket: ExecutionRow["ticket"],
): VerdictCarryTask {
  return {
    execution: asExecutionId(row.execution),
    ticket: asTicketId(projectRowCounter(ticket, "carry ticket")),
    stage: projectRowCounter(row.stage, "carry stage"),
    evaluator: projectRowCounter(row.evaluator, "carry evaluator"),
    workCycle: projectRowCounter(row.cycle, "carry work cycle"),
    generation: projectRowCounter(row.generation ?? "", "carry generation"),
    workloadDigest: row.workload_digest ?? undefined,
    changeIdentity: row.change_identity ?? undefined,
    stack: schedulerCarryStack(row.stack),
  };
}

function schedulerCarryEarlier(
  row: CarryRow,
  ticket: ExecutionRow["ticket"],
): VerdictCarryEarlier {
  return {
    ...schedulerCarryTask(row, ticket),
    outcome: allExecutionOutcomes.find((outcome) => outcome === row.outcome),
    handoffs: projectRowCounter(row.handoffs, "carry handoffs"),
  };
}

/** The launching evaluation and the same evaluator's earlier ones, the launching one first and then latest first. */
async function schedulerCarryRows(
  client: pg.PoolClient,
  row: ExecutionRow,
): Promise<readonly CarryRow[]> {
  const found = await client.query<CarryRow>(
    sql`SELECT e.execution, t.stage::text AS stage, t.evaluator::text AS evaluator,
               t.cycle::text AS cycle, t.generation::text AS generation,
               e.outcome, e.workload_digest,
               (SELECT count(*) FROM execution_result_artifact x
                 WHERE x.tenant = e.tenant AND x.project = e.project
                   AND x.manifest = e.result_manifest AND x.role = 'Handoff')::text AS handoffs,
               (SELECT b.reference_id FROM input_bundle_reference b
                 WHERE b.tenant = q.tenant AND b.project = q.project
                   AND b.bundle = q.input_bundle AND b.reference_kind = 'ChangeIdentity'
                 ORDER BY b.ordinal LIMIT 1) AS change_identity,
               ticket_cycle_beneath_landed(e.tenant, e.project, e.ticket, t.cycle)::text AS stack
          FROM execution e
          JOIN execution_request q
            ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
          JOIN execution_request_task t
            ON t.tenant = e.tenant AND t.project = e.project
           AND t.request = e.source_request AND t.task = e.task
          JOIN execution_request_task c
            ON c.tenant = e.tenant AND c.project = e.project
           AND c.request = ${row.source_request} AND c.task = ${row.task}::bigint
         WHERE e.tenant = ${row.tenant} AND e.project = ${row.project}
           AND e.ticket = ${row.ticket}::bigint AND t.kind = 'Evaluation'
           AND t.stage = c.stage AND t.evaluator = c.evaluator
           AND (e.execution = ${row.execution} OR t.cycle < c.cycle)
         ORDER BY e.execution = ${row.execution} DESC, t.cycle DESC, t.generation DESC, e.execution
         LIMIT ${schedulerCarryCandidatesMax + 1}`,
  );
  return found.rows;
}

/**
 * The execution whose passing verdict the evaluation `row` names carries, or
 * undefined where it launches. `row` is the launch's, read under its lock.
 */
export async function schedulerCarrySource(
  client: pg.PoolClient,
  row: ExecutionRow,
): Promise<ExecutionId | undefined> {
  const kind = executionRowTaskKind(row.task_kind);
  if (kind !== "Evaluation") return undefined;
  const reevaluate = verdictCarryReevaluation(
    schedulerRowWorkloadTask(row, kind),
  );
  if (reevaluate === "Always") return undefined;
  const rows = await schedulerCarryRows(client, row);
  const [launching, ...earlier] = rows;
  if (launching?.execution !== row.execution)
    throw new Error(
      `postgres scheduler: the carry read did not find execution ${row.execution} itself`,
    );
  return verdictCarrySource(
    { ...schedulerCarryTask(launching, row.ticket), reevaluate },
    earlier.map((each) => schedulerCarryEarlier(each, row.ticket)),
  );
}

/**
 * What the earlier execution settled as, and the report its result kept; a
 * result older than the report field kept none, and a manifest needs one.
 */
async function schedulerCarriedResult(
  client: pg.PoolClient,
  execution: LogicalExecution,
  source: ExecutionId,
): Promise<{ readonly passed: boolean; readonly report: string }> {
  const found = await client.query<{
    outcome: string | null;
    report: string | null;
  }>(
    sql`SELECT s.outcome, r.report
          FROM execution s
          LEFT JOIN execution_result_report r
            ON r.tenant = s.tenant AND r.project = s.project AND r.manifest = s.result_manifest
         WHERE s.tenant = ${execution.partition.tenant}
           AND s.project = ${execution.partition.project}
           AND s.execution = ${source} AND s.ticket = ${execution.ticket}`,
  );
  const row = found.rows[0];
  return {
    passed: row?.outcome === "Passed",
    report:
      row?.report ??
      `The passing verdict of ${source} was carried, and it kept no report.`,
  };
}

/** Opens the attempt a carried manifest is bound to, ended as it opens, and answers its identity and manifest. */
async function schedulerCarriedAttempt(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<{ readonly attempt: string; readonly manifest: string }> {
  const attempt = `attempt-${randomUUID()}`;
  const manifest = `manifest-${randomUUID()}`;
  const opened = await client.query(
    sql`WITH numbered AS (
          UPDATE execution SET attempt_next = attempt_next + 1
           WHERE tenant = ${opening.partition.tenant} AND project = ${opening.partition.project}
             AND execution = ${opening.execution}
          RETURNING attempt_next - 1 AS attempt_number)
        INSERT INTO execution_attempt
          (tenant, project, execution, attempt, attempt_number, recovery_epoch,
           state, ended_at, capability, manifest, runtime)
        SELECT ${opening.partition.tenant}, ${opening.partition.project}, ${opening.execution},
               ${attempt}, attempt_number, ${opening.epoch}, 'Carried', now(),
               ${`capability-${randomUUID()}`}, ${manifest}, ${opening.runtime}
          FROM numbered`,
  );
  if (opened.rowCount !== 1)
    throw new Error(
      `postgres scheduler: carrying a verdict to ${opening.execution} opened no attempt`,
    );
  return { attempt, manifest };
}

/** The manifest a carried verdict settles under, sealed like any other. */
function schedulerCarriedManifest(
  execution: LogicalExecution,
  attempt: { readonly attempt: string; readonly manifest: string },
  report: string,
): ResultManifest {
  const accepted = acceptResultManifest(
    {
      partition: execution.partition,
      execution: execution.execution,
      attempt: asAttemptId(attempt.attempt),
    },
    asResultManifestId(attempt.manifest),
    JSON.stringify({
      version: resultManifestSchemaVersion,
      verdict: "Pass",
      report,
      handoffs: [],
      diagnostics: [],
      source: null,
    }),
    (canonical) => createHash("sha256").update(canonical).digest("hex"),
  );
  if (accepted.accepted === "Rejected")
    throw new Error(
      `postgres scheduler: the carried manifest this adapter composes was refused as ${accepted.code}`,
    );
  return accepted.manifest;
}

/** Settles one admitted evaluation on `source`'s passing verdict, or says why it did not. */
export async function schedulerCarryVerdict(
  client: pg.PoolClient,
  opening: AttemptOpening,
  source: ExecutionId,
): Promise<Terminalized> {
  const standing = await schedulerTerminalStanding(
    client,
    opening.partition,
    opening.execution,
  );
  switch (standing.standing) {
    case "Retired":
      return { terminalized: "Cancelled" };
    case "NotAdmitted":
      return { terminalized: "NotAdmitted" };
    case "Settled":
      return schedulerSettledAlready(standing.execution);
    case "Open":
      break;
    default:
      return assertNever(standing);
  }
  const execution = standing.execution;
  if (execution.attemptsOpened !== 0 || !executionOwnsSlot(execution.status))
    return { terminalized: "Fenced" };
  const carried = await schedulerCarriedResult(client, execution, source);
  if (!carried.passed)
    return {
      terminalized: "Conflicting",
      incident: await schedulerRecordIncident(
        client,
        execution.partition,
        "ImpossibleState",
        schedulerEvidence.CarriedUnpassed,
        { execution: execution.execution },
      ),
    };
  const attempt = await schedulerCarriedAttempt(client, opening);
  const settled = await schedulerSettle(
    client,
    execution,
    schedulerCarriedManifest(execution, attempt, carried.report),
  );
  if (settled.terminalized === "Terminalized")
    await client.query(
      sql`INSERT INTO execution_verdict_carry (tenant, project, execution, source_execution)
          VALUES (${execution.partition.tenant}, ${execution.partition.project},
                  ${execution.execution}, ${source})`,
    );
  return settled;
}
