/**
 * The provisioning half of an agent session against PostgreSQL: opening one,
 * closing one, giving one a turn, and reading back the row and the mailbox
 * those three wrote.
 *
 * EVERY MOVE IS ONE SERVER FUNCTION AND THIS FILE DECIDES NOTHING. A session's
 * uniqueness rules — one lead per project, one open thread per member, an
 * inquiry's parent — are partial indexes and a boundary body, so an adapter
 * that checked them first would be a second opinion racing the first. The
 * account and cluster a session draws are not arguments either: the server
 * takes them from the project's own capacity account, because a caller naming
 * them could name another project's.
 *
 * THE PORTS ARE DECLARED HERE RATHER THAN IN THE INTERPRETER because the plan
 * this slice implements gives these three doors a SQL signature and no
 * TypeScript shape, and inventing one in a module another unit owns would be
 * two units editing one file. A later slice that needs a second implementation
 * is what moves them.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  type SessionId,
  type SessionKind,
  type SessionTurn,
  type SessionTurnInputKind,
  type AgentSession,
  type SessionCapability,
} from "../../interpreter/agentSession.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { projectRowCounter } from "./rows.ts";
import { agentSessionRowOf, sessionTurnRowOf } from "./sessionRows.ts";

/** What opening a session answers: it is open now, it already was, or it is not this one. */
export type AgentSessionOpened = "Opened" | "AlreadyOpen" | "Conflict";

/** What one session is opened as, which is everything the row carries that is not derived. */
export interface AgentSessionOpening {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly kind: SessionKind;
  readonly principal: Principal;
  readonly parent?: SessionId;
  readonly capabilities: readonly SessionCapability[];
  readonly credentialSlot: string;
}

/** One turn offered to a session's mailbox. */
export interface SessionTurnOffering {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly turn: SessionTurn["turn"];
  readonly inputKind: SessionTurnInputKind;
  readonly input: string;
}

/** What enqueuing answered, carrying the ordinal only where the turn has one. */
export type SessionTurnEnqueued =
  | {
      readonly enqueued: "Enqueued" | "AlreadyEnqueued";
      readonly ordinal: number;
    }
  | { readonly enqueued: "Closed" | "Backlogged" };

/** Who the pool connected as, and whether that identity may open a session at all. */
export interface AgentSessionWriter {
  readonly role: string;
  readonly canExecute: boolean;
}

/** The durable session authority a provisioning command drives. */
export interface AgentSessionStore {
  /** The privilege the three doors need, asked of the server rather than of a role name. */
  writer(): Promise<AgentSessionWriter>;

  open(opening: AgentSessionOpening): Promise<AgentSessionOpened>;

  /** Closes one open session, abandoning every turn it had not finished. */
  close(partition: Partition, session: SessionId): Promise<boolean>;

  enqueue(offering: SessionTurnOffering): Promise<SessionTurnEnqueued>;

  session(
    partition: Partition,
    session: SessionId,
  ): Promise<AgentSession | undefined>;

  /** The session's mailbox in ordinal order, at most `turnsMax` of it. */
  turns(
    partition: Partition,
    session: SessionId,
    turnsMax: number,
  ): Promise<readonly SessionTurn[]>;
}

/**
 * The two relations read straight rather than through a boundary, where the
 * server declares every column the relation does. The shared row shapes admit a
 * null in each, because a set-returning function's columns are nullable to the
 * query checker.
 */
interface AgentSessionStoredRow {
  readonly tenant: string;
  readonly project: string;
  readonly session: string;
  readonly kind: string;
  readonly principal: string;
  readonly parent_session: string | null;
  readonly agent_reference: string | null;
  readonly capabilities: string[];
  readonly credential_slot: string;
  readonly account: string;
  readonly cluster: string;
  readonly state: string;
}

interface SessionTurnStoredRow {
  readonly turn: string;
  readonly ordinal: string;
  readonly input_kind: string;
  readonly input: string;
  readonly state: string;
  readonly attempt: string | null;
  readonly attempts_spent: string;
  readonly result: string | null;
  readonly failure: string | null;
  readonly batch_first: string | null;
  readonly batch_last: string | null;
}

/** The verdict `open_agent_session` answered, refusing anything else. */
function agentSessionOpened(
  value: string | null | undefined,
): AgentSessionOpened {
  if (value === "Opened" || value === "AlreadyOpen" || value === "Conflict")
    return value;
  throw new Error(`postgres agent session: opening answered ${String(value)}`);
}

/** The verdict `enqueue_session_turn` answered, with the ordinal each arm carries. */
function sessionTurnEnqueued(
  enqueued: string | null | undefined,
  ordinal: string | null,
): SessionTurnEnqueued {
  if (enqueued === "Closed" || enqueued === "Backlogged") return { enqueued };
  if (
    (enqueued === "Enqueued" || enqueued === "AlreadyEnqueued") &&
    ordinal !== null
  )
    return {
      enqueued,
      ordinal: projectRowCounter(ordinal, "session turn ordinal"),
    };
  throw new Error(
    `postgres agent session: enqueuing answered ${String(enqueued)}`,
  );
}

async function agentSessionOpen(
  pool: pg.Pool,
  opening: AgentSessionOpening,
): Promise<AgentSessionOpened> {
  const opened = await pool.query<{ opened: string | null }>(
    sql`SELECT open_agent_session(
      ${opening.partition.tenant},${opening.partition.project},${opening.session},
      ${opening.kind},${opening.principal},${opening.parent ?? null},
      ${[...opening.capabilities]}::text[],${opening.credentialSlot})::text AS opened`,
  );
  return agentSessionOpened(opened.rows[0]?.opened);
}

async function agentSessionEnqueue(
  pool: pg.Pool,
  offering: SessionTurnOffering,
): Promise<SessionTurnEnqueued> {
  const answered = await pool.query<{
    enqueued: string | null;
    ordinal: string | null;
  }>(
    sql`SELECT enqueued,ordinal::text AS ordinal FROM enqueue_session_turn(
      ${offering.partition.tenant},${offering.partition.project},${offering.session},
      ${offering.turn},${offering.inputKind},${offering.input})`,
  );
  const row = answered.rows[0];
  if (row === undefined)
    throw new Error("postgres agent session: enqueuing returned no verdict");
  return sessionTurnEnqueued(row.enqueued, row.ordinal);
}

async function agentSessionRead(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
): Promise<AgentSession | undefined> {
  const found = await pool.query<AgentSessionStoredRow>(
    sql`SELECT tenant,project,session,kind,principal,parent_session,agent_reference,
               capabilities,credential_slot,account,cluster,state
          FROM agent_session
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND session=${session}`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : agentSessionRowOf(row);
}

async function agentSessionTurns(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
  turnsMax: number,
): Promise<readonly SessionTurn[]> {
  const found = await pool.query<SessionTurnStoredRow>(
    sql`SELECT turn,ordinal::text AS ordinal,input_kind,input,state,attempt,
               attempts_spent::text AS attempts_spent,result,failure,
               batch_first::text AS batch_first,batch_last::text AS batch_last
          FROM session_turn
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND session=${session}
         ORDER BY ordinal LIMIT ${turnsMax}`,
  );
  return found.rows.map(sessionTurnRowOf(partition, session));
}

/** The three provisioning doors and the two reads, over a pool the root supplied. */
export function postgresAgentSessions(pool: pg.Pool): AgentSessionStore {
  return {
    writer: async () => {
      const found = await pool.query<{
        writer_role: string | null;
        can_execute: boolean | null;
      }>(
        sql`SELECT current_user::text AS writer_role,
          has_function_privilege(current_user,
            'open_agent_session(text,text,text,text,text,text,text[],text)',
            'EXECUTE')::boolean AS can_execute`,
      );
      const row = found.rows[0];
      if (row?.writer_role === undefined || row.writer_role === null)
        throw new Error(
          "postgres agent session: the server named no current role",
        );
      return { role: row.writer_role, canExecute: row.can_execute === true };
    },

    open: (opening) => agentSessionOpen(pool, opening),

    close: async (partition, session) => {
      const closed = await pool.query<{ closed: boolean | null }>(
        sql`SELECT close_agent_session(
          ${partition.tenant},${partition.project},${session})::boolean AS closed`,
      );
      return closed.rows[0]?.closed === true;
    },

    enqueue: (offering) => agentSessionEnqueue(pool, offering),

    session: (partition, session) => agentSessionRead(pool, partition, session),

    turns: (partition, session, turnsMax) =>
      agentSessionTurns(pool, partition, session, turnsMax),
  };
}
