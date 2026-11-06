/**
 * The epic store against a real server: the door agrees with the domain's
 * decision, numbers stay gapless under concurrency, and the reads derive
 * their figures from the members' phases.
 *
 * PARITY IS ASKED CASE BY CASE. Each case runs a sequence of writes through
 * `decideEpic` over an in-memory state and through the door over the
 * database, and the two outcomes must be equal at every step. The domain is
 * handed the content as the wire normalizes it and the door the content as
 * written, so the door is held to that normalization too.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresEpics,
  epicsForTickets,
} from "../../src/adapters/postgres/epics.ts";
import { epicContentSchema } from "../../src/contract/epics.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import {
  applyEpic,
  decideEpic,
  epicContentBytesMax,
  epicSummaryCharsMax,
  epicTicketsMax,
  epicTitleCharsMax,
  type EpicCommand,
  type EpicContent,
  type EpicState,
} from "../../src/domain/epics.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterLoad,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { finalizerRigOpen, type FinalizerRig } from "./finalizerHarness.ts";
import {
  postgresHarnessDrain,
  postgresHarnessHeld,
  postgresHarnessProject,
  postgresHarnessReleaseSubmission,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
  postgresHarnessWriter,
} from "./harness.ts";

let rig: FinalizerRig;
let apiPool: pg.Pool;
before(async () => {
  rig = await finalizerRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await apiPool.end();
  await rig.close();
});

/** Room for the tickets a case releases, which the refinement instance's two do not give. */
const roomy = { ...refinementInstance, nTickets: 6 };

const actor = { kind: "Member", subject: "someone" };

interface Project {
  readonly partition: Partition;
  memory: ProjectMemory;
  readonly tickets: number[];
}

/** A project holding `count` tickets, `deps` naming for each the earlier ones it waits on by position. */
async function opened(
  label: string,
  deps: readonly (readonly number[])[],
): Promise<Project> {
  const partition = await postgresHarnessProject(rig.harness.store, label);
  const at: Project = {
    partition,
    memory: await projectWriterLoad(
      postgresHarnessWriter(rig.harness, roomy),
      await postgresHarnessHeld(rig.harness.store, partition, label),
    ),
    tickets: [],
  };
  for (const [position, waitsOn] of deps.entries()) {
    const name = `${label}-${String(position)}`;
    const release = await postgresHarnessReleaseSubmission(
      rig.harness,
      partition,
      name,
      {
        ...plainAuthoring,
        deps: new Set(waitsOn.map((each) => at.tickets[each] ?? each)),
      },
    );
    if (release.command.command !== "ReleaseDraft")
      assert.fail("that submission releases no draft");
    const submission = {
      ...postgresHarnessSubmission(partition, `${name}-release`),
      command: release.command,
    };
    assert.equal(
      (await rig.harness.inbox.accept(submission)).accepted,
      "Accepted",
    );
    const drained = await postgresHarnessDrain(
      rig.harness,
      partition,
      at.memory,
      roomy,
    );
    at.memory = drained.memory;
    assert.deepEqual(drained.decided, ["Committed"]);
    at.tickets.push(release.command.ticket);
  }
  return at;
}

function content(patch: Partial<EpicContent> = {}): EpicContent {
  return {
    title: "Epic",
    description: "About",
    visibility: "Active",
    ...patch,
    tickets: [...new Set(patch.tickets ?? [])].sort(
      (left, right) => left - right,
    ),
  };
}

const create = (patch?: Partial<EpicContent>): EpicCommand => ({
  kind: "Create",
  content: content(patch),
});

const revise = (
  epic: number,
  expected: number,
  patch?: Partial<EpicContent>,
): EpicCommand => ({
  kind: "Revise",
  epic,
  expected,
  content: content(patch),
});

/** Runs each command through the domain and the door and answers once they have agreed at every step. A draft the project holds counts as a ticket to both, and this harness files none. */
async function agreed(
  at: Project,
  commands: readonly EpicCommand[],
): Promise<readonly string[]> {
  const store = postgresEpics(apiPool);
  const known = new Set(at.tickets);
  let state: EpicState = new Map();
  const answers: string[] = [];
  for (const command of commands) {
    const normalized = {
      ...command,
      content: epicContentSchema.parse(command.content),
    };
    const decided = decideEpic(state, normalized, (ticket) =>
      known.has(ticket),
    );
    const stored = await store.save(at.partition, command, actor);
    assert.deepEqual(stored, decided, JSON.stringify(command));
    state = applyEpic(state, normalized, decided);
    answers.push(decided.kind === "Saved" ? "Saved" : decided.reason);
  }
  return answers;
}

test("the door agrees with the domain on every refusal and on saving", async () => {
  const at = await opened("epic-parity", [[], [0]]);
  const [first, second] = at.tickets;
  assert.ok(first !== undefined && second !== undefined);
  const answers = await agreed(at, [
    create({ tickets: [second, first, first] }),
    create({ title: "  " }),
    create({ title: "x".repeat(epicTitleCharsMax + 1) }),
    create({ title: "\u{1F600}".repeat(epicTitleCharsMax) }),
    create({ summary: "x".repeat(epicSummaryCharsMax + 1) }),
    create({ summary: "  " }),
    create({ description: "x".repeat(epicContentBytesMax) }),
    create({ description: "é".repeat(epicContentBytesMax / 2) }),
    create({ tickets: [first, 999_999, 888_888] }),
    revise(9, 1),
    revise(1, 5),
    revise(1, 1, { tickets: [first] }),
    create({ visibility: "Archived", tickets: [first] }),
    revise(3, 1, { visibility: "Archived", tickets: [] }),
    revise(3, 1, { visibility: "Archived", tickets: [first], title: "Same" }),
    revise(3, 1, { visibility: "Active", tickets: [second] }),
    revise(3, 2, { visibility: "Archived", tickets: [second] }),
  ]);
  assert.deepEqual(answers.slice(0, 3), ["Saved", "EmptyTitle", "LongTitle"]);
  assert.ok(answers.includes("StaleRevision"));
  assert.ok(answers.includes("ArchivedEpic"));
  assert.ok(answers.includes("UnknownTickets"));
  assert.ok(answers.includes("LargeContent"));
  assert.ok(answers.includes("MissingEpic"));
  assert.ok(answers.includes("LongSummary"));
});

test("the door's member bound is the domain's, refused before an unknown member", async () => {
  const at = await opened("epic-members", []);
  const numbers = (count: number) =>
    Array.from({ length: count }, (_, index) => 900_000 + index);
  assert.deepEqual(
    await agreed(at, [
      create({ tickets: numbers(epicTicketsMax + 1) }),
      create({ tickets: numbers(epicTicketsMax) }),
    ]),
    ["ManyTickets", "UnknownTickets"],
  );
});

test("a title of whitespace alone is empty to the door as to the domain, whichever whitespace", async () => {
  const at = await opened("epic-blank", []);
  const blanks = Array.from({ length: 0x10000 }, (_, unit) =>
    String.fromCharCode(unit),
  ).filter((text) => text.trim() === "");
  const answers = await agreed(
    at,
    blanks.flatMap((blank) => [
      create({ title: blank, tickets: [] }),
      create({ title: `${blank}x${blank}`, tickets: [] }),
    ]),
  );
  assert.deepEqual(
    answers,
    blanks.flatMap(() => ["EmptyTitle", "Saved"]),
  );
});

test("concurrent creates take distinct numbers with no gap", async () => {
  const at = await opened("epic-concurrent", []);
  const store = postgresEpics(apiPool);
  const saved = await Promise.all(
    Array.from({ length: 8 }, () => store.save(at.partition, create(), actor)),
  );
  const numbers = saved
    .map((outcome) => (outcome.kind === "Saved" ? outcome.epic : -1))
    .sort((left, right) => left - right);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("a stale revise is refused with the current revision and changes nothing", async () => {
  const at = await opened("epic-stale", []);
  const store = postgresEpics(apiPool);
  await store.save(at.partition, create(), actor);
  await store.save(at.partition, revise(1, 1, { title: "Second" }), actor);
  assert.deepEqual(
    await store.save(at.partition, revise(1, 1, { title: "Lost" }), actor),
    { kind: "Refused", reason: "StaleRevision", current: 2 },
  );
  assert.equal((await store.view(at.partition, 1))?.title, "Second");
});

test("history keeps every revision, newest first, and pages", async () => {
  const at = await opened("epic-history", []);
  const store = postgresEpics(apiPool);
  await store.save(at.partition, create({ title: "One" }), actor);
  await store.save(at.partition, revise(1, 1, { title: "Two" }), actor);
  await store.save(at.partition, revise(1, 2, { title: "Three" }), actor);
  const first = await store.history(at.partition, 1, { limit: 2 });
  assert.deepEqual(
    first?.revisions.map((each) => [each.revision, each.title]),
    [
      [3, "Three"],
      [2, "Two"],
    ],
  );
  assert.equal(first?.nextAfter, 2);
  const rest = await store.history(at.partition, 1, { limit: 2, after: 2 });
  assert.deepEqual(
    rest?.revisions.map((each) => each.title),
    ["One"],
  );
  assert.equal(rest?.nextAfter, undefined);
  assert.equal(await store.history(at.partition, 9, { limit: 2 }), undefined);
});

test("a revise replaces the members and the list filters by them", async () => {
  const at = await opened("epic-members", [[], [], []]);
  const [a, b, c] = at.tickets;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const store = postgresEpics(apiPool);
  await store.save(at.partition, create({ tickets: [a, b] }), actor);
  await store.save(at.partition, revise(1, 1, { tickets: [b, c] }), actor);
  assert.deepEqual((await store.view(at.partition, 1))?.tickets, [b, c]);
  const holding = (ticket: number) =>
    store
      .list(at.partition, { limit: 20, ticket })
      .then((page) => page.epics.map((each) => each.number));
  assert.deepEqual(await holding(a), []);
  assert.deepEqual(await holding(c), [1]);
});

test("a list filters by visibility and search, and sorts and pages by title", async () => {
  const at = await opened("epic-list", []);
  const store = postgresEpics(apiPool);
  for (const title of ["Banana", "apple", "Cherry"])
    await store.save(at.partition, create({ title }), actor);
  await store.save(
    at.partition,
    create({ title: "Old", visibility: "Archived", summary: "needle" }),
    actor,
  );
  const titles = async (query: Parameters<typeof store.list>[1]) =>
    (await store.list(at.partition, query)).epics.map((each) => each.title);
  assert.deepEqual(await titles({ limit: 20 }), ["Cherry", "apple", "Banana"]);
  assert.deepEqual(await titles({ limit: 20, sort: "oldest" }), [
    "Banana",
    "apple",
    "Cherry",
  ]);
  assert.deepEqual(await titles({ limit: 20, visibility: "Archived" }), [
    "Old",
  ]);
  assert.equal((await titles({ limit: 20, visibility: "All" })).length, 4);
  assert.deepEqual(
    await titles({ limit: 20, visibility: "All", search: "NEEDLE" }),
    ["Old"],
  );
  const walked: string[] = [];
  let after: number | undefined;
  for (let pages = 0; pages < 4; pages += 1) {
    const page = await store.list(at.partition, {
      limit: 2,
      sort: "title",
      visibility: "All",
      ...(after === undefined ? {} : { after }),
    });
    walked.push(...page.epics.map((each) => each.title));
    after = page.nextAfter;
    if (after === undefined) break;
  }
  assert.deepEqual(walked, ["apple", "Banana", "Cherry", "Old"]);
});

/** Moves a ticket to `phase` the way the projection holds it, which is all the derived figures read. */
async function moved(at: Project, ticket: number, phase: string) {
  await rig.harness.query(
    `UPDATE ticket_projection SET phase=$4
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [at.partition.tenant, at.partition.project, ticket, phase],
  );
}

test("progress and status derive from the members' phases, Revoked left out", async () => {
  const at = await opened("epic-status", [[], [0], [1]]);
  const [a, b, c] = at.tickets;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const store = postgresEpics(apiPool);
  await store.save(at.partition, create({ title: "Empty" }), actor);
  await store.save(at.partition, create({ tickets: [b, c] }), actor);
  const read = async (epic: number) => {
    const view = await store.view(at.partition, epic);
    assert.ok(view !== undefined);
    return view;
  };
  assert.equal((await read(1)).status, "empty");
  const pending = await read(2);
  assert.equal(pending.status, "not_started");
  assert.deepEqual([pending.progress.done, pending.progress.total], [0, 2]);
  assert.deepEqual(pending.waitingOnOutside, [a]);
  await moved(at, b, "Work");
  assert.equal((await read(2)).status, "in_progress");
  await moved(at, c, "Escalated");
  assert.equal((await read(2)).status, "attention");
  await moved(at, b, "Done");
  await moved(at, c, "Revoked");
  const finished = await read(2);
  assert.equal(finished.status, "done");
  assert.deepEqual([finished.progress.done, finished.progress.total], [1, 1]);
  assert.equal(finished.progress.byPhase.Revoked, 1);
  await moved(at, a, "Done");
  const listed = await store.list(at.partition, { limit: 20 });
  assert.deepEqual(
    listed.epics.map((each) => [each.number, each.status]),
    [
      [2, "done"],
      [1, "empty"],
    ],
  );
  assert.deepEqual(listed.epics[0]?.waitingOnOutside, []);
});

test("a Pending member waits on an outside ticket only until it is Done", async () => {
  const at = await opened("epic-waiting", [[], [0], [1]]);
  const [a, b, c] = at.tickets;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const store = postgresEpics(apiPool);
  await store.save(at.partition, create({ tickets: [b, c] }), actor);
  assert.deepEqual((await store.view(at.partition, 1))?.waitingOnOutside, [a]);
  await moved(at, a, "Revoked");
  assert.deepEqual((await store.view(at.partition, 1))?.waitingOnOutside, [a]);
  await moved(at, a, "Done");
  assert.deepEqual((await store.view(at.partition, 1))?.waitingOnOutside, []);
});

test("the graph carries members, outside dependencies as external nodes, and an edge from each dependency", async () => {
  const at = await opened("epic-graph", [[], [0], [1]]);
  const [a, b, c] = at.tickets;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const store = postgresEpics(apiPool);
  await store.save(at.partition, create({ tickets: [b, c] }), actor);
  const graph = await store.graph(at.partition, 1);
  assert.deepEqual(
    graph?.nodes.map((node) => [node.ticket, node.member, node.phase]),
    [
      [a, false, "Pending"],
      [b, true, "Pending"],
      [c, true, "Pending"],
    ],
  );
  assert.deepEqual(graph?.edges, [
    { from: a, to: b },
    { from: b, to: c },
  ]);
  assert.equal(await store.graph(at.partition, 9), undefined);
});

/** Counts what a queryable is asked, so a read can be held to its one query. */
function counting(pool: pg.Pool): {
  query: pg.Pool["query"];
  asked: () => number;
} {
  let asked = 0;
  const query = ((...args: unknown[]) => {
    asked += 1;
    return (pool.query as (...inner: unknown[]) => unknown)(...args);
  }) as pg.Pool["query"];
  return { query, asked: () => asked };
}

test("a ticket on several epics is named by all of them in one query", async () => {
  const at = await opened("epic-several", [[], []]);
  const [a, b] = at.tickets;
  assert.ok(a !== undefined && b !== undefined);
  const store = postgresEpics(apiPool);
  await store.save(
    at.partition,
    create({ title: "First", tickets: [a, b] }),
    actor,
  );
  await store.save(
    at.partition,
    create({ title: "Second", visibility: "Archived", tickets: [a] }),
    actor,
  );
  const spy = counting(apiPool);
  const found = await epicsForTickets(spy, at.partition, [a, b]);
  assert.equal(spy.asked(), 1);
  assert.deepEqual(found.get(a), [
    { number: 1, title: "First", visibility: "Active" },
    { number: 2, title: "Second", visibility: "Archived" },
  ]);
  assert.deepEqual(found.get(b), [
    { number: 1, title: "First", visibility: "Active" },
  ]);
});

test("the ticket list and the ticket read carry epics, and the list filters by one", async () => {
  const at = await opened("epic-reads", [[], [], []]);
  const [a, b, c] = at.tickets;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  await postgresEpics(apiPool).save(
    at.partition,
    create({ title: "Mine", tickets: [a, c] }),
    actor,
  );
  const reads = postgresNativeReads(rig.harness.pool);
  const listed = await reads.project(at.partition, { limit: 10 });
  assert.equal(listed.result, "Found");
  if (listed.result !== "Found") return;
  assert.deepEqual(
    listed.project.tickets.map((ticket) => [
      ticket.ticket,
      ticket.epics?.length ?? 0,
    ]),
    [
      [a, 1],
      [b, 0],
      [c, 1],
    ],
  );
  const filtered = await reads.project(at.partition, { limit: 10, epic: 1 });
  assert.equal(filtered.result, "Found");
  if (filtered.result !== "Found") return;
  assert.deepEqual(
    filtered.project.tickets.map((ticket) => ticket.ticket),
    [a, c],
  );
  const one = await reads.ticket(at.partition, asTicketId(c));
  assert.deepEqual(one?.epics, [
    { number: 1, title: "Mine", visibility: "Active" },
  ]);
});

test("a save notifies each ticket whose epics its read now names differently, and no other", async () => {
  const at = await opened("epic-notified", [[], [], []]);
  const [a, b, c] = at.tickets;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const store = postgresEpics(apiPool);
  let seen = (
    await rig.harness.pool.query<{ latest: string }>(
      `SELECT coalesce(max(ordinal),0)::text AS latest FROM project_notification
        WHERE tenant=$1 AND project=$2`,
      [at.partition.tenant, at.partition.project],
    )
  ).rows[0]?.latest;
  const notified = async (command: EpicCommand): Promise<number[]> => {
    assert.equal(
      (await store.save(at.partition, command, actor)).kind,
      "Saved",
    );
    const rows = await rig.harness.pool.query<{
      ordinal: string;
      kind: string;
      resource: string;
    }>(
      `SELECT ordinal::text,kind,resource FROM project_notification
        WHERE tenant=$1 AND project=$2 AND ordinal>$3 ORDER BY ordinal`,
      [at.partition.tenant, at.partition.project, seen],
    );
    seen = rows.rows.at(-1)?.ordinal ?? seen;
    assert.ok(rows.rows.every((row) => row.kind === "Ticket"));
    return rows.rows.map((row) => Number(row.resource));
  };
  assert.deepEqual(await notified(create({ tickets: [a, b] })), [a, b]);
  assert.deepEqual(await notified(revise(1, 1, { tickets: [b, c] })), [a, c]);
  assert.deepEqual(
    await notified(revise(1, 2, { tickets: [b, c], summary: "Kept" })),
    [],
  );
  assert.deepEqual(
    await notified(revise(1, 3, { title: "Renamed", tickets: [c] })),
    [b, c],
  );
  assert.deepEqual(
    await notified(
      revise(1, 4, { title: "Renamed", visibility: "Archived", tickets: [c] }),
    ),
    [c],
  );
});
