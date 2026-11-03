/**
 * The execution scheduler's answer to an escalation whose tasks were lost on
 * the runners that claimed them, or stopped there by a usage limit: the resume
 * a person would send at its desk.
 *
 * IT REACHES THE MAILBOX THROUGH `submit_runner_loss_resume` OR
 * `submit_rate_limit_resume`, as a completion reaches it through
 * `submit_task_completion`. What this file passes is the ticket and the
 * bounds; the function reads the desk and the tasks under the project lock,
 * builds the answer itself and refuses one no longer resumable under its rule,
 * so a ticket read stale here resumes nothing.
 */

import { sql } from "@ts-safeql/sql-tag";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { asTicketId } from "../../domain/ids.ts";
import type {
  RateLimitedTicket,
  RateLimitResume,
  RunnerLossResume,
  RunnerLossResumed,
  RunnerLostTicket,
} from "../../interpreter/executionScheduler.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { projectRowCounter } from "./rows.ts";
import { schedulerRole } from "./schema.ts";

interface RunnerLostTicketRow {
  readonly tenant: string | null;
  readonly project: string | null;
  readonly ticket: string | null;
}

/** The escalated tickets whose tasks were lost fewer than `lossesMax` times, project by project and each project's oldest desk first. */
export async function schedulerRunnerLostTickets(
  pool: pg.Pool,
  lossesMax: number,
  ticketsMax: number,
): Promise<readonly RunnerLostTicket[]> {
  const found = await pool.query<RunnerLostTicketRow>(
    sql`SELECT tenant, project, ticket::text AS ticket
          FROM runner_lost_tickets(${lossesMax}::bigint, ${ticketsMax}::integer)`,
  );
  return found.rows.map((row) => schedulerResumeTicket(row, "lost ticket"));
}

/** The escalated tickets a usage limit stopped that may run again under both bounds, in the order `schedulerRunnerLostTickets` answers its own. */
export async function schedulerRateLimitedTickets(
  pool: pg.Pool,
  lossesMax: number,
  rateLimitsMax: number,
  ticketsMax: number,
): Promise<readonly RateLimitedTicket[]> {
  const found = await pool.query<RunnerLostTicketRow>(
    sql`SELECT tenant, project, ticket::text AS ticket
          FROM rate_limited_tickets(${lossesMax}::bigint,
            ${rateLimitsMax}::bigint, ${ticketsMax}::integer)`,
  );
  return found.rows.map((row) =>
    schedulerResumeTicket(row, "rate-limited ticket"),
  );
}

/** The ticket a row of either finder names. */
function schedulerResumeTicket(
  row: RunnerLostTicketRow,
  label: string,
): RunnerLostTicket {
  if (row.tenant === null || row.project === null || row.ticket === null)
    throw new Error(`postgres scheduler: a ${label} names no ticket`);
  return {
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    ticket: asTicketId(projectRowCounter(row.ticket, label)),
  };
}

interface RunnerLossResumeRow {
  readonly result: string | null;
  readonly operation: string | null;
}

/** The operation an answer the mailbox kept names. */
function schedulerResumeOperation(row: RunnerLossResumeRow): string {
  if (row.operation === null)
    throw new Error(
      `postgres scheduler: an answer the mailbox kept as ${String(row.result)} names no operation`,
    );
  return row.operation;
}

/** Answers one lost ticket's escalation through the door, under a fresh operation identity. */
export async function schedulerResumeRunnerLoss(
  pool: pg.Pool,
  resume: RunnerLossResume,
): Promise<RunnerLossResumed> {
  const { partition, ticket } = resume.ticket;
  const operation = `resume-${randomUUID()}`;
  const submitted = await pool.query<RunnerLossResumeRow>(
    sql`SELECT result, operation FROM submit_runner_loss_resume(
          ${partition.tenant},${partition.project},${ticket}::bigint,
          ${resume.lossesMax}::bigint,${operation},${schedulerRole},
          ${resume.mailbox.ordinarySoftLimit}::bigint,
          ${resume.mailbox.mailboxHardLimit}::bigint)`,
  );
  return schedulerResumeAnswered(submitted.rows);
}

/** Answers one rate-limited ticket's escalation through its door, under a fresh operation identity. */
export async function schedulerResumeRateLimit(
  pool: pg.Pool,
  resume: RateLimitResume,
): Promise<RunnerLossResumed> {
  const { partition, ticket } = resume.ticket;
  const operation = `resume-${randomUUID()}`;
  const submitted = await pool.query<RunnerLossResumeRow>(
    sql`SELECT result, operation FROM submit_rate_limit_resume(
          ${partition.tenant},${partition.project},${ticket}::bigint,
          ${resume.lossesMax}::bigint,${resume.rateLimitsMax}::bigint,
          ${operation},${schedulerRole},
          ${resume.mailbox.ordinarySoftLimit}::bigint,
          ${resume.mailbox.mailboxHardLimit}::bigint)`,
  );
  return schedulerResumeAnswered(submitted.rows);
}

/** What either door's one row says the mailbox did with the answer. */
function schedulerResumeAnswered(
  rows: readonly RunnerLossResumeRow[],
): RunnerLossResumed {
  const row = rows[0];
  if (row === undefined || rows.length !== 1)
    throw new Error(
      `postgres scheduler: the resume door returned ${String(rows.length)} rows`,
    );
  switch (row.result) {
    case "Accepted":
      return {
        resumed: "Submitted",
        operation: asOperationId(schedulerResumeOperation(row)),
      };
    case "Original":
      return {
        resumed: "AlreadySubmitted",
        operation: asOperationId(schedulerResumeOperation(row)),
      };
    case "NotResumable":
      return { resumed: "NotResumable" };
    case "Backpressure":
    case "Unavailable":
      return { resumed: "Backpressure" };
    case "NotAdmitted":
      return { resumed: "NotAdmitted" };
    case null:
    default:
      throw new Error(
        `postgres scheduler: the resume door answered ${String(row.result)}`,
      );
  }
}
