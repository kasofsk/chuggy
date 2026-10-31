import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asTaskId, asTicketId, type TicketId } from "../../domain/ids.ts";
import type { TaskIdentity } from "../../domain/generated/modelTypes.ts";
import {
  asConfigurationRevisionId,
  asCanonicalConfiguration,
  declaredConfigurationVersion,
} from "../../interpreter/authoring.ts";
import {
  catalogWorkloadTask,
  workloadTaskPositionOf,
} from "../../interpreter/workloadTask.ts";
import {
  allAttemptStates,
  allExecutionOutcomes,
  allExecutionStatuses,
  attemptEvidenceLabel,
  taskPurposeForKind,
  type ExecutionStatus,
} from "../../interpreter/executionScheduler.ts";
import {
  authoredTaskConfigurationReadiness,
  briefingStageCarrier,
  type BriefingCarrier,
} from "../../interpreter/taskBriefing.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import {
  configuredOutputs,
  executionSummaryImages,
  executionSummaryLabelled,
  executionSummaryTotalled,
  type ExecutionAttemptResource,
  type ExecutionListQuery,
  type ExecutionPage,
  type ExecutionResource,
  type ExecutionResultResource,
  type ExecutionSummary,
  type LatestExecutionListQuery,
  type LatestExecutionPage,
  type OperationalReadStore,
  type OutputDefinition,
  type ResultArtifactResource,
} from "../../interpreter/operationsView.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { Principal } from "../../interpreter/principal.ts";
import { asWorkerPoolOwnerFallback } from "../../interpreter/projectOwnerFallback.ts";
import {
  asAttemptId,
  asClusterId,
  asExecutionId,
  type ExecutionId,
} from "../../interpreter/schedulerIdentity.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
  type ArtifactRole,
} from "../../interpreter/resultManifest.ts";
import type { ExecutionRunResource } from "../../interpreter/runEvidence.ts";
import {
  nativeHttpPageItemsMax,
  workerErrorPath,
} from "../../contract/http.ts";
import { projectRowCounter, projectRowInstant } from "./rows.ts";
import { storedOverridesOf, storedSelectionOf } from "./ticketBrief.ts";
import { executionRowResources } from "./schedulerRows.ts";
import {
  postgresAttemptRuns,
  postgresExecutionRunTotals,
} from "./runEvidence.ts";
import { postgresWorkerCatalog } from "./workerCatalog.ts";
import {
  configurationVersionOf,
  type ConfigurationVersionRow,
} from "./configurationVersion.ts";
import {
  asExecutionRequirement,
  asRequirementSource,
} from "../../interpreter/executionRequirement.ts";

interface ExecutionViewRow extends ConfigurationVersionRow {
  readonly execution: string;
  readonly ticket: string;
  readonly task: string;
  readonly task_kind: string;
  readonly cycle: string;
  readonly stage: string | null;
  readonly generation: string | null;
  readonly evaluator: string | null;
  readonly cluster: string;
  readonly configuration_revision: string;
  readonly requirement_identity: string;
  readonly requirement_value: unknown;
  readonly requirement_digest: string;
  readonly requirement_source: string;
  readonly source_request: string;
  readonly platform_default_version: string;
  readonly cpu_millis: number | null;
  readonly memory_mib: number | null;
  readonly canonical: string;
  /** The catalog entries the ticket selected, as text, which a version 1 ticket holds none of. */
  readonly selection: string | null;
  /** The overrides the ticket holds, as text, where it holds any. */
  readonly overrides: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly retries_spent: string;
  readonly relaunches: string;
  readonly registered_at: string | null;
  readonly started_at: string | null;
  readonly run_started_at: string | null;
  readonly terminal_at: string | null;
  readonly result_manifest: string | null;
  readonly owner_fallback: string | null;
  readonly mine: boolean;
}

interface AttemptViewRow {
  readonly attempt: string;
  readonly attempt_number: string;
  readonly generation: string;
  readonly state: string;
  readonly opened_at: string | null;
  readonly claimed_at: string | null;
  readonly ended_at: string | null;
  readonly evidence: string | null;
  readonly error_bytes: string | null;
  readonly pool_refusal: string | null;
}

interface ResultViewRow {
  readonly manifest: string;
  readonly attempt: string;
  readonly schema_version: number;
  readonly digest: string;
  readonly verdict: string;
  readonly recorded_at: string | null;
  readonly report: string | null;
}

interface ArtifactViewRow {
  readonly ordinal: number;
  readonly role: string;
  readonly path: string;
  readonly digest: string;
  readonly bytes: string;
}

interface StatusViewRow {
  readonly observed_at: string | null;
  readonly queued: string | null;
  readonly admitted: string | null;
  readonly launching: string | null;
  readonly running: string | null;
  readonly cluster_slots_max: string | null;
  readonly cluster_active: string | null;
  readonly account_maximum: string | null;
  readonly account_active: string | null;
  readonly account_deficit: string | null;
}

function known<Value extends string>(
  value: string,
  values: readonly Value[],
  what: string,
): Value {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`operational read: unknown ${what}`);
  return found;
}

/**
 * The identity the task row carries, rebuilt from the columns it is held to.
 * A `Work` row that names a stage, or an `Evaluation` row missing any of its
 * three, is a row `execution_request_task_check` could not have admitted, so
 * it is refused here rather than answered as the other arm.
 */
function executionIdentity(row: ExecutionViewRow): TaskIdentity {
  const ticket = projectRowCounter(row.ticket, "execution ticket");
  const cycle = projectRowCounter(row.cycle, "execution task cycle");
  if (taskKind(row.task_kind) === "Work") {
    if (row.stage !== null || row.generation !== null || row.evaluator !== null)
      throw new Error("operational read: a work task names an evaluation");
    return { type: "WorkTask", value: { ticket, cycle } };
  }
  if (row.stage === null || row.generation === null || row.evaluator === null)
    throw new Error("operational read: an evaluation task is half named");
  return {
    type: "EvaluationTask",
    value: {
      ticket,
      workCycle: cycle,
      stage: projectRowCounter(row.stage, "execution task stage"),
      generation: projectRowCounter(
        row.generation,
        "execution task generation",
      ),
      evaluator: projectRowCounter(row.evaluator, "execution task evaluator"),
    },
  };
}

/** What carries out the row's stage, read from the revision it pinned; a revision no briefing reads names none. */
function executionSummaryCarrier(
  row: ExecutionViewRow,
): BriefingCarrier | undefined {
  const configuration = JSON.parse(row.canonical) as unknown;
  if (declaredConfigurationVersion(configuration) === 2)
    return executionSummaryWorkloadCarrier(row, configuration);
  const parsed = authoredTaskConfigurationReadiness(configuration);
  if (parsed.readiness !== "Ready") return undefined;
  return briefingStageCarrier(
    parsed.configuration,
    taskPurposeForKind(taskKind(row.task_kind)),
    row.stage === null
      ? undefined
      : projectRowCounter(row.stage, "execution task stage") - 1,
  );
}

/** What carries out a catalog's task: the runner of the workload its ticket's selection puts there. */
function executionSummaryWorkloadCarrier(
  row: ExecutionViewRow,
  configuration: unknown,
): BriefingCarrier | undefined {
  const position = workloadTaskPositionOf(
    taskKind(row.task_kind),
    row.stage === null
      ? undefined
      : projectRowCounter(row.stage, "execution task stage") - 1,
    row.evaluator === null
      ? undefined
      : projectRowCounter(row.evaluator, "execution task evaluator"),
  );
  const task =
    position === undefined
      ? undefined
      : catalogWorkloadTask(
          configuration,
          storedOverridesOf(row.overrides),
          storedSelectionOf(row.selection),
          position,
        );
  if (task === undefined) return undefined;
  return task.workload.runner === "Commands" ? "Commands" : "Agent";
}

function executionSummary(row: ExecutionViewRow): ExecutionSummary {
  const configurationVersion = configurationVersionOf(row);
  const carrier = executionSummaryCarrier(row);
  return {
    execution: asExecutionId(row.execution),
    ticket: asTicketId(projectRowCounter(row.ticket, "execution ticket")),
    task: asTaskId(projectRowCounter(row.task, "execution task")),
    taskKind: taskKind(row.task_kind),
    identity: executionIdentity(row),
    cluster: asClusterId(row.cluster),
    configurationRevision: asConfigurationRevisionId(
      row.configuration_revision,
    ),
    ...(configurationVersion === undefined ? {} : { configurationVersion }),
    requirementIdentity: row.requirement_identity,
    requirement: asExecutionRequirement(row.requirement_value),
    requirementDigest: row.requirement_digest,
    requirementSource: asRequirementSource(row.requirement_source),
    request: row.source_request,
    platformDefaultVersion: projectRowCounter(
      row.platform_default_version,
      "platform default version",
    ),
    ...executionRowResources(row),
    status: known(row.status, allExecutionStatuses, "execution status"),
    ...(row.outcome === null
      ? {}
      : {
          outcome: known(
            row.outcome,
            allExecutionOutcomes,
            "execution outcome",
          ),
        }),
    retriesSpent: projectRowCounter(row.retries_spent, "execution retries"),
    relaunches: projectRowCounter(row.relaunches, "execution relaunches"),
    registeredAt: projectRowInstant(row.registered_at, "registration time"),
    ...(row.started_at === null
      ? {}
      : { startedAt: asPublicInstant(row.started_at) }),
    ...(row.run_started_at === null
      ? {}
      : { runStartedAt: asPublicInstant(row.run_started_at) }),
    ...(carrier === undefined ? {} : { carrier }),
    ...(row.terminal_at === null
      ? {}
      : { terminalAt: asPublicInstant(row.terminal_at) }),
    ...(row.owner_fallback === null
      ? {}
      : { ownerFallback: asWorkerPoolOwnerFallback(row.owner_fallback) }),
    mine: row.mine,
  };
}

function attemptResource(
  row: AttemptViewRow,
  run: ExecutionRunResource | undefined,
): ExecutionAttemptResource {
  const evidence =
    row.evidence === null ? undefined : attemptEvidenceLabel(row.evidence);
  return {
    attempt: asAttemptId(row.attempt),
    number: projectRowCounter(row.attempt_number, "attempt number"),
    generation: projectRowCounter(row.generation, "attempt generation"),
    state: known(row.state, allAttemptStates, "attempt state"),
    openedAt: projectRowInstant(row.opened_at, "opening time"),
    ...(row.claimed_at === null
      ? {}
      : { claimedAt: asPublicInstant(row.claimed_at) }),
    ...(row.ended_at === null
      ? {}
      : { endedAt: asPublicInstant(row.ended_at) }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(run === undefined ? {} : { run }),
    ...(row.error_bytes === null
      ? {}
      : {
          error: { bytes: projectRowCounter(row.error_bytes, "error bytes") },
        }),
    ...(row.pool_refusal === null ? {} : { refusal: row.pool_refusal }),
  };
}

function artifactRole(value: string): ArtifactRole {
  if (value === "Handoff" || value === "Diagnostic") return value;
  throw new Error("operational read: unknown artifact role");
}

function resultVerdict(value: string): "Pass" | "Fail" {
  if (value === "Pass" || value === "Fail") return value;
  throw new Error("operational read: unknown result verdict");
}

function taskKind(value: string): "Work" | "Evaluation" {
  if (value === "Work" || value === "Evaluation") return value;
  throw new Error("operational read: unknown task kind");
}

function artifactResource(
  row: ArtifactViewRow,
  outputs: readonly OutputDefinition[],
): ResultArtifactResource {
  const path = asArtifactPath(row.path);
  const output = outputs.find((candidate) => candidate.path === path);
  return {
    ordinal: row.ordinal,
    role: artifactRole(row.role),
    path,
    digest: asArtifactDigest(row.digest),
    bytes: projectRowCounter(row.bytes, "artifact bytes"),
    ...(output === undefined ? {} : { output }),
  };
}

function selectedStatuses(
  query: ExecutionListQuery,
): readonly ExecutionStatus[] {
  if (query.selection === undefined) return allExecutionStatuses;
  return query.selection.selection === "NonTerminal"
    ? ["Queued", "Admitted", "Launching", "Running"]
    : query.selection.states;
}

/**
 * One page of the project's executions in `(ticket, task)` ascending order,
 * which is the order the machine authorized them in, narrowed to `executions`
 * or to the highest task of each of `latestOf`'s tickets where it names any.
 * Execution identity is a random stem with the task appended, so ordering by
 * it would order a ticket's history arbitrarily; the cursor is the position in
 * this order, and the row comparison keeps it total.
 */
async function executionRows(
  pool: pg.Pool,
  partition: Partition,
  query: ExecutionListQuery,
  reader: Principal,
  executions: string[] | null = null,
  latestOf: string[] | null = null,
): Promise<readonly ExecutionViewRow[]> {
  const found = await pool.query<ExecutionViewRow>(
    sql`SELECT e.execution,e.ticket::text AS ticket,e.task::text AS task,
               t.kind AS task_kind,t.cycle::text AS cycle,
               t.stage::text AS stage,t.generation::text AS generation,
               t.evaluator::text AS evaluator,e.cluster,
               e.configuration_revision,e.requirement_identity,e.requirement_value,
               e.requirement_digest,e.requirement_source,e.source_request,
               e.platform_default_version::text AS platform_default_version,
               e.cpu_millis,e.memory_mib,c.canonical,s.status,e.outcome,
               (SELECT d.selection::text FROM ticket_definition d WHERE d.tenant=e.tenant AND d.project=e.project AND d.ticket=e.ticket) AS selection,
               (SELECT d.overrides::text FROM ticket_definition d WHERE d.tenant=e.tenant AND d.project=e.project AND d.ticket=e.ticket) AS overrides,
               e.retries_spent::text AS retries_spent,
               (SELECT count(*) FROM execution_attempt a
                 WHERE a.tenant=e.tenant AND a.project=e.project
                   AND a.execution=e.execution AND a.state='Lost'
                   AND EXISTS (SELECT 1 FROM execution_attempt b
                                WHERE b.tenant=a.tenant AND b.project=a.project
                                  AND b.execution=a.execution
                                  AND b.attempt_number>a.attempt_number))::text
                 AS relaunches,
               to_char(e.registered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS registered_at,to_char(e.terminal_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS terminal_at,
               (SELECT to_char(a.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text FROM execution_attempt a
                 WHERE a.tenant=e.tenant AND a.project=e.project
                   AND a.execution=e.execution
                 ORDER BY a.attempt_number LIMIT 1) AS started_at,
               to_char(live.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS run_started_at,
               e.result_manifest,
               CASE WHEN e.placement='Pool' AND e.owner IS NOT NULL
                    THEN e.owner_fallback END AS owner_fallback,
               coalesce(e.owner=${reader},false) AS mine,
               v.name AS version_name,v.number::text AS version_number
          FROM execution e JOIN configuration_revision c
            ON c.tenant=e.tenant AND c.project=e.project
           AND c.revision=e.configuration_revision AND c.digest=e.configuration_digest
          JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
           AND t.request=e.source_request AND t.task=e.task
          LEFT JOIN repository_configuration_provenance p
            ON p.tenant=e.tenant AND p.project=e.project
           AND p.revision=e.configuration_revision
          LEFT JOIN repository_configuration_version v
            ON v.tenant=e.tenant AND v.project=e.project
           AND v.name=p.name AND v.digest=p.digest
          LEFT JOIN LATERAL (SELECT r.started_at FROM execution_attempt a
              LEFT JOIN execution_run r ON r.tenant=a.tenant AND r.project=a.project
               AND r.execution=a.execution AND r.attempt=a.attempt
             WHERE a.tenant=e.tenant AND a.project=e.project
               AND a.execution=e.execution AND a.state IN ('Placing','Running')
             ORDER BY a.attempt_number DESC LIMIT 1) live ON true
          CROSS JOIN LATERAL (SELECT (CASE WHEN e.status='Launching' AND live.started_at IS NOT NULL THEN 'Running' ELSE e.status END)::text AS status) s
         WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
           AND (${query.after?.ticket ?? null}::bigint IS NULL
                OR (e.ticket,e.task)>(${query.after?.ticket ?? null}::bigint,${query.after?.task ?? null}::bigint))
           AND (${query.ticket ?? null}::bigint IS NULL OR e.ticket=${query.ticket ?? null})
           AND (${executions}::text[] IS NULL OR e.execution=ANY(${executions}::text[]))
           AND (${latestOf}::bigint[] IS NULL OR e.execution IN (SELECT DISTINCT ON (x.ticket) x.execution FROM execution x
                WHERE x.tenant=e.tenant AND x.project=e.project AND x.ticket=ANY(${latestOf}::bigint[]) ORDER BY x.ticket,x.task DESC))
           AND s.status=ANY(${[...selectedStatuses(query)]}::text[])
         ORDER BY e.ticket,e.task LIMIT ${query.limit + 1}`,
  );
  return found.rows;
}

async function executionPage(
  pool: pg.Pool,
  partition: Partition,
  query: ExecutionListQuery,
  reader: Principal,
): Promise<ExecutionPage> {
  const rows = await executionRows(pool, partition, query, reader);
  const summaries = rows.slice(0, query.limit).map(executionSummary);
  const next = rows.length > query.limit ? summaries.at(-1) : undefined;
  return {
    executions: await executionPageAnswered(pool, partition, summaries),
    ...(next === undefined
      ? {}
      : { nextAfter: { ticket: next.ticket, task: next.task } }),
  };
}

/** A page's summaries with their workers labelled and their runs totalled. */
async function executionPageAnswered(
  pool: pg.Pool,
  partition: Partition,
  summaries: readonly ExecutionSummary[],
): Promise<readonly ExecutionSummary[]> {
  const workers = await postgresWorkerCatalog(
    pool,
    executionSummaryImages(summaries),
  );
  const totals = await postgresExecutionRunTotals(
    pool,
    partition,
    summaries.map((summary) => summary.execution),
  );
  return summaries.map((summary) =>
    executionSummaryTotalled(
      executionSummaryLabelled(summary, workers),
      totals,
    ),
  );
}

/**
 * Each ticket's highest task, highest ticket first, below the cursor's ticket.
 * The unique `(tenant, project, ticket, task)` index answers it in that order,
 * so a page reads no further back than its own size.
 */
async function latestExecutionPositions(
  pool: pg.Pool,
  partition: Partition,
  query: LatestExecutionListQuery,
): Promise<readonly { execution: string; ticket: TicketId }[]> {
  const found = await pool.query<{ execution: string; ticket: string }>(
    sql`SELECT DISTINCT ON (e.ticket) e.execution,e.ticket::text AS ticket
          FROM execution e
         WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
           AND (${query.after ?? null}::bigint IS NULL OR e.ticket<${query.after ?? null})
         ORDER BY e.ticket DESC,e.task DESC LIMIT ${query.limit + 1}`,
  );
  return found.rows.map((row) => ({
    execution: row.execution,
    ticket: asTicketId(projectRowCounter(row.ticket, "execution ticket")),
  }));
}

async function latestExecutionPage(
  pool: pg.Pool,
  partition: Partition,
  query: LatestExecutionListQuery,
  reader: Principal,
): Promise<LatestExecutionPage> {
  const positions = await latestExecutionPositions(pool, partition, query);
  const page = positions.slice(0, query.limit);
  const next = positions.length > query.limit ? page.at(-1) : undefined;
  const rows =
    page.length === 0
      ? []
      : await executionRows(
          pool,
          partition,
          { limit: page.length },
          reader,
          page.map((at) => at.execution),
        );
  const summaries = rows.map(executionSummary).toReversed();
  return {
    executions: await executionPageAnswered(pool, partition, summaries),
    ...(next === undefined ? {} : { nextAfter: next.ticket }),
  };
}

/**
 * Each of `tickets`' highest task, as `latestExecutionPositions` picks it, in
 * one statement for them all, labelled by the worker catalog.
 */
async function ticketLatestExecutions(
  pool: pg.Pool,
  partition: Partition,
  tickets: readonly TicketId[],
  reader: Principal,
): Promise<readonly ExecutionSummary[]> {
  if (tickets.length === 0) return [];
  const rows = await executionRows(
    pool,
    partition,
    { limit: tickets.length },
    reader,
    null,
    tickets.map(String),
  );
  if (rows.length > tickets.length)
    throw new Error("operational read: a ticket has two latest executions");
  const summaries = rows.map(executionSummary);
  const workers = await postgresWorkerCatalog(
    pool,
    executionSummaryImages(summaries),
  );
  return summaries.map((summary) => executionSummaryLabelled(summary, workers));
}

async function oneExecution(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
  reader: Principal,
): Promise<ExecutionViewRow | undefined> {
  const found = await pool.query<ExecutionViewRow>(
    sql`SELECT e.execution,e.ticket::text AS ticket,e.task::text AS task,
               t.kind AS task_kind,t.cycle::text AS cycle,
               t.stage::text AS stage,t.generation::text AS generation,
               t.evaluator::text AS evaluator,e.cluster,
               e.configuration_revision,e.requirement_identity,e.requirement_value,
               e.requirement_digest,e.requirement_source,e.source_request,
               e.platform_default_version::text AS platform_default_version,
               e.cpu_millis,e.memory_mib,c.canonical,s.status,e.outcome,
               (SELECT d.selection::text FROM ticket_definition d
                 WHERE d.tenant=e.tenant AND d.project=e.project
                   AND d.ticket=e.ticket) AS selection,
               (SELECT d.overrides::text FROM ticket_definition d
                 WHERE d.tenant=e.tenant AND d.project=e.project
                   AND d.ticket=e.ticket) AS overrides,
               e.retries_spent::text AS retries_spent,
               (SELECT count(*) FROM execution_attempt a
                 WHERE a.tenant=e.tenant AND a.project=e.project
                   AND a.execution=e.execution AND a.state='Lost'
                   AND EXISTS (SELECT 1 FROM execution_attempt b
                                WHERE b.tenant=a.tenant AND b.project=a.project
                                  AND b.execution=a.execution
                                  AND b.attempt_number>a.attempt_number))::text
                 AS relaunches,
               to_char(e.registered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS registered_at,to_char(e.terminal_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS terminal_at,
               (SELECT to_char(a.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text FROM execution_attempt a
                 WHERE a.tenant=e.tenant AND a.project=e.project
                   AND a.execution=e.execution
                 ORDER BY a.attempt_number LIMIT 1) AS started_at,
               to_char(live.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS run_started_at,
               e.result_manifest,
               CASE WHEN e.placement='Pool' AND e.owner IS NOT NULL
                    THEN e.owner_fallback END AS owner_fallback,
               coalesce(e.owner=${reader},false) AS mine,
               v.name AS version_name,v.number::text AS version_number
          FROM execution e JOIN configuration_revision c
            ON c.tenant=e.tenant AND c.project=e.project
           AND c.revision=e.configuration_revision AND c.digest=e.configuration_digest
          JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
           AND t.request=e.source_request AND t.task=e.task
          LEFT JOIN repository_configuration_provenance p
            ON p.tenant=e.tenant AND p.project=e.project
           AND p.revision=e.configuration_revision
          LEFT JOIN repository_configuration_version v
            ON v.tenant=e.tenant AND v.project=e.project
           AND v.name=p.name AND v.digest=p.digest
          LEFT JOIN LATERAL (SELECT r.started_at FROM execution_attempt a
              LEFT JOIN execution_run r ON r.tenant=a.tenant AND r.project=a.project
               AND r.execution=a.execution AND r.attempt=a.attempt
             WHERE a.tenant=e.tenant AND a.project=e.project
               AND a.execution=e.execution AND a.state IN ('Placing','Running')
             ORDER BY a.attempt_number DESC LIMIT 1) live ON true
          CROSS JOIN LATERAL (SELECT (CASE WHEN e.status='Launching' AND live.started_at IS NOT NULL THEN 'Running' ELSE e.status END)::text AS status) s
         WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
           AND e.execution=${execution}`,
  );
  return found.rows[0];
}

async function attempts(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
): Promise<readonly ExecutionAttemptResource[]> {
  const found = await pool.query<AttemptViewRow>(
    sql`SELECT n.attempt,n.attempt_number::text AS attempt_number,
               n.generation::text AS generation,n.state,to_char(n.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS opened_at,
               to_char(n.claimed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS claimed_at,
               to_char(n.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS ended_at,n.evidence,n.error_bytes::text AS error_bytes,
               n.pool_refusal
          FROM (SELECT a.attempt,a.attempt_number,a.generation,
                       (CASE WHEN a.state='Placing' AND EXISTS (
                              SELECT 1 FROM execution_run x
                               WHERE x.tenant=a.tenant AND x.project=a.project
                                 AND x.execution=a.execution AND x.attempt=a.attempt)
                            THEN 'Running' ELSE a.state END)::text AS state,a.opened_at,
                       a.claimed_at,a.ended_at,a.evidence,r.bytes AS error_bytes,a.pool_refusal
                  FROM execution_attempt a
                  LEFT JOIN worker_artifact_reservation r
                    ON r.tenant=a.tenant AND r.project=a.project
                   AND r.execution=a.execution AND r.attempt=a.attempt
                   AND r.path=${workerErrorPath}
                 WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
                   AND a.execution=${execution}
                 ORDER BY a.attempt_number DESC LIMIT ${nativeHttpPageItemsMax}) n
         ORDER BY n.attempt_number`,
  );
  const runs = await postgresAttemptRuns(pool, partition, execution);
  return found.rows.map((row) => attemptResource(row, runs.get(row.attempt)));
}

async function resultResource(
  pool: pg.Pool,
  partition: Partition,
  manifest: string,
  canonical: string,
): Promise<ExecutionResultResource | undefined> {
  const found = await pool.query<ResultViewRow>(
    sql`SELECT r.manifest,r.attempt,r.schema_version,r.digest,r.verdict,
               to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS recorded_at,p.report
          FROM execution_result r
          LEFT JOIN execution_result_report p
            ON p.tenant=r.tenant AND p.project=r.project AND p.manifest=r.manifest
         WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
           AND r.manifest=${manifest}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const artifacts = await pool.query<ArtifactViewRow>(
    sql`SELECT ordinal,role,path,digest,bytes::text AS bytes
          FROM execution_result_artifact
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND manifest=${manifest}
         ORDER BY ordinal LIMIT 257`,
  );
  const outputs = configuredOutputs(asCanonicalConfiguration(canonical));
  return {
    manifest: asResultManifestId(row.manifest),
    attempt: asAttemptId(row.attempt),
    schemaVersion: row.schema_version,
    digest: asArtifactDigest(row.digest),
    verdict: resultVerdict(row.verdict),
    recordedAt: projectRowInstant(row.recorded_at, "recording time"),
    artifacts: artifacts.rows
      .slice(0, 256)
      .map((artifact) => artifactResource(artifact, outputs)),
    ...(row.report === null ? {} : { report: row.report }),
  };
}

/** One execution as the list answers it, from the row the list's own query reads. */
async function executionSummaryResource(
  pool: pg.Pool,
  partition: Partition,
  row: ExecutionViewRow,
): Promise<ExecutionSummary> {
  const [summary] = await executionPageAnswered(pool, partition, [
    executionSummary(row),
  ]);
  if (summary === undefined)
    throw new Error("operational read: execution summary is absent");
  return summary;
}

/** One execution whole: its summary, its attempts, and its result where it has one. */
async function executionResource(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
  reader: Principal,
): Promise<ExecutionResource | undefined> {
  const row = await oneExecution(pool, partition, execution, reader);
  if (row === undefined) return undefined;
  const result =
    row.result_manifest === null
      ? undefined
      : await resultResource(
          pool,
          partition,
          row.result_manifest,
          row.canonical,
        );
  if (row.result_manifest !== null && result === undefined)
    throw new Error("operational read: execution result is absent");
  return {
    ...(await executionSummaryResource(pool, partition, row)),
    attempts: await attempts(pool, partition, execution),
    ...(result === undefined ? {} : { result }),
  } satisfies ExecutionResource;
}

export function postgresOperationalReads(pool: pg.Pool): OperationalReadStore {
  return {
    status: async (partition) => {
      const found = await pool.query<StatusViewRow>(
        sql`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS observed_at,
                   queued::text,admitted::text,launching::text,running::text,
                   cluster_slots_max::text,cluster_active::text,
                   account_maximum::text,account_active::text,account_deficit::text
              FROM project_active_work(${partition.tenant},${partition.project})`,
      );
      const row = found.rows[0];
      if (row === undefined)
        throw new Error("operational read: status is absent");
      if (row.observed_at === null)
        throw new Error("operational read: observation time is absent");
      const count = (value: string | null, what: string) => {
        if (value === null)
          throw new Error(`operational read: ${what} is absent`);
        return projectRowCounter(value, what);
      };
      return {
        observedAt: asPublicInstant(row.observed_at),
        schedulerFreshness: "Unknown",
        queued: count(row.queued, "queued executions"),
        admitted: count(row.admitted, "admitted executions"),
        launching: count(row.launching, "launching executions"),
        running: count(row.running, "running executions"),
        clusterSlotsMax: count(row.cluster_slots_max, "cluster slots"),
        clusterActive: count(row.cluster_active, "cluster active"),
        accountMaximum: count(row.account_maximum, "account maximum"),
        accountActive: count(row.account_active, "account active"),
        accountReservationDeficit: count(
          row.account_deficit,
          "account deficit",
        ),
      };
    },
    executions: (partition, query, reader) =>
      executionPage(pool, partition, query, reader),
    latestExecutions: (partition, query, reader) =>
      latestExecutionPage(pool, partition, query, reader),
    ticketLatestExecutions: (partition, tickets, reader) =>
      ticketLatestExecutions(pool, partition, tickets, reader),
    execution: (partition, execution, reader) =>
      executionResource(pool, partition, execution, reader),
    executionSummary: async (partition, execution, reader) => {
      const row = await oneExecution(pool, partition, execution, reader);
      return row === undefined
        ? undefined
        : executionSummaryResource(pool, partition, row);
    },
  };
}
