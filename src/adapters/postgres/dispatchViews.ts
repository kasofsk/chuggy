import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  DispatchCandidate,
  DispatchViewPage,
  DispatchViewQuery,
  DispatchViewStore,
} from "../../interpreter/dispatchView.ts";
import {
  checkedDispatchViewQuery,
  dispatchViewDigest,
} from "../../interpreter/dispatchView.ts";
import { asTicketId } from "../../domain/ids.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";

interface HeaderRow {
  readonly has_view: boolean;
  readonly recovery_epoch: string;
  readonly watermark: string;
  readonly schema_version: number;
  readonly digest: string;
  readonly notification_cursor: string;
}

interface CandidateRow {
  readonly ticket: string;
  readonly ticket_version: string;
  readonly work_fanout: string;
  readonly program: string;
  readonly rework_policy: string;
  readonly finalization_pricing: string;
  readonly resume_pricing: string;
  readonly finalizer: string;
  readonly configuration_revision: string;
  readonly configuration_digest: string;
  readonly configuration_canonical: string;
}

function candidateResumePricing(
  value: string,
): DispatchCandidate["resumePricing"] {
  if (value === "RetryCharged" || value === "RetryFree") return value;
  throw new Error(`dispatch candidate row: unknown resume pricing ${value}`);
}

function candidateFinalizer(value: string): DispatchCandidate["finalizer"] {
  if (value === "NoFinalizer" || value === "ManagedFinalizer") return value;
  throw new Error(`dispatch candidate row: unknown finalizer ${value}`);
}

function candidateOf(
  row: CandidateRow,
  dependencies: readonly {
    readonly ticket: string;
    readonly dependency: string;
  }[],
): DispatchCandidate {
  const ticket = projectRowCounter(row.ticket, "dispatch ticket");
  return {
    ticket: asTicketId(ticket),
    ticketVersion: projectRowCounter(
      row.ticket_version,
      "dispatch ticket version",
    ),
    dependencies: dependencies
      .filter((edge) => Number(edge.ticket) === ticket)
      .map((edge) => projectRowCounter(edge.dependency, "dispatch dependency")),
    workFanout: projectRowCounter(row.work_fanout, "dispatch work fanout"),
    program: JSON.parse(row.program) as DispatchCandidate["program"],
    reworkPolicy: JSON.parse(
      row.rework_policy,
    ) as DispatchCandidate["reworkPolicy"],
    finalizationPricing: JSON.parse(
      row.finalization_pricing,
    ) as DispatchCandidate["finalizationPricing"],
    resumePricing: candidateResumePricing(row.resume_pricing),
    finalizer: candidateFinalizer(row.finalizer),
    configurationRevision: row.configuration_revision,
    configurationDigest: row.configuration_digest,
    configurationCanonical: row.configuration_canonical,
  };
}

async function viewHeader(
  client: pg.PoolClient,
  partition: Partition,
): Promise<HeaderRow | undefined> {
  const found = await client.query<HeaderRow>(
    sql`SELECT v.tenant IS NOT NULL AS has_view,
            coalesce(v.recovery_epoch,e.epoch) AS recovery_epoch,
            coalesce(v.watermark,p.head)::text AS watermark,
            coalesce(v.schema_version,1) AS schema_version,
            coalesce(v.digest,${dispatchViewDigest([])}) AS digest,
            (p.notification_next-1)::text AS notification_cursor
       FROM project p CROSS JOIN LATERAL
            (SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) e
       LEFT JOIN dispatch_view v USING (tenant,project)
      WHERE p.tenant=${partition.tenant} AND p.project=${partition.project}`,
  );
  return found.rows[0];
}

function tokenMatches(
  token: NonNullable<DispatchViewQuery["token"]>,
  partition: Partition,
  current: HeaderRow,
  watermark: number,
): boolean {
  return (
    token.tenant === partition.tenant &&
    token.project === partition.project &&
    token.recoveryEpoch === current.recovery_epoch &&
    token.schemaVersion === current.schema_version &&
    token.watermark === watermark &&
    token.digest === current.digest
  );
}

async function readDispatchView(
  pool: pg.Pool,
  partition: Partition,
  query: DispatchViewQuery,
): Promise<DispatchViewPage> {
  return postgresTransaction(pool, async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const current = await viewHeader(client, partition);
    if (current === undefined) return { result: "Reset" };
    const watermark = projectRowCounter(
      current.watermark,
      "dispatch view watermark",
    );
    if (!current.has_view && watermark > 0) return { result: "Reset" };
    if (
      query.token !== undefined &&
      !tokenMatches(query.token, partition, current, watermark)
    )
      return { result: "Reset" };
    const found = await client.query<CandidateRow>(
      sql`SELECT ticket::text,ticket_version::text,work_fanout::text,program,
              rework_policy,finalization_pricing,resume_pricing,finalizer,
            configuration_revision,configuration_digest,configuration_canonical
         FROM dispatch_candidate
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND ticket>${query.after ?? 0}
        ORDER BY ticket LIMIT ${query.limit + 1}`,
    );
    const pageRows = found.rows.slice(0, query.limit);
    const tickets = pageRows.map((row) =>
      projectRowCounter(row.ticket, "dispatch ticket"),
    );
    const dependencies =
      tickets.length === 0
        ? { rows: [] as { ticket: string; dependency: string }[] }
        : await client.query<{ ticket: string; dependency: string }>(
            sql`SELECT ticket::text,dependency::text FROM dispatch_candidate_dependency
            WHERE tenant=${partition.tenant} AND project=${partition.project}
              AND ticket=ANY(${tickets}::bigint[])
            ORDER BY ticket,dependency`,
          );
    const candidates = pageRows.map((row) =>
      candidateOf(row, dependencies.rows),
    );
    const hasMore = found.rows.length > query.limit;
    const nextAfter = hasMore ? candidates.at(-1)?.ticket : undefined;
    return {
      result: "Page",
      token: {
        ...partition,
        recoveryEpoch: current.recovery_epoch,
        schemaVersion: current.schema_version,
        watermark,
        digest: current.digest,
      },
      candidates,
      ...(nextAfter === undefined ? {} : { nextAfter }),
      notificationCursor: projectRowCounter(
        current.notification_cursor,
        "notification cursor",
      ),
    };
  });
}

export function postgresDispatchViews(pool: pg.Pool): DispatchViewStore {
  return {
    read: (partition, query) =>
      readDispatchView(
        pool,
        {
          tenant: asTenantId(partition.tenant),
          project: asProjectId(partition.project),
        },
        checkedDispatchViewQuery(query),
      ),
  };
}
