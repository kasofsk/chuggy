/**
 * The doors the selector's own role has onto one project's lead: the four its
 * mailbox is, and the one that moves the objectives the lead holds. Every port
 * here is declared in `src/interpreter/`; this module says how PostgreSQL
 * answers them and declares nothing of its own.
 *
 * NO DOOR NAMES A SESSION IT DID NOT CREATE. The bodies 059 grants this role
 * resolve the project's `Lead` session themselves, so a compromised selector
 * cannot put a turn in a member's thread or read one — which the generic
 * `enqueue_session_turn` would let it do, and which is why that one is not
 * granted here. `open_project_lead` names the identity it is about to write and
 * no other: it inserts under a kind and a roster of its own, so an identity
 * already taken is refused by the row rather than reached through.
 *
 * A TURN'S IDENTITY IS THE DECISION'S, so `offer` is idempotent without this
 * file doing anything: a retry of one decision finds the turn it already
 * enqueued and is answered `AlreadyEnqueued`.
 *
 * READING AND WITHDRAWING NAME THE TURN AND NOT THE PROJECT. A turn identity
 * is never reused, and a process that restarted holds the decision reference
 * with no partition beside it — which is exactly the case reconciliation is
 * for. The partition the port passes is therefore not consulted, and the
 * doors stay bounded because each joins to a `Lead` session.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionStates,
  allSessionTurnFailures,
  allSessionTurnStates,
  asSessionId,
  type LeadSystemPromptPort,
  type LeadSystemPromptSet,
} from "../../interpreter/agentSession.ts";
import type {
  LeadMailbox,
  LeadOpened,
  LeadOpening,
  LeadSessionStanding,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "../../interpreter/leadMailbox.ts";
import { projectRowCounter } from "./rows.ts";
import {
  leadOpenFunction,
  selectorInteractionsReadFunction,
  sessionSystemPromptSetFunction,
} from "./schema/shared.ts";
import { leadOpenSignature } from "./schema/migrations/066-lead-successor.ts";
import {
  interactionsReadSignature,
  selectorSignatures,
} from "./schema/migrations/059-lead-decisions.ts";
import { systemPromptSetSignature } from "./schema/migrations/061-lead-tools.ts";
import {
  sessionRowMember,
  sessionRowText,
  sessionTurnMeasuredOf,
  type SessionTurnMeasureRow,
} from "./sessionRows.ts";

/** One `lead_session` row, whose columns are nullable to the checker because the body may answer nothing. */
interface LeadSessionRow {
  readonly session: string | null;
  readonly state: string | null;
  readonly agent_reference: string | null;
}

/** One `read_lead_turn` row: where the turn stands and everything it has produced. */
interface LeadTurnRow extends SessionTurnMeasureRow {
  readonly state: string | null;
  readonly result: string | null;
  readonly failure: string | null;
}

/** The two arms opening a lead answers, both of which leave one open lead standing. */
const openedArms = ["Opened", "AlreadyOpen"] as const;

/** The arms the mailbox holds an ordinal for, and the arms it does not. */
const offeredWithOrdinal = ["Enqueued", "AlreadyEnqueued"] as const;
const offeredWithoutOrdinal = ["NoLead", "Closed", "Backlogged"] as const;

const withdrawnArms: readonly LeadTurnWithdrawn[] = [
  "Withdrawn",
  "AlreadyEnded",
  "NoTurn",
];

/** Narrows one door's verdict to the arms it declares, refusing anything else. */
function leadVerdict<Arm extends string>(
  arms: readonly Arm[],
  value: string | null | undefined,
  what: string,
): Arm {
  const found = arms.find((arm) => arm === value);
  if (found === undefined)
    throw new Error(`postgres lead mailbox: ${what} answered ${String(value)}`);
  return found;
}

function leadSessionOf(row: LeadSessionRow): LeadSessionStanding {
  return {
    session: asSessionId(sessionRowText(row.session, "session")),
    state: sessionRowMember(allSessionStates, row.state, "session state"),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
  };
}

/** What a turn has produced, with the measurement present only where the pod took one. */
function leadTurnOf(row: LeadTurnRow): LeadTurnStanding {
  const measured = sessionTurnMeasuredOf(row);
  return {
    state: sessionRowMember(allSessionTurnStates, row.state, "turn state"),
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.failure === null
      ? {}
      : {
          failure: sessionRowMember(
            allSessionTurnFailures,
            row.failure,
            "turn failure",
          ),
        }),
    ...(measured === undefined ? {} : { measured }),
  };
}

/** One successor, opened through the door the selector's own role holds. */
async function leadOpen(
  pool: pg.Pool,
  opening: LeadOpening,
): Promise<LeadOpened> {
  const opened = await pool.query<{
    opened: string | null;
    session: string | null;
  }>(
    sql`SELECT opened,session FROM open_project_lead(
          ${opening.partition.tenant},${opening.partition.project},
          ${opening.session},${opening.principal},
          ${opening.credentialSlot},${opening.systemPrompt})`,
  );
  const row = opened.rows[0];
  return {
    opened: leadVerdict(openedArms, row?.opened, "opening a lead"),
    session: asSessionId(sessionRowText(row?.session ?? null, "session")),
  };
}

/** The lead's mailbox over the pool that holds the selector service's own role. */
export function postgresLeadMailbox(pool: pg.Pool): LeadMailbox {
  return {
    lead: async (partition) => {
      const found = await pool.query<LeadSessionRow>(
        sql`SELECT session,state,agent_reference
              FROM lead_session(${partition.tenant},${partition.project})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : leadSessionOf(row);
    },

    openLead: (opening) => leadOpen(pool, opening),

    offer: async (input) => {
      const offered = await pool.query<{
        enqueued: string | null;
        ordinal: string | null;
      }>(
        sql`SELECT enqueued,ordinal::text AS ordinal
              FROM enqueue_lead_turn(
                ${input.partition.tenant},${input.partition.project},
                ${input.turn},${input.input})`,
      );
      const row = offered.rows[0];
      if (row?.ordinal !== null && row?.ordinal !== undefined)
        return {
          offered: leadVerdict(
            offeredWithOrdinal,
            row.enqueued,
            "offering a turn",
          ),
          ordinal: projectRowCounter(row.ordinal, "lead turn ordinal"),
        };
      return {
        offered: leadVerdict(
          offeredWithoutOrdinal,
          row?.enqueued,
          "offering a turn",
        ),
      };
    },

    turn: async (turn) => {
      const found = await pool.query<LeadTurnRow>(
        sql`SELECT state,result,failure,model,tokens::text AS tokens,
                   cost_micros::text AS cost_micros,
                   duration_ms::text AS duration_ms,tools
              FROM read_lead_turn(${turn})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : leadTurnOf(row);
    },

    withdraw: async (turn) => {
      const withdrawn = await pool.query<{ withdrawn: string | null }>(
        sql`SELECT withdraw_lead_turn(${turn})::text AS withdrawn`,
      );
      return leadVerdict(
        withdrawnArms,
        withdrawn.rows[0]?.withdrawn,
        "withdrawing a turn",
      );
    },
  };
}

/** The arms setting a lead's objectives may answer with. */
const promptArms = [
  "Set",
  "Unchanged",
  "NoLead",
] as const satisfies readonly LeadSystemPromptSet[];

/**
 * The objectives door over the same pool, which the lead host calls before it
 * offers a turn — a caller a later unit wires, so nothing in `src/` reaches this
 * yet. `Unchanged` is what makes comparing on every pass cost one read.
 */
export function postgresLeadSystemPrompt(pool: pg.Pool): LeadSystemPromptPort {
  return {
    setSystemPrompt: async (partition, prompt) => {
      const set = await pool.query<{ prompted: string | null }>(
        sql`SELECT set_session_system_prompt(
              ${partition.tenant},${partition.project},${prompt})::text
            AS prompted`,
      );
      return leadVerdict(
        promptArms,
        set.rows[0]?.prompted,
        "setting the lead's objectives",
      );
    },
  };
}

/**
 * Every door a decision opens, taken from the grants that create them rather
 * than copied beside them. `has_function_privilege` resolves a signature
 * exactly and raises on one no function has, so a hand-copied argument type is
 * not a wrong answer here but a precondition that throws at every start.
 */
export const leadDoorSignatures: readonly string[] = [
  ...selectorSignatures,
  [selectorInteractionsReadFunction, interactionsReadSignature],
  [sessionSystemPromptSetFunction, systemPromptSetSignature],
  [leadOpenFunction, leadOpenSignature],
].map(([name, signature]) => `${String(name)}(${String(signature)})`);

/**
 * Whether one privilege answer refuses the door. An answer the server did not
 * give is a refusal and never a permit: a control that treats what it could not
 * read as consent is worse than no control.
 */
export function leadDoorRefused(row: {
  readonly permitted: boolean | null;
}): boolean {
  return row.permitted !== true;
}

/**
 * Which of the doors a decision opens this role may not execute. A readiness
 * check asks a host whether it feels able to answer; this asks the database
 * whether the role is allowed to ask at all, which is what a migration that
 * granted one door and not the next fails silently on.
 */
export async function postgresLeadDoorsRefused(
  pool: pg.Pool,
): Promise<readonly string[]> {
  const doors = [...leadDoorSignatures];
  const found = await pool.query<{
    door: string | null;
    permitted: boolean | null;
  }>(
    sql`SELECT door,has_function_privilege(door,'EXECUTE')::boolean AS permitted
          FROM unnest(${doors}::text[]) AS door`,
  );
  return found.rows
    .filter(leadDoorRefused)
    .map((row) => row.door ?? "an unnamed door");
}
