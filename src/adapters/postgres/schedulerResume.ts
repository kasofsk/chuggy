/**
 * The execution scheduler's answer to an escalation whose tasks were lost on
 * the runners that claimed them: the resume a person would send at its desk.
 *
 * IT REACHES THE MAILBOX THROUGH `submit_runner_loss_resume`, as a completion
 * reaches it through `submit_task_completion`. What this file passes is the
 * ticket and the bounds; the function reads the desk and the loss under the
 * project lock, builds the answer itself and refuses one that is no longer a
 * runner loss under the bound, so a ticket read stale here resumes nothing.
 */

import { sql } from "@ts-safeql/sql-tag";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { asTicketId } from "../../domain/ids.ts";
import type {
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
  return found.rows.map((row) => {
    if (row.tenant === null || row.project === null || row.ticket === null)
      throw new Error("postgres scheduler: a lost ticket names no ticket");
    return {
      partition: {
        tenant: asTenantId(row.tenant),
        project: asProjectId(row.project),
      },
      ticket: asTicketId(projectRowCounter(row.ticket, "lost ticket")),
    };
  });
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
  const row = submitted.rows[0];
  if (row === undefined || submitted.rows.length !== 1)
    throw new Error(
      `postgres scheduler: the resume door returned ${String(submitted.rows.length)} rows`,
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
