import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asTaskId, asTicketId } from "../../domain/ids.ts";
import {
  asConfigurationRevisionId,
  asCanonicalConfiguration,
} from "../../interpreter/authoring.ts";
import {
  allAttemptStates,
  allExecutionOutcomes,
  allExecutionStatuses,
  attemptEvidenceLabel,
  type ExecutionStatus,
} from "../../interpreter/executionScheduler.ts";
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
  type OperationalReadStore,
  type OutputDefinition,
  type ResultArtifactResource,
} from "../../interpreter/operationsView.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
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
import { projectRowCounter } from "./rows.ts";
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
  readonly stage: string | null;
  readonly cluster: string;
  readonly configuration_revision: string;
  readonly requirement_identity: string;
  readonly requirement_value: unknown;
  readonly requirement_digest: string;
  readonly requirement_source: string;
  readonly source_request: string;
  readonly platform_default_version: string;
  readonly canonical: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly retries_spent: string;
  readonly registered_at: string;
  readonly terminal_at: string | null;
  readonly result_manifest: string | null;
}

interface AttemptViewRow {
  readonly attempt: string;
  readonly attempt_number: string;
  readonly generation: string;
  readonly state: string;
  readonly opened_at: string;
  readonly ended_at: string | null;
  readonly evidence: string | null;
}

interface ResultViewRow {
  readonly manifest: string;
  readonly attempt: string;
  readonly schema_version: number;
  readonly digest: string;
  readonly verdict: string;
  readonly recorded_at: string;
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

function executionSummary(row: ExecutionViewRow): ExecutionSummary {
  const configurationVersion = configurationVersionOf(row);
  return {
    execution: asExecutionId(row.execution),
    ticket: asTicketId(projectRowCounter(row.ticket, "execution ticket")),
    task: asTaskId(projectRowCounter(row.task, "execution task")),
    taskKind: taskKind(row.task_kind),
    ...(row.stage === null
      ? {}
      : { stage: projectRowCounter(row.stage, "execution task stage") }),
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
    registeredAt: asPublicInstant(row.registered_at),
    ...(row.terminal_at === null
      ? {}
      : { terminalAt: asPublicInstant(row.terminal_at) }),
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
    openedAt: asPublicInstant(row.opened_at),
    ...(row.ended_at === null
      ? {}
      : { endedAt: asPublicInstant(row.ended_at) }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(run === undefined ? {} : { run }),
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

async function executionRows(
  pool: pg.Pool,
  partition: Partition,
  query: ExecutionListQuery,
): Promise<readonly ExecutionViewRow[]> {
  const found = await pool.query<ExecutionViewRow>(
    sql`SELECT e.execution,e.ticket::text AS ticket,e.task::text AS task,
               t.kind AS task_kind,t.stage::text AS stage,e.cluster,
               e.configuration_revision,e.requirement_identity,e.requirement_value,
               e.requirement_digest,e.requirement_source,e.source_request,
               e.platform_default_version::text AS platform_default_version,
               c.canonical,e.status,e.outcome,
               e.retries_spent::text AS retries_spent,
               e.registered_at::text AS registered_at,e.terminal_at::text AS terminal_at,
               e.result_manifest,
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
         WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
           AND e.execution>${query.after ?? ""}
           AND (${query.ticket ?? null}::bigint IS NULL OR e.ticket=${query.ticket ?? null})
           AND e.status=ANY(${[...selectedStatuses(query)]}::text[])
         ORDER BY e.execution LIMIT ${query.limit + 1}`,
  );
  return found.rows;
}

async function executionPage(
  pool: pg.Pool,
  partition: Partition,
  query: ExecutionListQuery,
): Promise<ExecutionPage> {
  const rows = await executionRows(pool, partition, query);
  const page = rows.slice(0, query.limit);
  const next = rows.length > query.limit ? page.at(-1) : undefined;
  const summaries = page.map(executionSummary);
  const workers = await postgresWorkerCatalog(
    pool,
    executionSummaryImages(summaries),
  );
  const totals = await postgresExecutionRunTotals(
    pool,
    partition,
    summaries.map((summary) => summary.execution),
  );
  return {
    executions: summaries.map((summary) =>
      executionSummaryTotalled(
        executionSummaryLabelled(summary, workers),
        totals,
      ),
    ),
    ...(next === undefined ? {} : { nextAfter: asExecutionId(next.execution) }),
  };
}

async function oneExecution(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
): Promise<ExecutionViewRow | undefined> {
  const found = await pool.query<ExecutionViewRow>(
    sql`SELECT e.execution,e.ticket::text AS ticket,e.task::text AS task,
               t.kind AS task_kind,t.stage::text AS stage,e.cluster,
               e.configuration_revision,e.requirement_identity,e.requirement_value,
               e.requirement_digest,e.requirement_source,e.source_request,
               e.platform_default_version::text AS platform_default_version,
               c.canonical,e.status,e.outcome,
               e.retries_spent::text AS retries_spent,
               e.registered_at::text AS registered_at,e.terminal_at::text AS terminal_at,
               e.result_manifest,
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
    sql`SELECT attempt,attempt_number::text AS attempt_number,
               generation::text AS generation,state,opened_at::text AS opened_at,
               ended_at::text AS ended_at,evidence
          FROM execution_attempt
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND execution=${execution}
         ORDER BY execution_attempt.attempt_number LIMIT 100`,
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
               r.recorded_at::text AS recorded_at,p.report
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
    recordedAt: asPublicInstant(row.recorded_at),
    artifacts: artifacts.rows
      .slice(0, 256)
      .map((artifact) => artifactResource(artifact, outputs)),
    ...(row.report === null ? {} : { report: row.report }),
  };
}

export function postgresOperationalReads(pool: pg.Pool): OperationalReadStore {
  return {
    status: async (partition) => {
      const found = await pool.query<StatusViewRow>(
        sql`SELECT transaction_timestamp()::text AS observed_at,
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
    executions: (partition, query) => executionPage(pool, partition, query),
    execution: async (partition, execution) => {
      const row = await oneExecution(pool, partition, execution);
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
      const summary = executionSummary(row);
      return {
        ...executionSummaryTotalled(
          executionSummaryLabelled(
            summary,
            await postgresWorkerCatalog(
              pool,
              executionSummaryImages([summary]),
            ),
          ),
          await postgresExecutionRunTotals(pool, partition, [execution]),
        ),
        attempts: await attempts(pool, partition, execution),
        ...(result === undefined ? {} : { result }),
      } satisfies ExecutionResource;
    },
  };
}
