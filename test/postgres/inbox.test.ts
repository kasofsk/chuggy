/**
 * The inbox against a real server: the union its two sources make, one entry
 * per ticket, walked by its cursor under one count. The phases and the open
 * actions are the store's own reads, so they are seeded rows.
 *
 * A PAGE IS A FIXED NUMBER OF STATEMENTS. A hundred entries are read in as many
 * statements as one, and none of them correlates a subquery on an outer row's
 * partition: one that did would be re-run for every row of the project.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import { postgresInboxReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import type { OperationalReadStore } from "../../src/interpreter/operationsView.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  projectInbox,
  type ProjectInboxPage,
  type ProjectInboxQuery,
} from "../../src/interpreter/projectInbox.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { executionSummary } from "../contract/representations.ts";
import { postgresHarnessProject } from "./harness.ts";
import { seedJournalEntry, seedOpenAction } from "./nativeActionFixture.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  postgresReadHarness,
  postgresStatementCorrelated,
} from "./readHarness.ts";

const subject = postgresReadHarness();

const reader = asPrincipal("inbox-reader");
const dispatcher = new Set<ProjectAccessKind>(["Read", "DispatchTicket"]);

/** One ticket a case seeds: its phase, the entry dating it, and whether an action is open on it. */
interface InboxSeeded {
  readonly ticket: number;
  readonly phase: string;
  readonly seq: number;
  readonly action?: boolean;
}

/** A project holding `tickets`, each dated by an entry of its own. */
async function inboxProject(
  label: string,
  tickets: readonly InboxSeeded[],
): Promise<Partition> {
  const partition = await postgresHarnessProject(subject.harness.store, label);
  for (const seeded of tickets) {
    const named = `${label}-${String(seeded.ticket)}`;
    if (seeded.action === true)
      await seedOpenAction(subject.harness, partition, named, {
        ticket: seeded.ticket,
        sequence: seeded.seq,
        escalation: "WorkFailureEscalated",
        offers: ["Resume", "Revoke"],
      });
    else await seedJournalEntry(subject.harness, partition, named, seeded.seq);
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant,project,ticket) DO UPDATE SET phase=excluded.phase`,
      [
        partition.tenant,
        partition.project,
        seeded.ticket,
        seeded.phase,
        seeded.seq,
      ],
    );
  }
  return partition;
}

/** Every ticket the latest-executions read was asked for, each answered with a run. */
function inboxLatest(): {
  readonly reads: Pick<OperationalReadStore, "ticketLatestExecutions">;
  readonly asked: number[];
} {
  const asked: number[] = [];
  return {
    asked,
    reads: {
      ticketLatestExecutions: (_partition, tickets) => {
        asked.push(...tickets);
        return Promise.resolve(
          tickets.map((ticket) => ({
            ...executionSummary,
            execution: asExecutionId(`run-${String(ticket)}`),
            ticket,
          })),
        );
      },
    },
  };
}

interface InboxOver {
  readonly pool?: pg.Pool;
  readonly latest?: Pick<OperationalReadStore, "ticketLatestExecutions">;
}

/** The inbox of `partition` read by `reader` under `over`. */
function inboxOf(partition: Partition, over: InboxOver = {}) {
  const access = memoryProjectAccess();
  access.grant({
    partition,
    principal: reader,
    access: dispatcher,
  });
  const pool = over.pool ?? subject.pool;
  const inbox = projectInbox(access, {
    store: postgresInboxReads(pool),
    operationalReads: over.latest ?? postgresOperationalReads(pool),
  });
  return async (query: ProjectInboxQuery): Promise<ProjectInboxPage> => {
    const read = await inbox.read(reader, partition, query);
    if (read.result !== "Authorized")
      throw new Error("the inbox refused its reader");
    return read.value;
  };
}

/** Every page of a walk `limit` at a time: the tickets each answered, its count, and whether it said there was more. */
async function inboxWalked(
  read: (query: ProjectInboxQuery) => Promise<ProjectInboxPage>,
  limit: number,
): Promise<readonly (readonly [readonly number[], number, boolean])[]> {
  const pages: (readonly [readonly number[], number, boolean])[] = [];
  let after: ProjectInboxQuery["after"];
  for (let page = 0; page < 10; page += 1) {
    const answered = await read({
      limit,
      ...(after === undefined ? {} : { after }),
    });
    pages.push([
      answered.entries.map((entry) => entry.ticket.ticket),
      answered.count,
      answered.nextAfter !== undefined,
    ]);
    if (answered.nextAfter === undefined) return pages;
    after = answered.nextAfter;
  }
  throw new Error("inbox case: a walk did not end");
}

/**
 * Six tickets, newest activity last: 1 escalated with an action open, 2 past
 * the section with an action open, 3 and 4 pending with nothing on them,
 * 5 escalated alone, 6 working with nothing on it.
 */
const inboxUnion: readonly InboxSeeded[] = [
  { ticket: 1, phase: "Escalated", seq: 1, action: true },
  { ticket: 2, phase: "Finalization", seq: 2, action: true },
  { ticket: 3, phase: "Pending", seq: 3 },
  { ticket: 4, phase: "Pending", seq: 4 },
  { ticket: 5, phase: "Escalated", seq: 5 },
  { ticket: 6, phase: "Work", seq: 6 },
];

test("the inbox is one entry for each ticket either of its sources names, each with its row and latest execution", async () => {
  const partition = await inboxProject("inbox-union", inboxUnion);
  const latest = inboxLatest();
  const page = await inboxOf(partition, { latest: latest.reads })({
    limit: 10,
  });
  assert.deepEqual(
    page.entries.map((entry) => [
      entry.ticket.ticket,
      entry.ticket.phase,
      entry.actions.map((action) => action.action),
      entry.ticket.latestExecution?.execution,
    ]),
    [
      [5, "Escalated", [], "run-5"],
      [2, "Finalization", ["inbox-union-2"], "run-2"],
      [1, "Escalated", ["inbox-union-1"], "run-1"],
    ],
  );
  assert.equal(page.count, 3);
  assert.equal(page.nextAfter, undefined);
  assert.deepEqual(latest.asked, [5, 2, 1]);
});

test("a walk of the cursor answers every entry once, the whole count on every page, and no more on the last", async () => {
  const partition = await inboxProject("inbox-walk", inboxUnion);
  const read = inboxOf(partition);
  assert.deepEqual(await inboxWalked(read, 2), [
    [[5, 2], 3, true],
    [[1], 3, false],
  ]);
  assert.deepEqual(await inboxWalked(read, 3), [[[5, 2, 1], 3, false]]);
});

test("another project's tickets and actions are never in the inbox", async () => {
  const mine = await inboxProject("inbox-mine", [
    { ticket: 1, phase: "Work", seq: 1 },
  ]);
  const theirs = await inboxProject("inbox-theirs", inboxUnion);
  const read = inboxOf(mine);
  assert.deepEqual(await read({ limit: 10 }), { entries: [], count: 0 });
  assert.equal((await inboxOf(theirs)({ limit: 10 })).count, 3);
});

/** The statements a pool and the clients it lends run, as `pg` is handed each. */
function inboxPoolHeard(pool: pg.Pool): {
  readonly pool: pg.Pool;
  readonly heard: string[];
} {
  const heard: string[] = [];
  const said = (config: unknown): string =>
    typeof config === "string" ? config : (config as pg.QueryConfig).text;
  const listened = <T extends object>(target: T, connect: boolean): T =>
    new Proxy(target, {
      get: (held, key): unknown => {
        const value: unknown = Reflect.get(held, key);
        if (key === "query")
          return (config: unknown, ...rest: unknown[]) => {
            heard.push(said(config));
            return (value as (...args: unknown[]) => unknown).call(
              held,
              config,
              ...rest,
            );
          };
        if (key === "connect" && connect)
          return async () =>
            listened(await (held as unknown as pg.Pool).connect(), false);
        return typeof value === "function" ? value.bind(held) : value;
      },
    });
  return { pool: listened(pool, true), heard };
}

test("a page of a hundred entries is read in the statements a page of one is, none correlated on an outer row", async () => {
  const partition = await inboxProject("inbox-statements", [
    { ticket: 1, phase: "Escalated", seq: 1, action: true },
  ]);
  await subject.harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     SELECT $1,$2,ticket,'Escalated',1 FROM generate_series(2,120) AS ticket`,
    [partition.tenant, partition.project],
  );
  const statements = async (limit: number) => {
    const { pool, heard } = inboxPoolHeard(subject.pool);
    const page = await inboxOf(partition, { pool })({ limit });
    assert.equal(page.entries.length, limit);
    assert.equal(page.count, 120);
    return heard;
  };
  const one = await statements(1);
  const hundred = await statements(100);
  assert.equal(hundred.length, one.length);
  assert.deepEqual(hundred.flatMap(postgresStatementCorrelated), []);
  assert.ok(
    hundred.some((text) => /\bWITH acted AS\b/u.test(text)),
    "the positions were read in a statement of their own",
  );
});
