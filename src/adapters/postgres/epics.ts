/**
 * PostgreSQL side of a project's epics: the door an epic is saved through and
 * the reads of its list, its view, its history and its graph.
 *
 * Progress and status are derived from the members' phases at read time and
 * stored nowhere. A multi-query read runs in one snapshot, so a list's
 * members and its counts name the same moment.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { briefTitleCharsMax } from "../../contract/brief.ts";
import type { EpicHistoryQuery, EpicListQuery } from "../../contract/epics.ts";
import {
  epicProgress,
  epicStatus,
  epicVisibilities,
  type EpicCommand,
  type EpicOutcome,
  type EpicProgress,
  type EpicStatus,
  type EpicVisibility,
} from "../../domain/epics.ts";
import { phaseTags, type Phase } from "../../domain/phase.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { projectRowCounter } from "./rows.ts";

/** Who saved an epic, as the journal's other authorities are named. */
export interface EpicActor {
  readonly kind: string;
  readonly subject: string;
}

/** An epic as a ticket names it. */
export interface EpicReference {
  readonly number: number;
  readonly title: string;
  readonly visibility: EpicVisibility;
}

/** An epic as a list and a view carry it, with the figures derived from its members. */
export interface EpicSummary extends EpicReference {
  readonly revision: number;
  readonly summary?: string;
  readonly progress: EpicProgress;
  readonly status: EpicStatus;
  /** Tickets outside the epic a Pending member depends on that are not Done, ascending. */
  readonly waitingOnOutside: readonly number[];
}

export interface EpicView extends EpicSummary {
  readonly description: string;
  readonly tickets: readonly number[];
}

export interface EpicListPage {
  readonly epics: readonly EpicSummary[];
  /** The `after` the next page resumes from, where one follows. */
  readonly nextAfter?: number;
}

export interface EpicRevision {
  readonly revision: number;
  readonly changedAt: string;
  readonly actor: EpicActor;
  readonly title: string;
}

export interface EpicHistoryPage {
  readonly revisions: readonly EpicRevision[];
  readonly nextAfter?: number;
}

export interface EpicGraphNode {
  readonly ticket: number;
  readonly title?: string;
  readonly phase: Phase;
  /** False for a ticket outside the epic that a member depends on. */
  readonly member: boolean;
}

/** `from` is a dependency and `to` the member that depends on it. */
export interface EpicGraph {
  readonly nodes: readonly EpicGraphNode[];
  readonly edges: readonly { readonly from: number; readonly to: number }[];
}

export interface EpicStore {
  readonly save: (
    partition: Partition,
    command: EpicCommand,
    actor: EpicActor,
  ) => Promise<EpicOutcome>;
  readonly list: (
    partition: Partition,
    query: EpicListQuery,
  ) => Promise<EpicListPage>;
  readonly view: (
    partition: Partition,
    epic: number,
  ) => Promise<EpicView | undefined>;
  readonly history: (
    partition: Partition,
    epic: number,
    query: EpicHistoryQuery,
  ) => Promise<EpicHistoryPage | undefined>;
  readonly graph: (
    partition: Partition,
    epic: number,
  ) => Promise<EpicGraph | undefined>;
}

type Queryable = Pick<pg.Pool, "query">;

interface SaveRow {
  readonly outcome: string | null;
  readonly epic: string | null;
  readonly revision: string | null;
  readonly current: string | null;
  readonly unknown: string[] | null;
}

interface EpicRow {
  readonly number: string;
  readonly revision: string;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string;
  readonly visibility: string;
}

function epicVisibility(value: string): EpicVisibility {
  const found = epicVisibilities.find((candidate) => candidate === value);
  if (found === undefined)
    throw new Error(`postgres epics: ${value} is not a visibility`);
  return found;
}

function epicPhase(value: string): Phase {
  const found = phaseTags.find((candidate) => candidate === value);
  if (found === undefined)
    throw new Error(`postgres epics: ${value} is not a ticket phase`);
  return found;
}

function epicCounter(value: string | null, what: string): number {
  if (value === null) throw new Error(`postgres epics: ${what} is absent`);
  return projectRowCounter(value, what);
}

function epicText(value: string | null, what: string): string {
  if (value === null) throw new Error(`postgres epics: ${what} is absent`);
  return value;
}

const savedRefusals = [
  "MissingEpic",
  "ArchivedEpic",
  "EmptyTitle",
  "LongTitle",
  "LongSummary",
  "LargeContent",
] as const;

function savedOutcome(row: SaveRow | undefined): EpicOutcome {
  if (row?.outcome === undefined || row.outcome === null)
    throw new Error("postgres epics: save answered none");
  if (row.outcome === "Saved")
    return {
      kind: "Saved",
      epic: epicCounter(row.epic, "saved epic"),
      revision: epicCounter(row.revision, "saved revision"),
    };
  if (row.outcome === "StaleRevision")
    return {
      kind: "Refused",
      reason: "StaleRevision",
      current: epicCounter(row.current, "current revision"),
    };
  if (row.outcome === "UnknownTickets")
    return {
      kind: "Refused",
      reason: "UnknownTickets",
      tickets: (row.unknown ?? []).map((ticket) =>
        projectRowCounter(ticket, "unknown ticket"),
      ),
    };
  const reason = savedRefusals.find((candidate) => candidate === row.outcome);
  if (reason === undefined)
    throw new Error(`postgres epics: save answered ${row.outcome}`);
  return { kind: "Refused", reason };
}

/** The write: one call of the door, which takes the project's lock and decides. */
async function epicSave(
  pool: Queryable,
  partition: Partition,
  command: EpicCommand,
  actor: EpicActor,
): Promise<EpicOutcome> {
  const { content } = command;
  const found = await pool.query<SaveRow>(
    sql`SELECT result_outcome AS outcome,result_epic::text AS epic,
               result_revision::text AS revision,result_current::text AS current,
               result_unknown::text[] AS unknown
          FROM save_epic(
            ${partition.tenant},${partition.project},${command.kind},
            ${command.kind === "Revise" ? command.epic : null}::bigint,
            ${command.kind === "Revise" ? command.expected : null}::bigint,
            ${content.title},${content.summary ?? null}::text,${content.description},
            ${content.visibility},${[...content.tickets]}::bigint[],
            ${actor.kind},${actor.subject})`,
  );
  return savedOutcome(found.rows[0]);
}

interface PhaseCountRow {
  readonly epic: string;
  readonly phase: string;
  readonly members: string;
}

interface DependencyRow {
  readonly epic: string;
  readonly dependency: string | null;
}

/** The member phases of each epic named, counted by the database. */
async function epicMemberPhases(
  client: Queryable,
  partition: Partition,
  epics: readonly number[],
): Promise<ReadonlyMap<number, readonly Phase[]>> {
  const found = await client.query<PhaseCountRow>(
    sql`SELECT m.epic::text AS epic,p.phase,count(*)::text AS members
          FROM epic_ticket m
          JOIN ticket_projection p
            ON p.tenant=m.tenant AND p.project=m.project AND p.ticket=m.ticket
         WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
           AND m.epic = ANY(${[...epics]}::bigint[])
         GROUP BY m.epic,p.phase`,
  );
  const phases = new Map<number, Phase[]>();
  for (const row of found.rows) {
    const held = phases.get(Number(row.epic)) ?? [];
    const count = projectRowCounter(row.members, "epic members");
    for (let each = 0; each < count; each += 1) held.push(epicPhase(row.phase));
    phases.set(Number(row.epic), held);
  }
  return phases;
}

/** The tickets outside each epic that a Pending member of it depends on and that are not Done. */
async function epicWaiting(
  client: Queryable,
  partition: Partition,
  epics: readonly number[],
): Promise<ReadonlyMap<number, readonly number[]>> {
  const found = await client.query<DependencyRow>(
    sql`SELECT DISTINCT m.epic::text AS epic,d.dep AS dependency
          FROM epic_ticket m
          JOIN ticket_projection t
            ON t.tenant=m.tenant AND t.project=m.project AND t.ticket=m.ticket
           AND t.phase='Pending'
          LEFT JOIN LATERAL (
            SELECT (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->'value'->'dependencies' END) AS deps
              FROM journal_entry j
             WHERE j.tenant=m.tenant AND j.project=m.project
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->>'type' END) = 'TicketCreated'
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->'value'->'id' END)=to_jsonb(m.ticket)
             ORDER BY j.seq LIMIT 1) r ON true
          LEFT JOIN LATERAL ticket_updated_dependencies(m.tenant,m.project,m.ticket) w ON true
          CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(w.deps,r.deps,'[]'::jsonb)) AS d(dep)
         WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
           AND m.epic = ANY(${[...epics]}::bigint[])
           AND NOT EXISTS (SELECT 1 FROM epic_ticket o
                            WHERE o.tenant=m.tenant AND o.project=m.project
                              AND o.epic=m.epic AND o.ticket=d.dep::bigint)
           AND NOT EXISTS (SELECT 1 FROM ticket_projection x
                            WHERE x.tenant=m.tenant AND x.project=m.project
                              AND x.ticket=d.dep::bigint AND x.phase='Done')
         ORDER BY 1,2`,
  );
  const waiting = new Map<number, number[]>();
  for (const row of found.rows) {
    const held = waiting.get(Number(row.epic)) ?? [];
    held.push(epicCounter(row.dependency, "epic dependency"));
    waiting.set(Number(row.epic), held);
  }
  return waiting;
}

async function epicSummaries(
  client: Queryable,
  partition: Partition,
  rows: readonly EpicRow[],
): Promise<readonly EpicSummary[]> {
  const numbers = rows.map((row) => Number(row.number));
  const phases = await epicMemberPhases(client, partition, numbers);
  const waiting = await epicWaiting(client, partition, numbers);
  return rows.map((row) => {
    const number = projectRowCounter(row.number, "epic number");
    const progress = epicProgress(phases.get(number) ?? []);
    return {
      number,
      revision: projectRowCounter(row.revision, "epic revision"),
      title: row.title,
      ...(row.summary === null ? {} : { summary: row.summary }),
      visibility: epicVisibility(row.visibility),
      progress,
      status: epicStatus(progress),
      waitingOnOutside: waiting.get(number) ?? [],
    };
  });
}

/** Runs reads in one snapshot, as the project read does. */
async function epicSnapshot<Result>(
  pool: pg.Pool,
  read: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await read(client);
    await client.query("COMMIT");
    return result;
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
}

async function epicList(
  pool: pg.Pool,
  partition: Partition,
  query: EpicListQuery,
): Promise<EpicListPage> {
  const sort = query.sort ?? "newest";
  const visibilities =
    query.visibility === "All"
      ? [...epicVisibilities]
      : [query.visibility ?? "Active"];
  return epicSnapshot(pool, async (client) => {
    const found = await client.query<EpicRow>(
      sql`SELECT e.number::text AS number,e.revision::text AS revision,e.title,
                 e.summary,e.description,e.visibility
            FROM epic e
           WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
             AND e.visibility = ANY(${visibilities}::text[])
             AND (${query.search ?? null}::text IS NULL
               OR strpos(lower(e.title || ' ' || coalesce(e.summary,'')),
                         lower(${query.search ?? null}::text)) > 0)
             AND (${query.ticket ?? null}::bigint IS NULL
               OR EXISTS (SELECT 1 FROM epic_ticket m
                           WHERE m.tenant=e.tenant AND m.project=e.project
                             AND m.epic=e.number AND m.ticket=${query.ticket ?? null}::bigint))
             AND (${query.after ?? null}::bigint IS NULL
               OR CASE ${sort}::text
                    WHEN 'oldest' THEN e.number > ${query.after ?? null}::bigint
                    WHEN 'newest' THEN e.number < ${query.after ?? null}::bigint
                    ELSE (lower(e.title),e.number) >
                         (SELECT lower(a.title),a.number FROM epic a
                           WHERE a.tenant=e.tenant AND a.project=e.project
                             AND a.number=${query.after ?? null}::bigint)
                  END)
           ORDER BY CASE WHEN ${sort}::text='oldest' THEN e.number END,
                    CASE WHEN ${sort}::text='newest' THEN e.number END DESC,
                    CASE WHEN ${sort}::text='title' THEN lower(e.title) END,
                    e.number
           LIMIT ${query.limit + 1}`,
    );
    const page = found.rows.slice(0, query.limit);
    const epics = await epicSummaries(client, partition, page);
    const last = epics.at(-1);
    return {
      epics,
      ...(found.rows.length > query.limit && last !== undefined
        ? { nextAfter: last.number }
        : {}),
    };
  });
}

async function epicView(
  pool: pg.Pool,
  partition: Partition,
  epic: number,
): Promise<EpicView | undefined> {
  return epicSnapshot(pool, async (client) => {
    const found = await client.query<EpicRow>(
      sql`SELECT e.number::text AS number,e.revision::text AS revision,e.title,
                 e.summary,e.description,e.visibility
            FROM epic e
           WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
             AND e.number=${epic}::bigint`,
    );
    const row = found.rows[0];
    if (row === undefined) return undefined;
    const [summary] = await epicSummaries(client, partition, [row]);
    if (summary === undefined)
      throw new Error("postgres epics: a summary was not derived");
    const members = await client.query<{ ticket: string }>(
      sql`SELECT m.ticket::text AS ticket FROM epic_ticket m
           WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
             AND m.epic=${epic}::bigint
           ORDER BY m.ticket`,
    );
    return {
      ...summary,
      description: row.description,
      tickets: members.rows.map((member) =>
        projectRowCounter(member.ticket, "epic member"),
      ),
    };
  });
}

interface RevisionRow {
  readonly revision: string;
  readonly changed_at: string | null;
  readonly actor_kind: string;
  readonly actor_subject: string;
  readonly title: string;
}

async function epicHistory(
  pool: pg.Pool,
  partition: Partition,
  epic: number,
  query: EpicHistoryQuery,
): Promise<EpicHistoryPage | undefined> {
  return epicSnapshot(pool, async (client) => {
    const held = await client.query<{ number: string }>(
      sql`SELECT e.number::text AS number FROM epic e
           WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
             AND e.number=${epic}::bigint`,
    );
    if (held.rows.length === 0) return undefined;
    const found = await client.query<RevisionRow>(
      sql`SELECT c.revision::text AS revision,
                 to_char(c.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS changed_at,
                 c.actor_kind,c.actor_subject,c.title
            FROM epic_change c
           WHERE c.tenant=${partition.tenant} AND c.project=${partition.project}
             AND c.epic=${epic}::bigint
             AND (${query.after ?? null}::bigint IS NULL
               OR c.revision < ${query.after ?? null}::bigint)
           ORDER BY c.revision DESC LIMIT ${query.limit + 1}`,
    );
    const revisions = found.rows.slice(0, query.limit).map((row) => ({
      revision: projectRowCounter(row.revision, "epic revision"),
      changedAt: epicText(row.changed_at, "epic change time"),
      actor: { kind: row.actor_kind, subject: row.actor_subject },
      title: row.title,
    }));
    const last = revisions.at(-1);
    return {
      revisions,
      ...(found.rows.length > query.limit && last !== undefined
        ? { nextAfter: last.revision }
        : {}),
    };
  });
}

interface EdgeRow {
  readonly member: string;
  readonly dependency: string | null;
}

interface NodeRow {
  readonly ticket: string;
  readonly phase: string;
  readonly title: string;
}

/** Every dependency of every member, whatever the member's phase. */
async function epicEdges(
  client: Queryable,
  partition: Partition,
  epic: number,
): Promise<readonly EdgeRow[]> {
  const found = await client.query<EdgeRow>(
    sql`SELECT DISTINCT m.ticket::text AS member,d.dep AS dependency
          FROM epic_ticket m
          LEFT JOIN LATERAL (
            SELECT (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->'value'->'dependencies' END) AS deps
              FROM journal_entry j
             WHERE j.tenant=m.tenant AND j.project=m.project
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->>'type' END) = 'TicketCreated'
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->'value'->'id' END)=to_jsonb(m.ticket)
             ORDER BY j.seq LIMIT 1) r ON true
          LEFT JOIN LATERAL ticket_updated_dependencies(m.tenant,m.project,m.ticket) w ON true
          CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(w.deps,r.deps,'[]'::jsonb)) AS d(dep)
         WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
           AND m.epic=${epic}::bigint
         ORDER BY 1,2`,
  );
  return found.rows;
}

async function epicNodes(
  client: Queryable,
  partition: Partition,
  tickets: readonly number[],
): Promise<readonly NodeRow[]> {
  const found = await client.query<NodeRow>(
    sql`SELECT t.ticket::text AS ticket,t.phase,
               coalesce(b.brief->>'title',left(substring(b.brief->>'intent' from
                 '[^\\n]*[^[:space:]][^\\n]*'),${briefTitleCharsMax}::int),'') AS title
          FROM ticket_projection t
          LEFT JOIN ticket_definition b
            ON b.tenant=t.tenant AND b.project=t.project AND b.ticket=t.ticket
         WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
           AND t.ticket = ANY(${[...tickets]}::bigint[])
         ORDER BY t.ticket`,
  );
  return found.rows;
}

async function epicGraph(
  pool: pg.Pool,
  partition: Partition,
  epic: number,
): Promise<EpicGraph | undefined> {
  return epicSnapshot(pool, async (client) => {
    const members = await client.query<{ ticket: string }>(
      sql`SELECT m.ticket::text AS ticket FROM epic_ticket m
           WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
             AND m.epic=${epic}::bigint`,
    );
    const held = await client.query<{ number: string }>(
      sql`SELECT e.number::text AS number FROM epic e
           WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
             AND e.number=${epic}::bigint`,
    );
    if (held.rows.length === 0) return undefined;
    const inside = new Set(
      members.rows.map((row) => projectRowCounter(row.ticket, "epic member")),
    );
    const edges = (await epicEdges(client, partition, epic)).map((row) => ({
      from: epicCounter(row.dependency, "epic dependency"),
      to: projectRowCounter(row.member, "epic member"),
    }));
    const wanted = new Set([...inside, ...edges.map((edge) => edge.from)]);
    const nodes = (await epicNodes(client, partition, [...wanted])).map(
      (row) => {
        const ticket = projectRowCounter(row.ticket, "epic node");
        return {
          ticket,
          ...(row.title === "" ? {} : { title: row.title }),
          phase: epicPhase(row.phase),
          member: inside.has(ticket),
        };
      },
    );
    return { nodes, edges };
  });
}

interface ReferenceRow {
  readonly ticket: string;
  readonly number: string;
  readonly title: string;
  readonly visibility: string;
}

/** Each ticket's epics in epic order, archived ones included, in one query. */
export async function epicsForTickets(
  client: Queryable,
  partition: Partition,
  tickets: readonly number[],
): Promise<ReadonlyMap<number, readonly EpicReference[]>> {
  const references = new Map<number, EpicReference[]>();
  if (tickets.length === 0) return references;
  const found = await client.query<ReferenceRow>(
    sql`SELECT m.ticket::text AS ticket,e.number::text AS number,e.title,e.visibility
          FROM epic_ticket m
          JOIN epic e
            ON e.tenant=m.tenant AND e.project=m.project AND e.number=m.epic
         WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
           AND m.ticket = ANY(${[...tickets]}::bigint[])
         ORDER BY m.ticket,e.number`,
  );
  for (const row of found.rows) {
    const ticket = projectRowCounter(row.ticket, "epic member");
    const held = references.get(ticket) ?? [];
    held.push({
      number: projectRowCounter(row.number, "epic number"),
      title: row.title,
      visibility: epicVisibility(row.visibility),
    });
    references.set(ticket, held);
  }
  return references;
}

/** The API's epic store over its pool. */
export function postgresEpics(pool: pg.Pool): EpicStore {
  return {
    save: (partition, command, actor) =>
      epicSave(pool, partition, command, actor),
    list: (partition, query) => epicList(pool, partition, query),
    view: (partition, epic) => epicView(pool, partition, epic),
    history: (partition, epic, query) =>
      epicHistory(pool, partition, epic, query),
    graph: (partition, epic) => epicGraph(pool, partition, epic),
  };
}
