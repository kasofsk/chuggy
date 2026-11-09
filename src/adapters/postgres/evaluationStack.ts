/**
 * PostgreSQL's side of the stack an evaluation runs over: the record written
 * once per ticket and work cycle, and the plain data `stackChoice.ts` chooses
 * from, gathered for one reference.
 *
 * STANDING IS DERIVED HERE AND STORED NOWHERE. A recorded stack's landings are
 * the finalization attempts promoted onto its reference since its tip, followed
 * as a chain: the first was prepared on the tip, each next on the commit the
 * one before landed. A proposal that is not merged has landed nothing. The
 * chain is read to one landing past the stack's depth, which is as far as a
 * prefix of it can reach.
 *
 * WHAT A LANDING WAS ACCEPTED AT IS THE COMMIT OF THE RESULT MANIFEST ITS
 * ATTEMPT'S BUNDLE PINNED, first by ordinal, which is where the failed-landing
 * read finds a change's commit.
 *
 * AN ENTRY IS READ AT THE WORK CYCLE OF ITS LATEST PASSED WORK. Its stack is
 * that cycle's record, so a cycle evaluated unstacked has none whatever an
 * earlier cycle recorded, and its evaluation phase is `Evaluation` once an
 * evaluation of that cycle is registered and `Ready` before.
 *
 * A REFERENCE WHOSE QUEUE IS LARGER THAN THE BOUND FAILS THE READ rather than
 * answering a part of it, because a stack chosen over part of a queue is
 * chosen over a queue that is not there.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { phaseRoster } from "../../contract/rosters.ts";
import { asTicketId } from "../../domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
  RemovableStack,
} from "../../interpreter/evaluationStack.ts";
import { asGitObjectId } from "../../interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import {
  stackDepthMax,
  type StackEntry,
  type StackMember,
  type StackPhase,
  type StackPolicy,
  type StackStanding,
} from "../../interpreter/stackChoice.ts";
import { briefLandsOn } from "../../interpreter/ticketBrief.ts";
import { finalizerRowPresent } from "./finalizerRows.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import { releasedBriefOf } from "./ticketBrief.ts";

/** The most ranked tickets one reference's queue is read at. */
const stackQueueEntriesMax = 256;

interface QueueRow {
  readonly ticket: string;
  readonly phase: string;
  readonly brief: string | null;
  readonly rank: string | null;
  readonly commit: string;
  readonly cycle: string;
  readonly evaluating: boolean;
}

interface RecordRow {
  readonly ticket: string;
  readonly work_cycle: string;
  readonly repository: string;
  readonly target_ref: string;
  readonly tip: string;
  readonly stack_commit: string;
  readonly stack_tree: string;
  readonly depth: number | null;
  readonly beneath_ticket: string | null;
  readonly beneath_commit: string | null;
}

interface RemovableRow {
  readonly tenant: string;
  readonly project: string;
  readonly ticket: string;
  readonly work_cycle: string;
  readonly repository: string;
}

interface LandingRow {
  readonly ticket: string;
  readonly accepted: string | null;
  readonly depth: number;
}

function stackPhaseOf(phase: string, evaluating: boolean): StackPhase {
  const known = phaseRoster.find((word) => word === phase);
  if (known === "Work") return "Work";
  if (known === "Evaluation") return evaluating ? "Evaluation" : "Ready";
  if (known === "Finalization") return "Pending";
  throw new Error(`evaluation stack: a ticket in ${phase} is in no queue`);
}

function stackRecordsOf(rows: readonly RecordRow[]): EvaluationStack[] {
  const byKey = new Map<string, EvaluationStack & { beneath: StackMember[] }>();
  for (const row of rows) {
    const key = `${row.ticket}/${row.work_cycle}`;
    let stack = byKey.get(key);
    if (stack === undefined) {
      stack = {
        ticket: asTicketId(projectRowCounter(row.ticket, "stack ticket")),
        cycle: projectRowCounter(row.work_cycle, "stack cycle"),
        repository: row.repository,
        target: row.target_ref,
        tip: asGitObjectId(row.tip),
        beneath: [],
        stackCommit: asGitObjectId(row.stack_commit),
        stackTree: asGitObjectId(row.stack_tree),
      };
      byKey.set(key, stack);
    }
    if (row.beneath_ticket !== null) {
      stack.beneath.push({
        ticket: asTicketId(projectRowCounter(row.beneath_ticket, "beneath")),
        commit: asGitObjectId(
          finalizerRowPresent(row.beneath_commit, "beneath commit"),
        ),
      });
    }
  }
  return [...byKey.values()];
}

async function stackRecordsRead(
  client: pg.Pool | pg.PoolClient,
  partition: Partition,
  tickets: readonly number[],
  cycles: readonly number[],
): Promise<EvaluationStack[]> {
  const found = await client.query<RecordRow>(
    sql`SELECT s.ticket::text AS ticket, s.work_cycle::text AS work_cycle,
               s.repository, s.target_ref, s.tip, s.stack_commit, s.stack_tree,
               b.depth, b.beneath_ticket::text AS beneath_ticket, b.beneath_commit
          FROM unnest(${tickets}::bigint[], ${cycles}::bigint[]) AS k(ticket, work_cycle)
          JOIN evaluation_stack s
            ON s.ticket = k.ticket AND s.work_cycle = k.work_cycle
          LEFT JOIN evaluation_stack_beneath b
            ON b.tenant = s.tenant AND b.project = s.project
           AND b.ticket = s.ticket AND b.work_cycle = s.work_cycle
         WHERE s.tenant = ${partition.tenant} AND s.project = ${partition.project}
         ORDER BY s.ticket, s.work_cycle, b.depth`,
  );
  return stackRecordsOf(found.rows);
}

/** The landings on a reference since `tip`, in order, at most `limit` of them. */
async function stackLandingsSince(
  pool: pg.Pool,
  partition: Partition,
  stack: EvaluationStack,
  limit: number,
): Promise<readonly StackMember[]> {
  const found = await pool.query<LandingRow>(
    sql`WITH RECURSIVE promoted AS (
          SELECT a.ticket, a.target_commit,
                 coalesce(c.merge_commit, a.candidate_commit) AS landed_commit,
                 (SELECT s.commit
                    FROM input_bundle_reference m
                    JOIN execution_result_source s
                      ON s.tenant = m.tenant AND s.project = m.project
                     AND s.manifest = m.reference_id
                   WHERE m.tenant = a.tenant AND m.project = a.project
                     AND m.bundle = a.input_bundle
                     AND m.reference_kind = 'ResultManifest'
                   ORDER BY m.ordinal
                   LIMIT 1) AS accepted
            FROM finalization_attempt a
            JOIN commit_permit p
              ON p.tenant = a.tenant AND p.project = a.project
             AND p.attempt = a.attempt
            JOIN finalization_reconciliation r
              ON r.tenant = p.tenant AND r.project = p.project
             AND r.permit = p.permit AND r.verdict = 'Promoted'
            LEFT JOIN finalization_change_proposal c
              ON c.tenant = a.tenant AND c.project = a.project
             AND c.request = a.request
           WHERE a.tenant = ${partition.tenant} AND a.project = ${partition.project}
             AND a.repository = ${stack.repository} AND a.target_ref = ${stack.target}
             AND (c.request IS NULL OR c.merge = 'Merged')
        ), chain AS (
          SELECT 1 AS depth, p.ticket, p.landed_commit, p.accepted
            FROM promoted p WHERE p.target_commit = ${stack.tip}
          UNION ALL
          SELECT n.depth + 1, p.ticket, p.landed_commit, p.accepted
            FROM chain n JOIN promoted p ON p.target_commit = n.landed_commit
           WHERE n.depth < ${limit}::integer
        )
        SELECT ticket::text AS ticket, accepted, depth FROM chain ORDER BY depth`,
  );
  const landings: StackMember[] = [];
  for (const row of found.rows) {
    if (row.depth !== landings.length + 1) {
      throw new Error(
        `evaluation stack: two landings follow ${stack.tip} at once`,
      );
    }
    landings.push({
      ticket: asTicketId(projectRowCounter(row.ticket, "landed ticket")),
      commit: asGitObjectId(finalizerRowPresent(row.accepted, "landed commit")),
    });
  }
  return landings;
}

export async function stackRecordWrite(
  client: pg.PoolClient,
  partition: Partition,
  stack: EvaluationStack,
): Promise<"Written" | "Present"> {
  if (stack.beneath.length < 1 || stack.beneath.length > stackDepthMax) {
    throw new RangeError(
      `evaluation stack: ${String(stack.beneath.length)} beneath is not a stack`,
    );
  }
  const written = await client.query(
    sql`INSERT INTO evaluation_stack
          (tenant, project, ticket, work_cycle, repository, target_ref, tip,
           stack_commit, stack_tree)
        VALUES (${partition.tenant}, ${partition.project}, ${stack.ticket},
                ${stack.cycle}, ${stack.repository}, ${stack.target}, ${stack.tip},
                ${stack.stackCommit}, ${stack.stackTree})
        ON CONFLICT (tenant, project, ticket, work_cycle) DO NOTHING`,
  );
  if (written.rowCount === 0) return "Present";
  for (const [at, member] of stack.beneath.entries()) {
    await client.query(
      sql`INSERT INTO evaluation_stack_beneath
            (tenant, project, ticket, work_cycle, depth, beneath_ticket, beneath_commit)
          VALUES (${partition.tenant}, ${partition.project}, ${stack.ticket},
                  ${stack.cycle}, ${at + 1}, ${member.ticket}, ${member.commit})`,
    );
  }
  return "Written";
}

/** The ranked-or-not tickets of one repository on the path to landing, as the database holds them. */
async function stackQueueRows(
  pool: pg.Pool,
  partition: Partition,
  repository: string,
): Promise<readonly QueueRow[]> {
  const found = await pool.query<QueueRow>(
    sql`SELECT d.ticket::text AS ticket, p.phase, d.brief::text AS brief,
               ticket_finalization_rank(d.tenant, d.project, d.ticket)::text AS rank,
               w.commit, w.cycle::text AS cycle,
               EXISTS (SELECT 1
                         FROM execution q
                         JOIN execution_request_task xt
                           ON xt.tenant = q.tenant AND xt.project = q.project
                          AND xt.request = q.source_request AND xt.task = q.task
                        WHERE q.tenant = d.tenant AND q.project = d.project
                          AND q.ticket = d.ticket AND xt.kind = 'Evaluation'
                          AND xt.cycle = w.cycle) AS evaluating
          FROM ticket_definition d
          JOIN ticket_projection p
            ON p.tenant = d.tenant AND p.project = d.project AND p.ticket = d.ticket
          JOIN LATERAL (
            SELECT s.commit, t.cycle
              FROM execution e
              JOIN execution_request_task t
                ON t.tenant = e.tenant AND t.project = e.project
                   AND t.request = e.source_request AND t.task = e.task
              JOIN execution_result r
                ON r.tenant = e.tenant AND r.project = e.project
                   AND r.execution = e.execution
              JOIN execution_result_source s
                ON s.tenant = r.tenant AND s.project = r.project
                   AND s.manifest = r.manifest
             WHERE e.tenant = d.tenant AND e.project = d.project
               AND e.ticket = d.ticket AND t.kind = 'Work'
               AND e.status = 'Terminal' AND e.outcome = 'Passed'
               AND r.verdict = 'Pass'
             ORDER BY t.cycle DESC, e.task DESC LIMIT 1) w ON true
         WHERE d.tenant = ${partition.tenant} AND d.project = ${partition.project}
           AND d.brief->>'landing' IN ('Serialized', 'Stacked')
           AND d.brief->'finalization'->>'mode' IN ('Push', 'PullRequestMerge')
           AND p.phase IN ('Work', 'Evaluation', 'Finalization')
           AND d.brief->>'repository' = ${repository}
         LIMIT ${stackQueueEntriesMax + 1}`,
  );
  if (found.rows.length > stackQueueEntriesMax) {
    throw new RangeError(
      `evaluation stack: ${repository} has more than ${String(stackQueueEntriesMax)} tickets on the path to landing`,
    );
  }
  return found.rows;
}

/** The rows of the reference asked, each with its policy and rank. */
function stackQueueRanked(
  rows: readonly QueueRow[],
  target: string | undefined,
): readonly { row: QueueRow; policy: StackPolicy; rank: string }[] {
  return rows.flatMap((row) => {
    const brief = releasedBriefOf(row.brief);
    const finalization = brief?.finalization;
    if (
      brief === undefined ||
      finalization?.kind !== "GitMerge" ||
      finalization.policy === "Direct" ||
      row.rank === null ||
      briefLandsOn(brief) !== target
    )
      return [];
    return [{ row, policy: finalization.policy, rank: row.rank }];
  });
}

async function stackQueueRead(
  pool: pg.Pool,
  partition: Partition,
  repository: string,
  target: string | undefined,
): Promise<readonly StackEntry[]> {
  const ranked = stackQueueRanked(
    await stackQueueRows(pool, partition, repository),
    target,
  );
  const records = await stackRecordsRead(
    pool,
    partition,
    ranked.map(({ row }) => Number(row.ticket)),
    ranked.map(({ row }) => Number(row.cycle)),
  );
  const entries: StackEntry[] = [];
  for (const { row, policy, rank } of ranked) {
    const ticket = asTicketId(projectRowCounter(row.ticket, "queued ticket"));
    const record = records.find(
      (candidate) =>
        candidate.ticket === ticket &&
        candidate.cycle === projectRowCounter(row.cycle, "queued cycle"),
    );
    entries.push({
      ticket,
      policy,
      phase: stackPhaseOf(row.phase, row.evaluating),
      rank: projectRowCounter(rank, "queue rank"),
      commit: asGitObjectId(row.commit),
      stack:
        record === undefined
          ? undefined
          : await stackStandingOf(pool, partition, record),
    });
  }
  return entries;
}

async function stackStandingOf(
  pool: pg.Pool,
  partition: Partition,
  record: EvaluationStack,
): Promise<StackStanding> {
  return {
    beneath: record.beneath,
    landings: await stackLandingsSince(
      pool,
      partition,
      record,
      record.beneath.length + 1,
    ),
  };
}

async function stackEvaluated(
  pool: pg.Pool,
  partition: Partition,
  ticket: number,
  cycle: number,
): Promise<boolean> {
  const found = await pool.query<{ found: number }>(
    sql`SELECT 1 AS found
              FROM execution_request r
              JOIN execution_request_task t
                ON t.tenant = r.tenant AND t.project = r.project
                   AND t.request = r.request
             WHERE r.tenant = ${partition.tenant} AND r.project = ${partition.project}
               AND r.ticket = ${ticket} AND t.kind = 'Evaluation'
               AND t.cycle = ${cycle}
             LIMIT 1`,
  );
  return found.rowCount !== 0;
}

async function stackRemovable(
  pool: pg.Pool,
  limit: number,
): Promise<readonly RemovableStack[]> {
  const found = await pool.query<RemovableRow>(
    sql`SELECT s.tenant, s.project, s.ticket::text AS ticket,
                   s.work_cycle::text AS work_cycle, s.repository
              FROM evaluation_stack s
              JOIN ticket_projection p
                ON p.tenant = s.tenant AND p.project = s.project
                   AND p.ticket = s.ticket
             WHERE NOT EXISTS (
                     SELECT 1 FROM evaluation_stack_removal r
                      WHERE r.tenant = s.tenant AND r.project = s.project
                        AND r.ticket = s.ticket AND r.work_cycle = s.work_cycle)
               AND (p.phase IN ('Done', 'Revoked')
                    OR EXISTS (
                      SELECT 1
                        FROM execution q
                        JOIN execution_request_task t
                          ON t.tenant = q.tenant AND t.project = q.project
                             AND t.request = q.source_request AND t.task = q.task
                       WHERE q.tenant = s.tenant AND q.project = s.project
                         AND q.ticket = s.ticket AND t.kind = 'Work'
                         AND t.cycle > s.work_cycle))
             ORDER BY s.recorded_at, s.ticket, s.work_cycle
             LIMIT ${limit}`,
  );
  return found.rows.map((row) => ({
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    ticket: asTicketId(projectRowCounter(row.ticket, "stack ticket")),
    cycle: projectRowCounter(row.work_cycle, "stack cycle"),
    repository: row.repository,
  }));
}

export function postgresEvaluationStack(pool: pg.Pool): EvaluationStackStore {
  return {
    record: (partition, stack) =>
      postgresTransaction(pool, (client) =>
        stackRecordWrite(client, partition, stack),
      ),
    read: async (partition, ticket, cycle) =>
      (await stackRecordsRead(pool, partition, [ticket], [cycle]))[0],
    evaluated: (partition, ticket, cycle) =>
      stackEvaluated(pool, partition, ticket, cycle),
    removable: (limit) => stackRemovable(pool, limit),
    remove: async (partition, ticket, cycle) => {
      const removed = await pool.query(
        sql`INSERT INTO evaluation_stack_removal (tenant, project, ticket, work_cycle)
            VALUES (${partition.tenant}, ${partition.project}, ${ticket}, ${cycle})
            ON CONFLICT (tenant, project, ticket, work_cycle) DO NOTHING`,
      );
      return removed.rowCount === 0 ? "Gone" : "Removed";
    },
    queue: (partition, repository, target) =>
      stackQueueRead(pool, partition, repository, target),
    stackFailures: async (partition, ticket) => {
      const found = await pool.query<{ failures: string | null }>(
        sql`SELECT ticket_stacked_failures(${partition.tenant}, ${partition.project},
                                           ${ticket})::text AS failures`,
      );
      return projectRowCounter(
        finalizerRowPresent(found.rows[0]?.failures ?? null, "failures"),
        "stacked failures",
      );
    },
  };
}
