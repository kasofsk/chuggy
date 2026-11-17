/** PostgreSQL side of a ticket's takes and returns: one call of `take_ticket`, which takes the project's lock and decides. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { ticketTakeOutcomes } from "../../contract/rosters.ts";
import type { TicketId } from "../../domain/ids.ts";
import type { Authority } from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  ticketTakeStoreRefusals,
  type TicketTakeKind,
  type TicketTakeStore,
  type TicketTakeStored,
} from "../../interpreter/ticketTake.ts";

interface TicketTakeRow {
  readonly outcome: string | null;
  readonly owner: string | null;
}

/** What the door's one row says, refusing an outcome it does not know. */
function ticketTakeStoredOf(row: TicketTakeRow | undefined): TicketTakeStored {
  if (row?.outcome === undefined || row.outcome === null)
    throw new Error("postgres ticket take: the door answered no outcome");
  if (row.outcome === "MissingTicket") return { stored: "MissingTicket" };
  const outcome = ticketTakeOutcomes.find((known) => known === row.outcome);
  if (outcome !== undefined)
    return {
      stored: outcome,
      ...(row.owner === null ? {} : { owner: row.owner }),
    };
  const reason = ticketTakeStoreRefusals.find((known) => known === row.outcome);
  if (reason === undefined)
    throw new Error(`postgres ticket take: the door answered ${row.outcome}`);
  return { stored: "Refused", reason };
}

async function ticketTakeWrite(
  pool: Pick<pg.Pool, "query">,
  partition: Partition,
  ticket: TicketId,
  kind: TicketTakeKind,
  authority: Authority,
): Promise<TicketTakeStored> {
  const found = await pool.query<TicketTakeRow>(
    sql`SELECT result_outcome AS outcome,result_owner AS owner
          FROM take_ticket(${partition.tenant},${partition.project},${ticket}::bigint,
                           ${kind},${authority.kind},${authority.subject})`,
  );
  return ticketTakeStoredOf(found.rows[0]);
}

export function postgresTicketTakes(pool: pg.Pool): TicketTakeStore {
  return {
    write: (partition, ticket, kind, authority) =>
      ticketTakeWrite(pool, partition, ticket, kind, authority),
  };
}
