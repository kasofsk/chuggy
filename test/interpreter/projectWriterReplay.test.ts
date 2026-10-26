/**
 * A writer's replay steps each row's own ticket and still decides what a
 * replay over the whole fleet decided: after every row of every journal here,
 * the same graph, ledgers, ticket versions and projection, and at every row the
 * same projection changes with or without a decision's evidence. Legality
 * answers every journal, and every journal with one row dropped, repeated or
 * swapped, as the fold over the whole prefix answers it.
 *
 * THE ORACLE IS THE WHOLE-FLEET REPLAY, KEPT HERE. Each row is stepped through
 * `replayStep` over the whole graph and the whole projection re-read against
 * the state before it; legality is folded over the whole prefix, each row
 * checked against the whole fleet's graph.
 *
 * THE JOURNALS are every golden's decided rows, the pinned journal that
 * reworks, resumes every wall and revokes mid-run, and seeded walks of the
 * machine at fleets wider than the model's instance, where releases depend on
 * one another. Together they replay every event arm, which is asserted rather
 * than assumed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import {
  eventPayloadTicketAgrees,
  eventTicketStands,
  failureTaskCurrent,
  genesis,
  replayStep,
  storedAtCurrentSemantics,
  storedJournalLegalOn,
  type Replayed,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import type { Config } from "../../src/domain/config.ts";
import { graphEquals, ticketEquals } from "../../src/domain/equality.ts";
import { eventTicket, evolve } from "../../src/domain/evolve.ts";
import {
  ticketEventTags,
  type Entry,
  type TicketEvent,
  type TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { genesisLedgers } from "../../src/domain/ledger.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { decodeEntry } from "../../src/generated/model-api.ts";
import {
  deriveDispatchCandidates,
  type DispatchCandidate,
  type DispatchContractPin,
} from "../../src/interpreter/dispatchView.ts";
import type {
  ProjectDecision,
  TicketProjection,
} from "../../src/interpreter/projectDecision.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type ProjectStore,
} from "../../src/interpreter/projectStore.ts";
import {
  IntegrityContradiction,
  projectionChanges,
  projectionOf,
  projectWriterLoad,
  projectWriterReplay,
  type ProjectTicketWriter,
  type TicketEscalationEvidence,
} from "../../src/interpreter/projectWriter.ts";
import { journalOf, loadCorpus } from "../golden/corpus.ts";
import { walkRecord, walkRun } from "../random/walk.ts";

/** A journal under the name a failure is found by. */
interface Journal {
  readonly name: string;
  readonly stored: readonly StoredEntry[];
}

/** One row as the whole-fleet replay took it: the state either side, the rows it changed, and every version after it. */
interface OracleRow {
  readonly pre: Replayed;
  readonly post: Replayed;
  readonly changes: readonly TicketProjection[];
  readonly versions: ReadonlyMap<number, number>;
}

/** The rows the whole projection after a row holds that differ from the state before it. */
function oracleChanges(
  pre: TicketGraph,
  post: TicketGraph,
  escalated?: TicketEscalationEvidence,
): readonly TicketProjection[] {
  return projectionOf(post, escalated).filter((row) => {
    const previous = pre.tickets.get(row.ticket);
    return (
      previous === undefined ||
      !ticketEquals(previous, ticketAt(post, row.ticket))
    );
  });
}

/** The whole-fleet replay: every row stepped over the whole graph, its changes read off the whole projection. */
function oracleReplay(stored: readonly StoredEntry[]): readonly OracleRow[] {
  let pre: Replayed = { graph: genesis, ledgers: genesisLedgers };
  const versions = new Map<number, number>();
  return stored.map(({ entry }) => {
    const post = replayStep(pre, entry.event);
    const changes = oracleChanges(pre.graph, post.graph);
    for (const row of changes) versions.set(row.ticket, entry.seq);
    const taken = { pre, post, changes, versions: new Map(versions) };
    pre = post;
    return taken;
  });
}

/** Legality folded over the whole prefix, each row checked against the whole fleet's graph. */
function oracleLegalOn(stored: readonly StoredEntry[]): boolean {
  return stored.reduce(
    (held, row) => {
      const event = row.entry.event;
      if (
        !held.ok ||
        row.semantics !== decisionSemanticsVersionCurrent ||
        row.entry.seq !== held.next ||
        !eventTicketStands(held.graph, event)
      )
        return { ...held, ok: false };
      const evolved = evolve(held.graph, event);
      return {
        ok:
          !graphEquals(evolved, held.graph) &&
          eventPayloadTicketAgrees(event) &&
          failureTaskCurrent(held.graph, event),
        graph: evolved,
        next: held.next + 1,
      };
    },
    { ok: true, graph: genesis, next: 1 },
  ).ok;
}

/** The pinned journal `test/actor/storedBeforeTicketState.test.ts` derives from. */
function drivenJournal(): Journal {
  const pinned = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        "..",
        "actor",
        "stored-before-ticket-state.json",
      ),
      "utf8",
    ),
  ) as {
    readonly result: Readonly<
      Record<string, { readonly rows: readonly { readonly entry: unknown }[] }>
    >;
  };
  const name = "stored-rework-and-finalization-resume";
  const rows = pinned.result[name]?.rows;
  assert.ok(rows, `the pin holds no ${name}`);
  return {
    name,
    stored: storedAtCurrentSemantics(rows.map((row) => decodeEntry(row.entry))),
  };
}

/** The steps a walk takes, past the rows it settles at. */
const walkStepsMax = 150;

/** The rows a seeded walk of the machine journals at `config`. */
function walkJournal(config: Config, seed: number): Journal {
  const name = `walk nTickets=${String(config.nTickets)} seed=${String(seed)}`;
  const run = walkRun(config, seed, walkStepsMax);
  assert.equal(run.finding, undefined, `${name} found a defect`);
  const entries: Entry[] = [];
  for (const { step, view } of walkRecord(config, run.steps)) {
    const last = view.last;
    if (
      step.action !== "settle" &&
      last !== "NoDecision" &&
      last.type === "Decided"
    )
      entries.push({ seq: entries.length + 1, event: last.value.event });
  }
  return { name, stored: storedAtCurrentSemantics(entries) };
}

const corpus = loadCorpus();

const journals: readonly Journal[] = [
  ...corpus.rows.map((row) => ({
    name: row.name,
    stored: storedAtCurrentSemantics(journalOf(row)),
  })),
  drivenJournal(),
  ...[3, 5, 8].flatMap((nTickets) =>
    Array.from({ length: 12 }, (_, at) =>
      walkJournal({ nTickets, nTasks: 2, maxStages: 2 }, at + 1),
    ),
  ),
];

/** Evidence of a wall for the ticket an event names, as a fabric would carry it. */
function evidenceFor(event: TicketEvent): TicketEscalationEvidence {
  return { ticket: eventTicket(event), evidence: "RefUnreadable" };
}

/** What a projection call answered: its rows, or the contradiction it refused with. */
function answered(call: () => readonly TicketProjection[]): unknown {
  try {
    return call();
  } catch (error: unknown) {
    if (error instanceof IntegrityContradiction)
      return "IntegrityContradiction";
    throw error;
  }
}

test("together the journals replay every event arm", () => {
  const replayed = new Set(
    journals.flatMap((journal) =>
      journal.stored.map((row) => row.entry.event.type),
    ),
  );
  assert.deepEqual(
    ticketEventTags.filter((tag) => !replayed.has(tag)),
    [],
  );
});

for (const journal of journals) {
  test(`${journal.name}: the replay after every row is the whole-fleet replay's`, () => {
    const oracle = oracleReplay(journal.stored);
    for (let at = 0; at <= journal.stored.length; at += 1) {
      const replayed = projectWriterReplay(journal.stored.slice(0, at));
      const expected = oracle[at - 1];
      const where = `${journal.name} after row ${String(at)}`;
      assert.deepEqual(replayed.graph, expected?.post.graph ?? genesis, where);
      assert.deepEqual(
        replayed.ledgers,
        expected?.post.ledgers ?? genesisLedgers,
        where,
      );
      assert.deepEqual(
        replayed.ticketVersions,
        expected?.versions ?? new Map(),
        where,
      );
      assert.deepEqual(
        projectionOf(replayed.graph),
        projectionOf(expected?.post.graph ?? genesis),
        where,
      );
    }
  });

  test(`${journal.name}: every row changes the projection rows the whole-fleet replay changed`, () => {
    oracleReplay(journal.stored).forEach(({ pre, post, changes }, at) => {
      const event = journal.stored[at]?.entry.event;
      assert.ok(event);
      const where = `${journal.name} row ${String(at + 1)} (${event.type})`;
      assert.deepEqual(
        projectionChanges(pre.graph, post.graph, event),
        changes,
        where,
      );
      assert.deepEqual(
        answered(() =>
          projectionChanges(pre.graph, post.graph, event, evidenceFor(event)),
        ),
        answered(() =>
          oracleChanges(pre.graph, post.graph, evidenceFor(event)),
        ),
        where,
      );
    });
  });
}

test("a row's projection changes are its own ticket's, whatever else in the graph differs", () => {
  const journal = walkJournal({ nTickets: 5, nTasks: 2, maxStages: 2 }, 1);
  const oracle = oracleReplay(journal.stored);
  const last = oracle.at(-1)?.post.graph ?? genesis;
  const found = oracle
    .flatMap(({ pre, post }, at) => {
      const event = journal.stored[at]?.entry.event;
      if (event === undefined) return [];
      const named = eventTicket(event);
      const other = [...pre.graph.tickets.keys()].find(
        (id) =>
          id !== named &&
          !ticketEquals(ticketAt(pre.graph, id), ticketAt(last, id)),
      );
      return other === undefined ? [] : [{ pre, post, event, other }];
    })
    .at(0);
  assert.ok(found, "a row whose graph holds another ticket that later moves");
  const moved: TicketGraph = {
    tickets: new Map(found.post.graph.tickets).set(
      found.other,
      ticketAt(last, found.other),
    ),
  };
  assert.deepEqual(
    projectionChanges(found.pre.graph, moved, found.event),
    oracleChanges(found.pre.graph, found.post.graph),
  );
});

/** Lays a journal's rows at dense seqs from the first. */
function renumbered(stored: readonly StoredEntry[]): readonly StoredEntry[] {
  return stored.map((row, at) => ({
    ...row,
    entry: { ...row.entry, seq: at + 1 },
  }));
}

/** The journal with one row dropped, repeated or swapped with the next, at every row, and once with a seq gap. */
function perturbationsOf(
  stored: readonly StoredEntry[],
): readonly (readonly StoredEntry[])[] {
  return [
    stored,
    stored.filter((_, at) => at !== 1),
    ...stored.flatMap((row, at) => {
      const next = stored[at + 1];
      const before = stored.slice(0, at);
      const after = stored.slice(at + 1);
      return [
        renumbered([...before, ...after]),
        renumbered([...before, row, row, ...after]),
        ...(next === undefined
          ? []
          : [renumbered([...before, next, row, ...stored.slice(at + 2)])]),
      ];
    }),
  ];
}

test("legality answers every journal and every perturbation of one as the whole-prefix fold does", () => {
  const answers = new Set<boolean>();
  for (const journal of journals) {
    perturbationsOf(journal.stored).forEach((stored, at) => {
      const legal = oracleLegalOn(stored);
      assert.equal(
        storedJournalLegalOn(stored),
        legal,
        `${journal.name} perturbation ${String(at)}`,
      );
      answers.add(legal);
    });
    assert.ok(storedJournalLegalOn(journal.stored), journal.name);
  }
  assert.deepEqual([...answers].sort(), [false, true]);
});

const contract: DispatchContractPin = {
  configurationRevision: "r",
  configurationDigest: "d",
  configurationCanonical: "c",
};

/** A writer whose store holds `stored`, pinning every release, and which keeps each dispatch view a load rebuilds. */
function loadingWriter(
  stored: readonly StoredEntry[],
  rebuilt: (readonly DispatchCandidate[])[],
): ProjectTicketWriter {
  const contracts = new Map(
    stored.flatMap(({ entry }) =>
      entry.event.type === "TicketCreated"
        ? [[entry.event.value.id, contract] as const]
        : [],
    ),
  );
  const store: Pick<ProjectStore, "load" | "loadDispatchContracts"> = {
    load: () => Promise.resolve({ parsed: "Ok", value: stored }),
    loadDispatchContracts: () => Promise.resolve(contracts),
  };
  const decisions: Pick<ProjectDecision, "rebuildDispatchView"> = {
    rebuildDispatchView: (_lease, view) => {
      rebuilt.push(view.candidates);
      return Promise.resolve();
    },
  };
  return { store, decisions } as unknown as ProjectTicketWriter;
}

test("a load holds and publishes what the whole-fleet replay reached", async () => {
  for (const journal of journals) {
    const rebuilt: (readonly DispatchCandidate[])[] = [];
    const memory = await projectWriterLoad(
      loadingWriter(journal.stored, rebuilt),
      {
        partition: {
          tenant: asTenantId("tenant"),
          project: asProjectId("project"),
        },
        owner: asOwnerId("owner"),
        fencingEpoch: 1,
        recoveryEpoch: asRecoveryEpoch("epoch"),
        head: journal.stored.length,
      },
    );
    const last = oracleReplay(journal.stored).at(-1);
    assert.ok(last, journal.name);
    assert.deepEqual(memory.graph, last.post.graph, journal.name);
    assert.deepEqual(memory.ledgers, last.post.ledgers, journal.name);
    assert.deepEqual(memory.ticketVersions, last.versions, journal.name);
    assert.ok(memory.dispatchContracts, journal.name);
    assert.deepEqual(
      rebuilt,
      [
        deriveDispatchCandidates(
          last.post.graph,
          last.versions,
          memory.dispatchContracts,
        ),
      ],
      journal.name,
    );
  }
});
