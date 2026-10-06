/**
 * PostgreSQL reads for a ticket's action reach: where the ticket landed, what
 * its repository declares with the newest of what was reported, and the
 * successes beneath an action's newest.
 *
 * WHERE A TICKET LANDED IS READ THROUGH A DOOR, since the rows it is read from
 * are the finalizer's. The ticket is found first in the projection the API
 * already reads, so a ticket the project does not have is told from one that
 * landed nowhere.
 *
 * EACH ACTION'S NEWEST SUCCESS AND NEWEST REPORT ARE ONE INDEX READ APIECE,
 * and the successes beneath are the newest so many by ordinal and no more, so
 * no read here grows with a log's length.
 *
 * A STAMP IS COMPARED WHERE IT WAS WRITTEN. When the ticket landed goes back
 * to the database as the text it came out as, and the database says which
 * reports began after it.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { allActionReportOutcomes } from "../../contract/actionReport.ts";
import type {
  ActionReachEarlierSuccess,
  ActionReachNewest,
  ActionReachObservation,
} from "../../interpreter/actionReach.ts";
import type { TicketId } from "../../domain/ids.ts";
import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import type {
  RepositoryActionId,
  RepositoryActionName,
} from "../../interpreter/repositoryAction.ts";
import {
  asTicketLandedStamp,
  type ActionReachDeclared,
  type ActionReachEarlierQuery,
  type TicketActionReachStore,
  type TicketLanded,
} from "../../interpreter/ticketActionReach.ts";
import { projectRowCounter } from "./rows.ts";

/** One report as a read here selects it, every column nullable because a read reaches it through an outer join or an expression. */
interface ActionReachObservationRow {
  readonly ordinal: string | null;
  readonly outcome: string | null;
  readonly repository_commit: string | null;
  readonly observed_at: string | null;
  readonly received_at: string | null;
  readonly detail: string | null;
  readonly link: string | null;
}

function actionReachObservation(
  row: ActionReachObservationRow,
): ActionReachObservation {
  const outcome = allActionReportOutcomes.find((each) => each === row.outcome);
  if (
    row.ordinal === null ||
    outcome === undefined ||
    row.repository_commit === null ||
    row.received_at === null
  )
    throw new Error("action reach read returned a partial report");
  return {
    ordinal: projectRowCounter(row.ordinal, "action observation ordinal"),
    outcome,
    commit: asGitObjectId(row.repository_commit),
    receivedAt: asPublicInstant(row.received_at),
    ...(row.observed_at === null
      ? {}
      : { observedAt: asPublicInstant(row.observed_at) }),
    ...(row.detail === null ? {} : { detail: row.detail }),
    ...(row.link === null ? {} : { link: row.link }),
  };
}

async function actionReachLanded(
  pool: pg.Pool,
  partition: Partition,
  ticket: TicketId,
): Promise<TicketLanded | undefined> {
  const found = await pool.query<{
    repository: string | null;
    recovery_epoch: string | null;
    retired: boolean | null;
    repository_commit: string | null;
    landed_after: string | null;
  }>(
    sql`SELECT l.repository,l.recovery_epoch,l.retired,l.repository_commit,
               l.landed_after::text AS landed_after
          FROM ticket_projection t
          LEFT JOIN LATERAL read_ticket_landed_commit(t.tenant,t.project,t.ticket) l
            ON true
         WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
           AND t.ticket=${ticket}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  if (row.repository_commit === null) return { landed: "Nowhere" };
  if (
    row.repository === null ||
    row.recovery_epoch === null ||
    row.retired === null ||
    row.landed_after === null
  )
    throw new Error("ticket landed read returned a partial landing");
  return {
    landed: "At",
    repository: {
      partition,
      repository: asRepositoryId(row.repository),
      recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
    },
    retired: row.retired,
    commit: asGitObjectId(row.repository_commit),
    since: asTicketLandedStamp(row.landed_after),
  };
}

/** One declared action beside one of its newest reports, `newest` saying which and nothing where none was reported. */
interface ActionReachDeclaredRow extends ActionReachObservationRow {
  readonly action: string;
  readonly name: string;
  readonly newest: string | null;
}

/** What an action's newest reports are once one more row is read into them. */
function actionReachNewestWith(
  held: ActionReachNewest,
  row: ActionReachDeclaredRow,
): ActionReachNewest {
  switch (row.newest) {
    case null:
      return held;
    case "success":
      return { ...held, success: actionReachObservation(row) };
    case "report":
      return { ...held, report: actionReachObservation(row) };
    default:
      throw new Error("action reach read returned a report it did not ask for");
  }
}

/** Folds the rows of one read into its actions, in the order they came, each with whichever newest reports it has. */
function actionReachDeclared(
  rows: readonly ActionReachDeclaredRow[],
): readonly ActionReachDeclared[] {
  const declared = new Map<string, ActionReachDeclared>();
  for (const row of rows)
    declared.set(row.action, {
      action: row.action as RepositoryActionId,
      name: row.name as RepositoryActionName,
      newest: actionReachNewestWith(
        declared.get(row.action)?.newest ?? {},
        row,
      ),
    });
  return [...declared.values()];
}

async function actionReachDeclares(
  pool: pg.Pool,
  partition: Partition,
  repository: RepositoryId,
): Promise<readonly ActionReachDeclared[]> {
  const found = await pool.query<ActionReachDeclaredRow>(
    sql`SELECT a.action,a.name,o.newest,o.ordinal::text AS ordinal,o.outcome,
               o.reported_commit AS repository_commit,
               to_char(o.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS observed_at,
               to_char(o.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS received_at,
               o.detail,o.link
          FROM repository_action a
          LEFT JOIN LATERAL (
            (SELECT 'success' AS newest,s.ordinal,s.outcome,
                    s.repository_commit AS reported_commit,
                    s.observed_at,s.received_at,s.detail,s.link
               FROM action_observation s
              WHERE s.tenant=a.tenant AND s.project=a.project
                AND s.action=a.action AND s.outcome='Succeeded'
              ORDER BY s.ordinal DESC LIMIT 1)
            UNION ALL
            (SELECT 'report',n.ordinal,n.outcome,n.repository_commit,
                    n.observed_at,n.received_at,n.detail,n.link
               FROM action_observation n
              WHERE n.tenant=a.tenant AND n.project=a.project
                AND n.action=a.action
              ORDER BY n.ordinal DESC LIMIT 1)
          ) o ON true
         WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
           AND a.repository=${repository}
         ORDER BY a.action`,
  );
  return actionReachDeclared(found.rows);
}

/** One success beneath an action's newest, its own columns as the relation holds them, and whether it was reported since a stamp. */
interface ActionReachEarlierRow extends ActionReachObservationRow {
  readonly ordinal: string;
  readonly outcome: string;
  readonly repository_commit: string;
  readonly since_landed: boolean | null;
}

async function actionReachEarlier(
  pool: pg.Pool,
  query: ActionReachEarlierQuery,
): Promise<readonly ActionReachEarlierSuccess[]> {
  const { tenant, project } = query.partition;
  const found = await pool.query<ActionReachEarlierRow>(
    sql`SELECT o.ordinal::text AS ordinal,o.outcome,o.repository_commit,
               to_char(o.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS observed_at,
               to_char(o.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS received_at,
               o.detail,o.link,
               o.received_at > ${query.since}::timestamp with time zone AS since_landed
          FROM action_observation o
         WHERE o.tenant=${tenant} AND o.project=${project}
           AND o.action=${query.action} AND o.outcome='Succeeded'
           AND o.ordinal < ${query.beneath}
         ORDER BY o.ordinal DESC LIMIT ${query.count}`,
  );
  return found.rows.map((row): ActionReachEarlierSuccess => ({
    observation: actionReachObservation(row),
    sinceLanded: row.since_landed === true,
  }));
}

export function postgresTicketActionReach(
  pool: pg.Pool,
): TicketActionReachStore {
  return {
    landed: (partition, ticket) => actionReachLanded(pool, partition, ticket),
    declared: (partition, repository) =>
      actionReachDeclares(pool, partition, repository),
    earlier: (query) => actionReachEarlier(pool, query),
  };
}
