/**
 * A member's thread against PostgreSQL: the listing, the door that opens one,
 * the standing read behind a thread page, the door a message goes through, what
 * a first turn is seeded from, and the bounded pass that wakes a thread.
 *
 * THIS FILE DECIDES NOTHING. `open_member_thread` takes no roster and
 * `enqueue_thread_message` takes no session, so neither the roster a thread
 * holds nor the mailbox a message lands in is this adapter's to choose; the
 * identity a thread is opened under arrives through `ThreadSessionMint` for the
 * same reason, because a name is a decision. An adapter that resolved the
 * session itself would be a second opinion racing the definer that decides it.
 *
 * THE API AND THE SELECTOR REACH DIFFERENT DOORS, so they are different
 * factories over different pools. `postgresThreads` is the API's five reads and
 * two doors; `postgresThreadWakes` is the selector's cursor, candidate read and
 * wake door. A single factory over one pool would be a shape a deployment
 * cannot supply, because no credential in it holds both roles.
 *
 * THE BOUNDS ARE THE CALLER'S ARGUMENTS. Every page limit arrives from
 * `src/contract/http.ts` through the interpreter that checked it, and the
 * definers cap what they are asked for; restating a ceiling here would be a
 * second bound to keep in step with the first.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionStates,
  asSessionId,
  type SessionId,
  type SessionTurnId,
} from "../../interpreter/agentSession.ts";
import { asPrincipal, type Principal } from "../../interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import {
  allThreadWakeReasons,
  type ThreadSeededDraft,
  type ThreadSeededRefusal,
} from "../../interpreter/thread.ts";
import type {
  ThreadWakeCandidate,
  ThreadWakeOffered,
  ThreadWakeStore,
} from "../../interpreter/threadWake.ts";
import type {
  ThreadMessageEnqueued,
  ThreadOpened,
  ThreadRecord,
  ThreadSeedingRead,
  ThreadStandingRecord,
  ThreadStore,
  ThreadTurnRecord,
} from "../../interpreter/threadRead.ts";
import { projectRowCounter } from "./rows.ts";
import { sessionStoreStreamRows } from "./sessionStoreReads.ts";
import {
  sessionRowMember,
  sessionRowText,
  sessionTurnStandingOf,
  type SessionTurnStandingRow,
} from "./sessionRows.ts";

/**
 * What a draft's summary is where the draft has no brief yet. A draft is filed
 * before its brief is written, and a seeding block that dropped one would tell
 * a member they have fewer open drafts than they do.
 */
const draftWithoutABrief = "no brief yet";

/** What both thread reads say about the thread itself, whatever they call its state. */
interface ThreadIdentityRow {
  readonly session: string | null;
  readonly principal: string | null;
  readonly owner: string | null;
  readonly agent_reference: string | null;
  readonly turns: string | null;
}

/** One `read_project_threads` row, which names the session's state `state`. */
interface ThreadListingRow extends ThreadIdentityRow {
  readonly state: string | null;
}

/**
 * One `read_thread_standing` row. It repeats the listing's identities without
 * extending its shape, because this read answers `session_state` where the
 * listing answers `state` and a row type the server does not produce is a query
 * the checker refuses.
 */
interface ThreadStandingRow extends ThreadIdentityRow, SessionTurnStandingRow {
  readonly session_state: string | null;
  readonly next_before: string | null;
  readonly input: string | null;
  readonly result: string | null;
}

function threadRecordOf(
  row: ThreadIdentityRow,
  state: string | null,
): ThreadRecord {
  return {
    session: asSessionId(sessionRowText(row.session, "session")),
    principal: asPrincipal(sessionRowText(row.principal, "principal")),
    ...(row.owner === null ? {} : { owner: row.owner }),
    state: sessionRowMember(allSessionStates, state, "session state"),
    turns: projectRowCounter(
      sessionRowText(row.turns, "thread turns"),
      "thread turns",
    ),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
  };
}

/**
 * The turn a standing row carries, or nothing where the page is empty. What a
 * thread's turn adds to every session's is the two texts: what the member typed
 * and the answer they are waiting for.
 */
function threadTurnRecordOf(
  row: ThreadStandingRow,
): ThreadTurnRecord | undefined {
  const standing = sessionTurnStandingOf(row);
  if (standing === undefined) return undefined;
  return {
    ...standing,
    input: sessionRowText(row.input, "turn input"),
    ...(row.result === null ? {} : { result: row.result }),
  };
}

async function threadStandingRows(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
  before: number | undefined,
  limit: number,
): Promise<readonly ThreadStandingRow[]> {
  const found = await pool.query<ThreadStandingRow>(
    sql`SELECT session,principal,owner,session_state,agent_reference,
               turns::text AS turns,next_before::text AS next_before,
               turn,turn_ordinal::text AS turn_ordinal,input_kind,
               turn_state,input,result,failure,model,tokens::text AS tokens,
               cost_micros::text AS cost_micros,
               duration_ms::text AS duration_ms,tools,
               batch_first::text AS batch_first,batch_last::text AS batch_last
          FROM read_thread_standing(
                 ${partition.tenant},${partition.project},${session},
                 ${before ?? null},${limit})`,
  );
  return found.rows;
}

/**
 * One thread's standing, or nothing where the session named is not this
 * project's own thread — which the definer decides by admitting `kind='Thread'`
 * alone, so a lead's mailbox is not readable through a thread route.
 */
async function threadStanding(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
  before: number | undefined,
  limit: number,
  streamsMax: number,
): Promise<ThreadStandingRecord | undefined> {
  const rows = await threadStandingRows(
    pool,
    partition,
    session,
    before,
    limit,
  );
  const head = rows[0];
  if (head === undefined) return undefined;
  const nextBefore =
    head.next_before === null
      ? undefined
      : projectRowCounter(head.next_before, "thread mailbox cursor");
  return {
    thread: threadRecordOf(head, head.session_state),
    turns: rows.flatMap((row) => {
      const turn = threadTurnRecordOf(row);
      return turn === undefined ? [] : [turn];
    }),
    ...(nextBefore === undefined ? {} : { nextBefore }),
    streams: await sessionStoreStreamRows(pool, partition, session, streamsMax),
  };
}

/** The verdict a mailbox door answered, with the ordinal and session each arm carries. */
function threadMessageEnqueued(row: {
  readonly enqueued: string | null;
  readonly ordinal: string | null;
  readonly session: string | null;
}): ThreadMessageEnqueued {
  const { enqueued } = row;
  if (
    enqueued === "NoThread" ||
    enqueued === "NotYourThread" ||
    enqueued === "Closed" ||
    enqueued === "Orphaned" ||
    enqueued === "Backlogged"
  )
    return { enqueued };
  if (
    (enqueued === "Enqueued" || enqueued === "AlreadyEnqueued") &&
    row.ordinal !== null
  )
    return {
      enqueued,
      session: asSessionId(sessionRowText(row.session, "thread session")),
      ordinal: projectRowCounter(row.ordinal, "thread turn ordinal"),
    };
  throw new Error(`postgres thread: the mailbox answered ${String(enqueued)}`);
}

/**
 * The API's own thread authority. Opening reads the row back through the
 * standing read rather than having the door answer it, because the listing's
 * shape is one shape and a door that answered a second one would be a second
 * place a column is added to.
 */
/** Every thread the project holds, with the owner joined from its membership. */
async function threadListing(
  pool: pg.Pool,
  partition: Partition,
  limit: number,
): Promise<readonly ThreadRecord[]> {
  const found = await pool.query<ThreadListingRow>(
    sql`SELECT session,principal,owner,state,agent_reference,
               turns::text AS turns
          FROM read_project_threads(
                 ${partition.tenant},${partition.project},${limit})`,
  );
  return found.rows.map((row) => threadRecordOf(row, row.state));
}

/** The verdict `open_member_thread` answered, and the session it names either way. */
function threadOpening(row: {
  readonly opened: string | null;
  readonly session: string | null;
}): { readonly opened: "Opened" | "AlreadyOpen"; readonly session: SessionId } {
  if (row.opened !== "Opened" && row.opened !== "AlreadyOpen")
    throw new Error(`postgres thread: opening answered ${String(row.opened)}`);
  return {
    opened: row.opened,
    session: asSessionId(sessionRowText(row.session, "thread session")),
  };
}

async function threadOpen(
  pool: pg.Pool,
  streamsMax: number,
  input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly systemPrompt: string;
    readonly credentialSlot: string;
  },
): Promise<ThreadOpened> {
  const answered = await pool.query<{
    opened: string | null;
    session: string | null;
  }>(
    sql`SELECT opened,session FROM open_member_thread(
          ${input.partition.tenant},${input.partition.project},
          ${input.principal},${input.session},
          ${input.credentialSlot},${input.systemPrompt})`,
  );
  const row = answered.rows[0];
  if (row === undefined)
    throw new Error("postgres thread: opening returned no verdict");
  const { opened, session } = threadOpening(row);
  const standing = await threadStanding(
    pool,
    input.partition,
    session,
    undefined,
    1,
    streamsMax,
  );
  if (standing === undefined)
    throw new Error(`postgres thread: ${session} was opened and is not there`);
  return { opened, thread: standing.thread };
}

async function threadEnqueue(
  pool: pg.Pool,
  input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    readonly input: string;
  },
): Promise<ThreadMessageEnqueued> {
  const answered = await pool.query<{
    enqueued: string | null;
    ordinal: string | null;
    session: string | null;
  }>(
    sql`SELECT enqueued,ordinal::text AS ordinal,session
          FROM enqueue_thread_message(
            ${input.partition.tenant},${input.partition.project},
            ${input.principal},${input.session},
            ${input.turn},${input.input})`,
  );
  const row = answered.rows[0];
  if (row === undefined)
    throw new Error("postgres thread: the message door returned no verdict");
  return threadMessageEnqueued(row);
}

export function postgresThreads(
  pool: pg.Pool,
  bounds: {
    readonly streamsMax: number;
  },
): ThreadStore {
  return {
    threads: (partition, limit) => threadListing(pool, partition, limit),
    open: (input) => threadOpen(pool, bounds.streamsMax, input),
    standing: (input) =>
      threadStanding(
        pool,
        input.partition,
        input.session,
        input.query.before,
        input.query.limit,
        bounds.streamsMax,
      ),
    enqueueMessage: (input) => threadEnqueue(pool, input),
  };
}

/**
 * What a thread's first turn is seeded from. The North Star is read as itself
 * rather than as the whole resolved settings record, so the composition that
 * uses it cannot hand a thread the lead's prompt or its limits by accident; the
 * drafts and the refusals are filtered to the member the block is for, which is
 * why an authority rather than a principal is what they take.
 */
export function postgresThreadSeeding(pool: pg.Pool): ThreadSeedingRead {
  return {
    northStar: async (partition) => {
      const found = await pool.query<{ north_star: string | null }>(
        sql`SELECT north_star FROM selector_project_settings
             WHERE tenant=${partition.tenant} AND project=${partition.project}`,
      );
      return found.rows[0]?.north_star ?? undefined;
    },

    drafts: async (partition, author, limit) => {
      const found = await pool.query<{
        ticket: string;
        intent: string | null;
      }>(
        sql`SELECT open.ticket::text AS ticket,open.intent
              FROM read_project_drafts(
                     ${partition.tenant},${partition.project},NULL,${limit}) open
              JOIN draft_revision authored
                ON authored.tenant=${partition.tenant}
               AND authored.project=${partition.project}
               AND authored.ticket=open.ticket
               AND authored.authoring_version=open.authoring_version
             WHERE authored.authority_kind=${author.kind}
               AND authored.authority_subject=${author.subject}
             ORDER BY open.ticket`,
      );
      return found.rows.map((row): ThreadSeededDraft => ({
        ticket: projectRowCounter(
          sessionRowText(row.ticket, "draft ticket"),
          "draft ticket",
        ),
        summary: row.intent ?? draftWithoutABrief,
      }));
    },

    refusals: async (partition, tickets, limit) => {
      const found = await pool.query<{
        ticket: string | null;
        reason: string | null;
      }>(
        sql`SELECT standing.ticket::text AS ticket,standing.reason
              FROM read_standing_agentic_refusals(
                     ${partition.tenant},${partition.project},${limit}) standing
             WHERE standing.ticket = ANY(${[...tickets]}::bigint[])
             ORDER BY standing.ticket`,
      );
      return found.rows.map((row): ThreadSeededRefusal => ({
        ticket: projectRowCounter(
          sessionRowText(row.ticket, "refusal ticket"),
          "refusal ticket",
        ),
        reason: sessionRowText(row.reason, "refusal reason"),
      }));
    },
  };
}

/**
 * The wake pass's three doors, answering the ports
 * `src/interpreter/threadWake.ts` declares. The candidate join is the
 * definer's, because it is a bounded read over four relations and a pass that
 * pulled the change rows out and joined them itself would be a second copy of a
 * query the database answers.
 */
function threadWokenRow(row: {
  readonly enqueued: string | null;
  readonly ordinal: string | null;
}): ThreadWakeOffered {
  const woken = row.enqueued;
  if (
    woken === "NoThread" ||
    woken === "Closed" ||
    woken === "Orphaned" ||
    woken === "Backlogged"
  )
    return { woken };
  if ((woken === "Woken" || woken === "AlreadyWoken") && row.ordinal !== null)
    return {
      woken,
      ordinal: projectRowCounter(row.ordinal, "wake turn ordinal"),
    };
  throw new Error(
    `postgres thread wake: the mailbox answered ${String(woken)}`,
  );
}

/** One candidate row, narrowed to the values the pass acts on. */
function threadWakeCandidateOf(row: {
  readonly sequence: string | null;
  readonly tenant: string | null;
  readonly project: string | null;
  readonly resource: string | null;
  readonly reason: string | null;
  readonly principal: string | null;
  readonly session: string | null;
}): ThreadWakeCandidate {
  return {
    sequence: projectRowCounter(
      sessionRowText(row.sequence, "change sequence"),
      "change sequence",
    ),
    partition: {
      tenant: asTenantId(sessionRowText(row.tenant, "tenant")),
      project: asProjectId(sessionRowText(row.project, "project")),
    },
    resource: sessionRowText(row.resource, "change resource"),
    reason: sessionRowMember(
      allThreadWakeReasons,
      row.reason,
      "thread wake reason",
    ),
    principal: asPrincipal(sessionRowText(row.principal, "principal")),
    session: asSessionId(sessionRowText(row.session, "session")),
  };
}

async function threadWakeCandidates(
  pool: pg.Pool,
  after: number,
  limit: number,
): Promise<readonly ThreadWakeCandidate[]> {
  const found = await pool.query<{
    sequence: string | null;
    tenant: string | null;
    project: string | null;
    resource: string | null;
    reason: string | null;
    principal: string | null;
    session: string | null;
  }>(
    sql`SELECT sequence::text AS sequence,tenant,project,resource,reason,
               principal,session
          FROM thread_wake_candidates(${after},${limit})`,
  );
  return found.rows.map(threadWakeCandidateOf);
}

async function threadWake(
  pool: pg.Pool,
  input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly turn: SessionTurnId;
    readonly input: string;
  },
): Promise<ThreadWakeOffered> {
  const answered = await pool.query<{
    enqueued: string | null;
    ordinal: string | null;
  }>(
    sql`SELECT enqueued,ordinal::text AS ordinal FROM wake_member_thread(
          ${input.partition.tenant},${input.partition.project},
          ${input.principal},${input.turn},${input.input})`,
  );
  const row = answered.rows[0];
  if (row === undefined)
    throw new Error("postgres thread wake: the door returned no verdict");
  return threadWokenRow(row);
}

export function postgresThreadWakes(pool: pg.Pool): ThreadWakeStore {
  return {
    cursor: async () => {
      const found = await pool.query<{ sequence: string }>(
        sql`SELECT sequence::text AS sequence FROM thread_wake_cursor`,
      );
      const row = found.rows[0];
      if (row === undefined)
        throw new Error("postgres thread wake: the cursor row is missing");
      return projectRowCounter(
        sessionRowText(row.sequence, "wake cursor"),
        "wake cursor",
      );
    },
    candidates: (after, limit) => threadWakeCandidates(pool, after, limit),
    wake: (input) => threadWake(pool, input),
    advance: async (sequence) => {
      const moved = await pool.query<{ sequence: string | null }>(
        sql`SELECT advance_thread_wake_cursor(${sequence})::text AS sequence`,
      );
      return projectRowCounter(
        sessionRowText(moved.rows[0]?.sequence ?? null, "wake cursor"),
        "wake cursor",
      );
    },
  };
}
