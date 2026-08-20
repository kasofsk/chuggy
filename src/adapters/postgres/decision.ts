/**
 * The decision transaction: the journal entry, the operation outcome, the
 * inbox acknowledgement and the projection, or none of them.
 *
 * THE CAUSE IS LOCKED AND READ BEFORE ANY FENCE IS CHECKED. A writer whose
 * commit was acknowledged by nobody retries with the head it held before that
 * commit, so asking the head first would answer `StaleHead` to the one caller
 * whose question is whether its own decision landed. Reading the operation
 * first is what
 * `docs/design/006-durable-project-dispatch.md` means by resolving an
 * ambiguous commit from the durable record rather than assuming failure, and
 * a still-pending operation falls through to the fences and is decided again.
 *
 * THE PROJECT ROW IS LOCKED FIRST AND THE OPERATION SECOND, always. Acceptance
 * takes the project row and inserts an operation nobody else holds;
 * cancellation takes the operation row alone. No two of the three can wait on
 * each other in a cycle, which is what makes the order worth fixing rather
 * than the fastest order worth taking.
 *
 * A REFUSAL SETTLES AND ACKNOWLEDGES AND WRITES NOTHING ELSE. There is no
 * entry, so the head does not move and the projection is untouched; the
 * settling authority is recorded because a refusal has no entry to carry the
 * owner and the fencing epoch that produced it.
 *
 * THE PROJECTION IS UPSERTED BY THE ROWS THE DECISION CHANGED. Its sequence is
 * the entry's, which is what lets a read say which decision it is looking at,
 * and a ticket the decision left alone keeps the sequence that last moved it.
 */

import type pg from "pg";

import { assertNever } from "../../domain/assertNever.ts";
import type { OperationId } from "../../interpreter/operationInbox.ts";
import {
  allRefusalCodes,
  projectWriterAuthorityKind,
  type Decided,
  type Decision,
  type DecisionOutcome,
  type OperationOutcome,
  type RefusalCode,
  type TicketProjection,
} from "../../interpreter/projectDecision.ts";
import type { Lease, Partition } from "../../interpreter/projectStore.ts";
import { postgresJournalWrite } from "./journal.ts";
import {
  postgresOwnershipHonours,
  postgresOwnershipLockKnown,
} from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter, projectRowStanding } from "./rows.ts";

/** One operation row as the decision transaction reads it, under the lock it just took. */
interface DecisionCauseRow {
  readonly state: string;
  readonly outcome_code: string | null;
  readonly decided_seq: string | null;
}

/** Narrows an outcome code column to the closed set, refusing a value no decision can have written. */
function decisionRefusalCode(value: string): RefusalCode {
  const found = allRefusalCodes.find((code) => code === value);
  if (found === undefined) {
    throw new Error(
      `decision row: ${value} is not a refusal code this code knows`,
    );
  }
  return found;
}

/** What a settled operation says about itself, refusing a row whose state and outcome disagree. */
function decisionOutcomeOf(row: DecisionCauseRow): OperationOutcome {
  if (row.state === "Cancelled") return { settled: "Cancelled" };
  if (row.state === "Refused" && row.outcome_code !== null) {
    return { settled: "Refused", code: decisionRefusalCode(row.outcome_code) };
  }
  if (row.state === "Succeeded" && row.decided_seq !== null) {
    return {
      settled: "Succeeded",
      seq: projectRowCounter(row.decided_seq, "decided sequence"),
    };
  }
  throw new Error(
    `decision row: a ${row.state} operation carries no outcome, which no settlement writes`,
  );
}

/** Locks the cause and reads it, refusing a partition that has no such operation. */
async function decisionLockCause(
  client: pg.PoolClient,
  partition: Partition,
  cause: OperationId,
): Promise<DecisionCauseRow> {
  const found = await client.query<DecisionCauseRow>(
    `SELECT state, outcome_code, decided_seq FROM operation
      WHERE tenant = $1 AND project = $2 AND operation = $3
      FOR UPDATE`,
    [partition.tenant, partition.project, cause],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres decision: ${partition.tenant}/${partition.project} has no operation ${cause} to decide`,
    );
  }
  return row;
}

/** Settles the operation and makes its inbox item non-consumable, which together are the acknowledgement. */
async function decisionSettle(
  client: pg.PoolClient,
  lease: Lease,
  cause: OperationId,
  settled: OperationOutcome,
): Promise<void> {
  const succeeded = settled.settled === "Succeeded";
  await client.query(
    `UPDATE operation
        SET state = $4, settled_at = now(),
            settled_authority_kind = $5, settled_authority_subject = $6,
            decided_seq = $7, outcome_code = $8
      WHERE tenant = $1 AND project = $2 AND operation = $3`,
    [
      lease.partition.tenant,
      lease.partition.project,
      cause,
      settled.settled,
      projectWriterAuthorityKind,
      lease.owner,
      succeeded ? settled.seq : null,
      settled.settled === "Refused" ? settled.code : null,
    ],
  );
  await client.query(
    `UPDATE inbox_item SET consumable = false
      WHERE tenant = $1 AND project = $2 AND operation = $3`,
    [lease.partition.tenant, lease.partition.project, cause],
  );
}

/** Upserts the rows this decision moved, each carrying the sequence that moved it. */
async function decisionProject(
  client: pg.PoolClient,
  partition: Partition,
  seq: number,
  projection: readonly TicketProjection[],
): Promise<void> {
  for (const row of projection) {
    await client.query(
      `INSERT INTO ticket_projection (tenant, project, ticket, phase, seq)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant, project, ticket)
       DO UPDATE SET phase = EXCLUDED.phase, seq = EXCLUDED.seq`,
      [partition.tenant, partition.project, row.ticket, row.phase, seq],
    );
  }
}

/** Writes everything the decision asks for, and answers with the lease its commit advanced. */
async function decisionApply(
  client: pg.PoolClient,
  lease: Lease,
  cause: OperationId,
  outcome: DecisionOutcome,
): Promise<Decided> {
  switch (outcome.outcome) {
    case "Refused":
      await decisionSettle(client, lease, cause, {
        settled: "Refused",
        code: outcome.code,
      });
      return { decided: "Refused" };
    case "Journaled": {
      const seq = outcome.entry.seq;
      await postgresJournalWrite(client, lease, outcome.entry, cause);
      await decisionSettle(client, lease, cause, {
        settled: "Succeeded",
        seq,
      });
      await decisionProject(client, lease.partition, seq, outcome.projection);
      return { decided: "Committed", lease: { ...lease, head: seq } };
    }
    default:
      return assertNever(outcome);
  }
}

/** Commits one decision under the locked partition row, or names the fence that stopped it. */
export async function postgresDecisionCommit(
  pool: pg.Pool,
  decision: Decision,
): Promise<Decided> {
  const lease = decision.lease;
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    const cause = await decisionLockCause(
      client,
      lease.partition,
      decision.cause,
    );
    if (cause.state !== "Pending") {
      return { decided: "AlreadyTerminal", outcome: decisionOutcomeOf(cause) };
    }
    const standing = projectRowStanding(row);
    if (standing.lifecycle !== "Active") {
      return { decided: "NotActive", lifecycle: standing.lifecycle };
    }
    if (!(await postgresOwnershipHonours(client, row, lease))) {
      return { decided: "Fenced", fencingEpoch: standing.fencingEpoch };
    }
    if (standing.head !== lease.head) {
      return { decided: "StaleHead", head: standing.head };
    }
    return decisionApply(client, lease, decision.cause, decision.outcome);
  });
}
