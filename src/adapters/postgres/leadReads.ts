import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionStates,
  asSessionId,
} from "../../interpreter/agentSession.ts";
import type {
  LeadReadStore,
  LeadStanding,
} from "../../interpreter/leadRead.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  sessionStoreBatchRows,
  sessionStoreStreamRows,
} from "./sessionStoreReads.ts";
import {
  sessionRowMember,
  sessionRowText,
  sessionTurnStandingOf,
  type SessionTurnStandingRow,
} from "./sessionRows.ts";

export type PostgresLeadReads = LeadReadStore;

interface LeadStandingRow extends SessionTurnStandingRow {
  readonly session: string | null;
  readonly session_state: string | null;
  readonly agent_reference: string | null;
}

function leadReadOf(
  rows: readonly LeadStandingRow[],
): LeadStanding | undefined {
  const head = rows[0];
  if (head === undefined) return undefined;
  return {
    session: asSessionId(sessionRowText(head.session, "session")),
    state: sessionRowMember(
      allSessionStates,
      head.session_state,
      "session state",
    ),
    ...(head.agent_reference === null
      ? {}
      : { agentReference: head.agent_reference }),
    turns: rows.flatMap((row) => {
      const turn = sessionTurnStandingOf(row);
      return turn === undefined ? [] : [turn];
    }),
  };
}

async function leadStanding(
  pool: pg.Pool,
  partition: Partition,
  turnsMax: number,
): Promise<LeadStanding | undefined> {
  const found = await pool.query<LeadStandingRow>(
    sql`SELECT session,session_state,agent_reference,
               turn,turn_ordinal::text AS turn_ordinal,input_kind,turn_state,
               failure,model,tokens::text AS tokens,
               cost_micros::text AS cost_micros,
               duration_ms::text AS duration_ms,tools,
               batch_first::text AS batch_first,batch_last::text AS batch_last
          FROM read_lead_standing(
                 ${partition.tenant},${partition.project},${turnsMax})`,
  );
  return leadReadOf(found.rows);
}

export function postgresLeadReads(pool: pg.Pool): LeadReadStore {
  return {
    standing: (partition, turnsMax) => leadStanding(pool, partition, turnsMax),
    batches: (query) => sessionStoreBatchRows(pool, query),
    streams: (partition, session, limit) =>
      sessionStoreStreamRows(pool, partition, session, limit),
  };
}
