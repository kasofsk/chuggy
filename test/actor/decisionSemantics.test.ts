/**
 * The rework wall's histories under the machine that decided them, on bytes
 * this tree can no longer produce.
 *
 * THE FIXTURES ARE PINNED AND NOT GENERATED. The golden traces are emitted by
 * the same tree that replays them, so a semantics change moves both sides at
 * once and no trace can witness one. Both files here were written by the
 * deciders at 919c7b6 and are the only record of what that machine decided.
 *
 * THEY COVER THE TWO SHAPES THE WALL CHANGED IN. `journalAtSemanticsOne.json`
 * is one ticket reworked once, walled and resumed, where the first semantics
 * resumed into evaluation and the current one resumes into work — a record
 * divergence. `journalAtSemanticsOneWalls.json` carries two walled tickets,
 * the second reworked before it walled, so one history holds an EvalReduce row
 * on each disposition edge: the bytes name neither, and the record is what
 * says which was taken.
 *
 * A PRE-3 ROW'S EVALREDUCE NAMED ONLY ITS TICKET, a shape the wire union this
 * image generates does not describe, so the bytes are lifted before they are
 * an event at all. That lift belongs to the seam a store's load reads a row
 * with, so these files are read through `parseStoredEntry` rather than through
 * a second copy of it here.
 *
 * THE SAME FILES CARRY THE KEYS SEMANTICS 4 DROPPED, so the acceptances below
 * are read off them rather than off bytes written to be accepted. The refusal
 * has no such fixture — no history in this tree was decided by the machine that
 * completed without a finalizer — so it is a pinned row under the record that
 * machine would have written.
 *
 * THE CASCADE HISTORY IS PINNED THE SAME WAY, in the shape the rig's rows
 * carry: a revoke whose record settles its own ticket and parks the two
 * dependents behind it, and then each dependent's own revoke out of the park.
 * Every record in it is written out rather than taken from a decision, because
 * the record under test is one no decider in this tree writes, and the records
 * after it are what says the parked tickets were left where a revoke could
 * still reach them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  decisionEventEnabled,
  dispatchEvent,
  execDecisionEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  revokeEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  genesis,
  journalLegalOn,
  storedJournalLegalOn,
  storedReplayCore,
  type Entry,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import {
  decisionSemanticsVersionCurrent,
  isDecisionSemanticsVersion,
  replayableDecision,
  type DecisionSemanticsVersion,
} from "../../src/actor/decisionSemantics.ts";
import { parseStoredEntry } from "../../src/interpreter/wire.ts";
import type {
  StepRecord,
  Transition,
} from "../../src/domain/generated/modelTypes.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { modelInstance } from "../domain/configs.ts";
import { id } from "../domain/fixtures.ts";
import { plainAuthoring, refinementInstance } from "./harness.ts";

const config = refinementInstance;

/** One pinned history, read exactly as a store's load reads a row of that vintage. */
function pinned(file: string): readonly Entry[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, file), "utf8"),
  );
  assert.ok(Array.isArray(raw), `${file} is not a journal`);
  return raw.map((row: unknown, at: number) => {
    const parsed = parseStoredEntry(row, 1);
    if (parsed.parsed === "Refused")
      throw new Error(`${file} row ${String(at)} is unreadable: ${parsed.why}`);
    return parsed.value;
  });
}

/** A pinned history as a store holding it would present it, every row at one semantics. */
function storedAt(
  entries: readonly Entry[],
  semantics: DecisionSemanticsVersion,
): readonly StoredEntry[] {
  return entries.map((entry) => ({ entry, semantics }));
}

const reworkedWall = pinned("journalAtSemanticsOne.json");
const walls = pinned("journalAtSemanticsOneWalls.json");

/** The record a release writes, which moves nothing that was already in the fleet. */
const released: StepRecord = {
  label: "ticket-released",
  transitions: [],
  effects: [],
};

/** What a dependent of the revoked ticket was released with. */
const behindTheRevoked = { ...plainAuthoring, deps: new Set<number>([1]) };

/** The rig's shape: a revoke that parked the two dependents, and their own revokes after it. */
const cascade: readonly Entry[] = [
  { seq: 1, event: releaseTicketEvent(id(1), plainAuthoring), rec: released },
  { seq: 2, event: releaseTicketEvent(id(2), behindTheRevoked), rec: released },
  { seq: 3, event: releaseTicketEvent(id(3), behindTheRevoked), rec: released },
  {
    seq: 4,
    event: revokeEvent(id(1)),
    rec: {
      label: "ticket-revoked",
      transitions: [
        { ticket: id(1), from: "Pending", to: "Revoked" },
        { ticket: id(2), from: "Pending", to: "Escalated" },
        { ticket: id(3), from: "Pending", to: "Escalated" },
      ],
      effects: ["CancelTicketWork", "OpenHumanTask", "OpenHumanTask"],
    },
  },
  {
    seq: 5,
    event: revokeEvent(id(2)),
    rec: {
      label: "ticket-revoked",
      transitions: [{ ticket: id(2), from: "Escalated", to: "Revoked" }],
      effects: ["CancelTicketWork"],
    },
  },
  {
    seq: 6,
    event: revokeEvent(id(3)),
    rec: {
      label: "ticket-revoked",
      transitions: [{ ticket: id(3), from: "Escalated", to: "Revoked" }],
      effects: ["CancelTicketWork"],
    },
  },
];

test("the reworked history walks the rework wall and resumes past it", () => {
  const walled = reworkedWall.filter(
    (entry) => entry.rec.label === "ticket-escalated rework_budget_exhausted",
  );
  const resumes = reworkedWall.filter(
    (entry) => entry.event.type === "ResumeTicket",
  );
  assert.equal(walled.length, 1);
  assert.equal(resumes.length, 1);
  assert.deepEqual(resumes[0]?.rec.effects, ["SpawnEvalTasks"]);
});

test("the reworked history is legal under the semantics its rows declare", () => {
  assert.ok(storedJournalLegalOn(config, storedAt(reworkedWall, 1)));
});

test("the same history read as this image's own decisions is not legal", () => {
  assert.ok(!storedJournalLegalOn(config, storedAt(reworkedWall, 2)));
  assert.ok(!journalLegalOn(config, reworkedWall));
});

test("replay under the first semantics resumes the walled ticket into evaluation", () => {
  const replayed = storedReplayCore(storedAt(reworkedWall, 1));
  assert.equal(ticketAt(replayed, id(1)).phase, "Evaluating");
  assert.equal(ticketAt(replayed, id(1)).resumeAt, "NoResume");
});

test("a row decided under an older machine than the row before it is refused", () => {
  const descending = reworkedWall.map((entry, at) => ({
    entry,
    semantics: at === 0 ? decisionSemanticsVersionCurrent : 1,
  }));
  assert.ok(!storedJournalLegalOn(config, descending));
});

test("the two-wall history holds an EvalReduce row on each disposition edge", () => {
  const reduces = walls.filter((entry) => entry.event.type === "EvalReduce");
  assert.deepEqual(
    reduces.map((entry) => entry.rec.label),
    [
      "ticket-escalated rework_budget_exhausted",
      "rework-started eval_failure",
      "ticket-escalated rework_budget_exhausted",
    ],
  );
  assert.ok(storedJournalLegalOn(config, storedAt(walls, 1)));
  assert.ok(!storedJournalLegalOn(config, storedAt(walls, 2)));
});

test("a second-semantics EvalReduce takes the edge its record records", () => {
  const toTheWall = storedAt(walls.slice(0, 6), 2);
  const walled = ticketAt(storedReplayCore(toTheWall), id(1));
  assert.equal(walled.phase, "Escalated");
  assert.equal(walled.reason, "ReworkBudgetExhausted");

  const toTheRework = storedAt(walls.slice(0, 13), 2);
  const reworked = ticketAt(storedReplayCore(toTheRework), id(2));
  assert.equal(reworked.phase, "Working");
});

test("the first semantics parks the wall at the eval resume, the second where this machine does", () => {
  const toTheWall = walls.slice(0, 6);
  assert.equal(
    ticketAt(storedReplayCore(storedAt(toTheWall, 1)), id(1)).resumeAt,
    "ResumeEvaluating",
  );
  assert.equal(
    ticketAt(storedReplayCore(storedAt(toTheWall, 2)), id(1)).resumeAt,
    "ResumeReworking",
  );
});

test("a parked ticket is resumable whichever semantics walled it", () => {
  const resume = resumeTicketEvent(id(1));
  const toTheWall = walls.slice(0, 6);
  for (const semantics of [1, 2] as const) {
    const at = storedReplayCore(storedAt(toTheWall, semantics));
    assert.ok(decisionEventEnabled(config, at, resume));
  }
});

test("a row parked on a wall this machine no longer has cannot be replayed", () => {
  const wall = walls[5];
  assert.ok(wall !== undefined);
  assert.ok(replayableDecision(wall));
  assert.ok(
    !replayableDecision({
      event: wall.event,
      rec: { ...wall.rec, label: "ticket-escalated gas_exhausted" },
    }),
  );
  assert.ok(
    !storedJournalLegalOn(config, [
      {
        entry: {
          ...wall,
          rec: { ...wall.rec, label: "ticket-escalated gas_exhausted" },
        },
        semantics: 1,
      },
    ]),
  );
});

test("the current semantics is the one whose refusals this module states", () => {
  assert.equal(decisionSemanticsVersionCurrent, 4);
  assert.ok(isDecisionSemanticsVersion(4));
  assert.ok(
    !isDecisionSemanticsVersion(5),
    "a row from an image this one does not know is not replayable by guessing",
  );
});

test("a pre-4 row's dropped keys are accepted and decode to the meaning that survived", () => {
  const raw: unknown = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "journalAtSemanticsOne.json"),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(raw));
  const release = raw[0] as { event: { value: Record<string, unknown> } };
  assert.equal(release.event.value["finalizer"], "ManagedFinalizer");
  assert.deepEqual(release.event.value["prog"], [
    { fanout: 1, combinator: "UnanimousPass" },
  ]);

  const entry = reworkedWall[0];
  assert.ok(entry?.event.type === "ReleaseTicket");
  assert.ok(
    !("finalizer" in entry.event.value),
    "the finish kind reached the actor",
  );
  assert.deepEqual(entry.event.value.prog, [{ fanout: 1 }]);
  assert.ok(storedJournalLegalOn(config, storedAt(reworkedWall, 1)));
});

test("a row that completed a ticket without running a finalizer cannot be replayed", () => {
  const done = walls[5];
  assert.ok(done !== undefined);
  const finisherFree = {
    ...done,
    rec: {
      label: "ticket-done",
      transitions: [{ ticket: id(1), from: "Evaluating", to: "Done" } as const],
      effects: [],
    },
  };
  assert.ok(!replayableDecision(finisherFree));
  assert.ok(
    replayableDecision({
      ...finisherFree,
      rec: {
        ...finisherFree.rec,
        transitions: [
          { ticket: id(1), from: "Finalizing", to: "Done" } as const,
        ],
      },
    }),
    "the completion this machine takes is the one out of Finalizing",
  );
  assert.ok(
    !storedJournalLegalOn(config, [{ entry: finisherFree, semantics: 1 }]),
  );
});

test("a revoke that parked the tickets behind it is replayed, not refused", () => {
  const cascaded = cascade[3];
  assert.ok(cascaded !== undefined);
  assert.ok(replayableDecision(cascaded));
  for (const semantics of [1, 2, 3] as const)
    assert.ok(
      storedJournalLegalOn(modelInstance, storedAt(cascade, semantics)),
      `the cascade is a history the machine at ${String(semantics)} took`,
    );
  assert.ok(
    !storedJournalLegalOn(modelInstance, storedAt(cascade, 4)),
    "the revoke this machine takes transitions its own ticket alone",
  );
});

/** A history the current deciders wrote, which is every row of a forgery but its last. */
function decided(events: readonly DecisionEvent[]): readonly Entry[] {
  let core = genesis;
  return events.map((event, at) => {
    const decision = execDecisionEvent(core, event);
    core = decision.post;
    return { seq: at + 1, event, rec: decision.rec };
  });
}

/** A cascade's record: the revoked ticket settled, and the parks its bytes claim. */
function cascadeRecord(parked: readonly Transition[]): StepRecord {
  return {
    label: "ticket-revoked",
    transitions: [{ ticket: id(1), from: "Pending", to: "Revoked" }, ...parked],
    effects: ["CancelTicketWork", ...parked.map(() => "OpenHumanTask")],
  };
}

/** The parks no cascade took: the prefix each is forged onto, and what it claims. */
const forgedParks: readonly (readonly [
  string,
  readonly DecisionEvent[],
  readonly Transition[],
])[] = [
  [
    "a ticket the fleet never held",
    [
      releaseTicketEvent(id(1), plainAuthoring),
      releaseTicketEvent(id(2), behindTheRevoked),
    ],
    [{ ticket: id(4), from: "Pending", to: "Escalated" }],
  ],
  [
    "a dependent its own revoke had already settled",
    [
      releaseTicketEvent(id(1), plainAuthoring),
      releaseTicketEvent(id(2), behindTheRevoked),
      revokeEvent(id(2)),
    ],
    [{ ticket: id(2), from: "Revoked", to: "Escalated" }],
  ],
  [
    "a ticket already working, which no dependent of a revocable ticket is",
    [
      releaseTicketEvent(id(1), plainAuthoring),
      releaseTicketEvent(id(2), plainAuthoring),
      dispatchEvent(id(2)),
    ],
    [{ ticket: id(2), from: "Working", to: "Escalated" }],
  ],
  [
    "the same dependent twice",
    [
      releaseTicketEvent(id(1), plainAuthoring),
      releaseTicketEvent(id(2), behindTheRevoked),
    ],
    [
      { ticket: id(2), from: "Pending", to: "Escalated" },
      { ticket: id(2), from: "Pending", to: "Escalated" },
    ],
  ],
];

test("a cascade parking anything but a Pending dependent is refused, not thrown on", () => {
  for (const [what, prefix, parked] of forgedParks) {
    const before = decided(prefix);
    const forged = [
      ...before,
      {
        seq: before.length + 1,
        event: revokeEvent(id(1)),
        rec: cascadeRecord(parked),
      },
    ];
    assert.ok(!storedJournalLegalOn(modelInstance, storedAt(forged, 2)), what);
  }
});

test("the cascade parks its dependents where nothing but a revoke reaches them", () => {
  const parked = storedReplayCore(storedAt(cascade.slice(0, 4), 2));
  assert.equal(ticketAt(parked, id(1)).phase, "Revoked");
  for (const dependent of [id(2), id(3)]) {
    const ticket = ticketAt(parked, dependent);
    assert.equal(ticket.phase, "Escalated");
    assert.equal(ticket.reason, "NoReason");
    assert.equal(ticket.resumeAt, "NoResume");
    const resume = resumeTicketEvent(dependent);
    assert.ok(!decisionEventEnabled(modelInstance, parked, resume));
    assert.ok(
      decisionEventEnabled(modelInstance, parked, revokeEvent(dependent)),
    );
  }
  const settled = storedReplayCore(storedAt(cascade, 2));
  for (const dependent of [id(2), id(3)])
    assert.equal(ticketAt(settled, dependent).phase, "Revoked");
});
