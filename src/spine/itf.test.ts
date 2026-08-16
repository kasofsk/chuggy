/**
 * The ITF decoder, over documents this file writes by hand.
 *
 * WHY HAND-WRITTEN AND NOT A CORPUS FIXTURE. The corpus proves the decoder
 * reads what quint WRITES; nothing in it can prove what the decoder REFUSES,
 * because a healthy corpus contains no refusable document. Every case below is
 * therefore a document one field away from a good one — and the exact-field-set
 * check is pinned in both directions, because the direction that matters is the
 * one a corpus can never exercise: a record that gained a field upstream, which
 * a decoder reading only the fields it knows would drop in silence.
 *
 * The good document is minimal on purpose: an init state and one arrival, which
 * is the smallest trace carrying a ticket, a step record and a decision event.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DecodeError, decodeTrace } from "./itf.ts";

const bigint = (n: number): unknown => ({ "#bigint": String(n) });
const nullaryValue = { "#tup": [] };
const tagged = (tag: string, value: unknown = nullaryValue): unknown => ({
  tag,
  value,
});
const none = tagged("None");
const some = (value: unknown): unknown => tagged("Some", value);

const vars = [
  "mbt::actionTaken",
  "mbt::nondetPicks",
  "m::chuggy_domain::lastStep",
  "m::chuggy_domain::prevMeasure",
  "m::chuggy_domain::prevRecords",
  "m::chuggy_domain::tickets",
  // The two `mbt::` entries appear twice, exactly as quint 0.32.0 writes them.
  "mbt::actionTaken",
  "mbt::nondetPicks",
];

const ticket = (): unknown => ({
  phase: tagged("PDraft"),
  deps: { "#set": [] },
  wrapUp: tagged("WExclusive", bigint(1)),
  artifact: tagged("ANone"),
  project: bigint(1),
  program: [{ fanout: bigint(2), combinator: tagged("CUnanimousPass") }],
  tasks: { "#set": [] },
  record: [],
  spawned: bigint(0),
  reworkLeft: bigint(1),
  wrapUpLeft: bigint(1),
  gasLeft: bigint(3),
  resumeAt: tagged("RNone"),
  reason: tagged("RsNone"),
  completions: bigint(0),
});

const picks = (over: Record<string, unknown> = {}): unknown => ({
  deps_: none,
  prog: none,
  project_: none,
  wrapUp_: none,
  j: none,
  tid: none,
  v: none,
  moved: none,
  out: none,
  ...over,
});

const step = (label: string): unknown => ({
  label,
  transitions: [],
  effects: [],
  attempt: tagged("WONone"),
});

function state(index: number, over: Record<string, unknown> = {}): unknown {
  return {
    "#meta": { index },
    "mbt::actionTaken": index === 0 ? "init" : "arrive",
    "mbt::nondetPicks":
      index === 0
        ? picks()
        : picks({
            deps_: some({ "#set": [] }),
            prog: some([{ fanout: bigint(2), combinator: tagged("CAnyPass") }]),
            project_: some(bigint(2)),
            wrapUp_: some(tagged("WNone")),
          }),
    "m::chuggy_domain::lastStep": step(index === 0 ? "init" : "ticket-arrived"),
    "m::chuggy_domain::prevMeasure": bigint(0),
    "m::chuggy_domain::prevRecords": { "#map": [] },
    "m::chuggy_domain::tickets": {
      "#map": index === 0 ? [] : [[bigint(1), ticket()]],
    },
    ...over,
  };
}

function document(over: Record<string, unknown> = {}): unknown {
  return {
    "#meta": { source: "x" },
    vars,
    states: [state(0), state(1)],
    ...over,
  };
}

test("decodeTrace: a document with decision events decodes both states", () => {
  const trace = decodeTrace(document());
  assert.ok(trace.hasDecisionEvents);
  assert.equal(trace.states.length, 2);

  const [genesis, arrived] = trace.states;
  assert.ok(genesis !== undefined && arrived !== undefined);
  assert.equal(genesis.action, "init");
  assert.deepEqual(genesis.core.tickets, new Map());
  assert.equal(arrived.lastStep.label, "ticket-arrived");
  assert.deepEqual(arrived.picks, {
    deps: new Set(),
    program: [{ fanout: 2, combinator: "CAnyPass" }],
    project: 2,
    wrapUp: { tag: "WNone" },
  });
  const born = arrived.core.tickets.get(1);
  assert.ok(born !== undefined);
  assert.equal(born.phase, "PDraft");
  assert.equal(born.gasLeft, 3);
  assert.deepEqual(born.wrapUp, { tag: "WExclusive", resource: 1 });
});

test("decodeTrace: a document without the mbt vars is the other tier", () => {
  const plain = document({
    vars: vars.filter((v) => !v.startsWith("mbt::")),
    states: [state(0), state(1)].map((s) => {
      const copy = { ...(s as Record<string, unknown>) };
      delete copy["mbt::actionTaken"];
      delete copy["mbt::nondetPicks"];
      return copy;
    }),
  });
  const trace = decodeTrace(plain);
  assert.equal(trace.hasDecisionEvents, false);
  const [genesis] = trace.states;
  assert.ok(genesis !== undefined);
  assert.equal(genesis.action, undefined);
  assert.equal(genesis.picks, undefined);
});

test("decodeTrace: a record's field set is exact, in both directions", () => {
  // The direction a corpus can exercise: a field this decoder needs, gone.
  const short = { ...(ticket() as Record<string, unknown>) };
  delete short["gasLeft"];
  assert.throws(
    () => decodeTrace(withTicket(short)),
    (error: unknown) =>
      error instanceof DecodeError && /gasLeft/.test(error.message),
  );
  // The direction only this file can: a field the model gained. A decoder that
  // read what it knew would replay a state it had thrown half of away.
  assert.throws(
    () =>
      decodeTrace(withTicket({ ...(ticket() as object), promoted: bigint(1) })),
    (error: unknown) =>
      error instanceof DecodeError && /promoted/.test(error.message),
  );
  // The STEP RECORD is held to the same exactness, and the RETIRED NAME is the
  // case that matters here: the model renamed this field, and a decoder that
  // took the old one would replay a trace the model can no longer emit. That
  // is how the drift this branch absorbed stayed invisible — every gate was
  // green against a model the mirror could not decode.
  const shortStep = { ...(step("init") as Record<string, unknown>) };
  delete shortStep["attempt"];
  assert.throws(
    () => decodeTrace(withStep(shortStep)),
    (error: unknown) =>
      error instanceof DecodeError &&
      /got \[effects, label, transitions\]/.test(error.message),
  );
  assert.throws(
    () => decodeTrace(withStep({ ...shortStep, landing: tagged("WONone") })),
    (error: unknown) =>
      error instanceof DecodeError &&
      /got \[effects, label, landing, transitions\]/.test(error.message),
  );
});

function withStep(rec: unknown): unknown {
  return document({
    states: [state(0), state(1, { "m::chuggy_domain::lastStep": rec })],
  });
}

function withTicket(jb: unknown): unknown {
  return document({
    states: [
      state(0),
      state(1, {
        "m::chuggy_domain::tickets": { "#map": [[bigint(1), jb]] },
      }),
    ],
  });
}

test("decodeTrace: the state's var roster is exact, and the doubled mbt entries are tolerated", () => {
  // A var the states do not carry.
  assert.throws(
    () => decodeTrace(document({ vars: [...vars, "m::chuggy_domain::extra"] })),
    DecodeError,
  );
  // A var the states carry and the roster does not.
  assert.throws(
    () =>
      decodeTrace(
        document({
          states: [
            state(0),
            state(1, { "m::chuggy_domain::extra": bigint(1) }),
          ],
        }),
      ),
    DecodeError,
  );
  // The duplication in `vars` is not an error — the good document above has it.
  assert.ok(decodeTrace(document()).hasDecisionEvents);
});

test("decodeTrace: an int is checked, not coerced", () => {
  const bad: readonly unknown[] = [
    { "#bigint": 3 },
    { "#bigint": "3.5" },
    { "#bigint": "" },
    { "#bigint": String(Number.MAX_SAFE_INTEGER) + "0" },
    3.5,
    "3",
  ];
  for (const value of bad) {
    assert.throws(
      () =>
        decodeTrace(withTicket({ ...(ticket() as object), gasLeft: value })),
      DecodeError,
      JSON.stringify(value),
    );
  }
  // A plain JSON integer is accepted: the format permits an unwrapped small
  // int, and refusing one would refuse a document that is still ITF.
  assert.ok(decodeTrace(withTicket({ ...(ticket() as object), gasLeft: 3 })));
});

test("decodeTrace: a constructor outside the model's roster is refused", () => {
  assert.throws(
    () =>
      decodeTrace(
        withTicket({ ...(ticket() as object), phase: tagged("PLimbo") }),
      ),
    (error: unknown) =>
      error instanceof DecodeError && /PLimbo/.test(error.message),
  );
  // A nullary constructor carrying a payload is a document to refuse rather
  // than read past.
  assert.throws(
    () =>
      decodeTrace(
        withTicket({
          ...(ticket() as object),
          phase: tagged("PDraft", bigint(7)),
        }),
      ),
    DecodeError,
  );
});

test("decodeTrace: a task set is canonicalized, and a repeated id is refused", () => {
  const task = (id: number): unknown => ({
    id: bigint(id),
    kind: tagged("TKWork"),
    state: tagged("TSRunning"),
  });
  const working = {
    ...(ticket() as object),
    phase: tagged("PWorking"),
    tasks: { "#set": [task(2), task(1)] },
    spawned: bigint(2),
  };
  const trace = decodeTrace(withTicket(working));
  const [, arrived] = trace.states;
  assert.deepEqual(
    arrived?.core.tickets.get(1)?.tasks.map((t) => t.id),
    [1, 2],
    "an ITF set carries no order, so the decoder imposes the canonical one",
  );
  assert.throws(
    () =>
      decodeTrace(
        withTicket({ ...working, tasks: { "#set": [task(1), task(1)] } }),
      ),
    DecodeError,
  );
  // THE FLOOR, which the canonical form owns and a hand-rolled sort here would
  // not have: ids start at `firstTaskId`, so a task numbered below it is a set
  // the representation cannot hold — and it is the value `nextTaskId` would
  // then mis-mint from.
  assert.throws(
    () =>
      decodeTrace(
        withTicket({ ...working, tasks: { "#set": [task(0), task(1)] } }),
      ),
    (error: unknown) =>
      error instanceof DecodeError && /ascending by id/.test(error.message),
  );
});

test("decodeTrace: the nondet binder roster is exact", () => {
  // A binder the machine gained is a draw this vocabulary cannot carry.
  assert.throws(
    () =>
      decodeTrace(
        document({
          states: [
            state(0),
            state(1, { "mbt::nondetPicks": picks({ extra: none }) }),
          ],
        }),
      ),
    (error: unknown) =>
      error instanceof DecodeError && /extra/.test(error.message),
  );
  // And a pick that is neither Some nor None.
  assert.throws(
    () =>
      decodeTrace(
        document({
          states: [
            state(0),
            state(1, { "mbt::nondetPicks": picks({ j: tagged("Maybe") }) }),
          ],
        }),
      ),
    DecodeError,
  );
});

test("decodeTrace: the state index must be the state's position", () => {
  assert.throws(
    () => decodeTrace(document({ states: [state(0), state(5)] })),
    (error: unknown) =>
      error instanceof DecodeError && /index/.test(error.message),
  );
  // A trace with no states at all is a document, not a trace.
  assert.throws(() => decodeTrace(document({ states: [] })), DecodeError);
});
