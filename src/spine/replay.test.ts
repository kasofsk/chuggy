/**
 * The replayer, made red before it is trusted.
 *
 * THE SUBJECT IS A TRACE THIS FILE BUILDS by driving the machine itself, which
 * is the only way to get a trace that is correct BY CONSTRUCTION and can then
 * be broken one field at a time. A committed fixture proves the replayer
 * accepts what the model emits; nothing in the corpus can prove what it
 * REFUSES, and a replayer that accepted everything would report the whole
 * corpus green forever.
 *
 * ONE MUTATION PER CHECK the replayer makes, and each is checked to red for its
 * OWN reason — the record it compares, the fleet it compares, each step-history
 * ghost, the enablement it demands before running a decider, the empty
 * absorbing class and the recorded pick driven beside it, and the three things
 * a settled step claims. The corpus is what proves they never fire in a healthy
 * tree.
 *
 * A FINDING IS MATCHED BY THE TEXT ONLY ITS OWN CHECK PRODUCES, which is not a
 * style point. `compareState` compares all four vars after every step and
 * prefixes its findings with the step's label, so a settled step's record
 * disagreement is reported a second time, one line later, as `settled:
 * lastStep…`. Two of the cases below matched that prefix and passed with the
 * claim they name discarded — pinning the general comparison instead of the
 * action's own claim. They now match `settled.rec` and `settled moved the
 * fleet`.
 *
 * ONE CHECK IS PINNED INDIRECTLY, and saying which is the whole value of the
 * sentence above. Inside the stutter loop, each member of the absorbing class is
 * required to leave the fleet identical, and no trace this file can write reds
 * that comparison: a pick that MOVED the fleet returns a record that is not the
 * recorded noop, so `driveOne` reports the record difference and returns before
 * the identity check is reached. What would falsify it is a decider that
 * returned a noop record while moving state — a mutation of a shipped file, not
 * of a fixture, which is the invariant hook's situation below at a smaller
 * grain. The class itself is held to the machine by `cmd.test.ts`, which pins
 * both absorbing classes as exact sets over a fleet holding one ticket per
 * phase.
 *
 * THE DRIVE'S WIDTH IS NOT A CHECK, which is why no case below claims it.
 * Narrowing the derived class to its first member — with the recorded pick
 * still driven beside it — leaves this file, the corpus walk and the walker
 * green: every member of a correct class returns the same noop and moves no
 * state, so both checks answer identically over one member or over all of them.
 * The width is the DOMAIN those two checks run over rather than a third check,
 * and what it buys is a decider that absorbed for one pick and not for another
 * — a shipped-file mutation again, and nothing hides behind the silence.
 *
 * ONE CONJUNCT FIRES AT EXACTLY ONE STEP, and it is named here for the same
 * reason: `compareState`'s `lastStep` comparison can only report at GENESIS.
 * Every later state's record is compared inside the drive — `driveOne` for a
 * decided or stutter step, `settled.rec` for a settled one — and each returns
 * nothing on a mismatch, so the walk stops before `compareState` runs. That is
 * not a gap: genesis is the one state no decision produced, so it is the one
 * whose record nothing else could check, and the case below drives exactly
 * that. What the sentence buys is that a reader chasing a `lastStep` finding
 * knows which of the two comparisons produced it.
 *
 * THE INVARIANT HOOK IS NOT REDDENED FROM HERE, AND IT CANNOT BE — a stronger
 * statement than the gap it replaces, and the reason its red proof lives
 * elsewhere rather than being owed here. Every state the bundle is asked of is
 * `applyDecision`'s output over a decision `execCmd` produced at the REPLAY's
 * own consts, so it is consistent with those consts by construction: doctor a
 * trace and the record or the fleet comparison reports the mismatch before the
 * bundle is reached, and doctor the CONFIG and the deciders rebuild the state to
 * match the doctored config, leaving a correct bundle true again. No trace and
 * no config this file can write falsifies a CORRECT conjunct — which is exactly
 * what makes discarding the verdict invisible. What falsifies one is a WRONG
 * conjunct, and that is a mutation of a shipped file rather than of a fixture.
 *
 * SO THE RED PROOF IS A GATE CASE, automated rather than described:
 * `.chug/tasks/check-conformance.test.sh` copies the tree, gives
 * `wrapUpWallNamed`'s Budgeted arm the DeadlineOnly arm's body — false only for
 * a ticket that has hit the wrap-up-budget wall, a state only the deterministic
 * half of the corpus reaches — and requires the gate to report the bundle
 * finding in its own words. Discard the verdict in `replay.ts` and that case
 * goes red, and nothing else does. What the hook is wired TO is pinned in
 * `machine.test.ts` (`invariantsHold` red on a state carrying a defect).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Config } from "../domain/domain.ts";
import {
  cfgBudgeted,
  jDone,
  progU2,
  solo,
  wx1,
} from "../domain/fixtures.test.ts";
import type { StepRecord } from "../domain/measure.ts";
import type { Cmd } from "./cmd.ts";
import { CoverageBuilder } from "./coverage.ts";
import type { StepPlan } from "./decode.ts";
import type { DecodedState, DecodedTrace } from "./itf.ts";
import {
  currentMeasure,
  currentRecords,
  initialState,
  settledStepRecord,
  stepWith,
} from "./machine.ts";
import { replayTrace } from "./replay.ts";

const cfg: Config = { ...cfgBudgeted, nTickets: 2 };

const arrive: Cmd = {
  tag: "JArrive",
  deps: new Set(),
  program: progU2,
  project: 1,
  wrapUp: wx1,
};

/**
 * Drive the machine through a command list and keep the states it passed
 * through — a trace of this machine, in the shape a decoded fixture has.
 */
function walk(commands: readonly Cmd[]): {
  trace: DecodedTrace;
  plans: readonly StepPlan[];
} {
  let state = initialState(cfg);
  const states: DecodedState[] = [state];
  const plans: StepPlan[] = [];
  for (const cmd of commands) {
    const stepped = stepWith(cfg, state, cmd);
    if (stepped === undefined) {
      throw new Error(`the walk cannot take ${cmd.tag}`);
    }
    state = stepped;
    states.push(state);
    plans.push({ kind: "decided", cmd });
  }
  return { trace: { hasDecisionEvents: false, states }, plans };
}

const straight: readonly Cmd[] = [
  arrive,
  { tag: "JRelease", ticket: 1 },
  { tag: "JDispatch", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
];

function replay(
  trace: DecodedTrace,
  plans: readonly StepPlan[],
): readonly string[] {
  return replayTrace(
    cfg,
    trace,
    plans,
    new CoverageBuilder(),
    "t",
  ).findings.map((finding) => `${String(finding.state)}: ${finding.detail}`);
}

/** The trace with one state replaced — the shape every red case below takes. */
function withState(
  trace: DecodedTrace,
  index: number,
  over: Partial<DecodedState>,
): DecodedTrace {
  const states = trace.states.map((state, i) =>
    i === index ? { ...state, ...over } : state,
  );
  return { ...trace, states };
}

function stateAt(trace: DecodedTrace, index: number): DecodedState {
  const state = trace.states[index];
  assert.ok(state !== undefined);
  return state;
}

test("a trace of this machine replays with no findings", () => {
  const { trace, plans } = walk(straight);
  assert.deepEqual(replay(trace, plans), []);
});

test("the initial state is compared too, and a trace that does not start at init reds", () => {
  const { trace, plans } = walk(straight);
  const moved = withState(trace, 0, { core: solo(jDone) });
  assert.ok(replay(moved, plans).some((f) => f.startsWith("0: init: tickets")));
});

test("the initial state's own record is compared, which is the only step `compareState` compares one for", () => {
  // `compareState` compares all four vars after every step, and its `lastStep`
  // conjunct fires at GENESIS AND NOWHERE ELSE — which is worth a case rather
  // than a sentence, because "it never fires" and "it fires on exactly one
  // step" read the same from a green suite. At every later index the record is
  // compared FIRST, inside the drive: a decided step compares it in `driveOne`,
  // a stutter step compares it there too, and a settled step compares it as
  // `settled.rec`, and each of the three returns nothing on a mismatch so the
  // walk stops before `compareState` is reached. Genesis is the one state no
  // decision produced, so it is the one whose record only this conjunct can
  // check.
  const { trace, plans } = walk(straight);
  const forged = withState(trace, 0, {
    lastStep: { ...stateAt(trace, 0).lastStep, label: "ticket-arrived" },
  });
  assert.deepEqual(replay(forged, plans), [
    "0: init: lastStep.label: expected ticket-arrived, got init",
  ]);
});

test("a recorded StepRecord one field off reds, at the step that recorded it", () => {
  const { trace, plans } = walk(straight);
  const original = stateAt(trace, 3).lastStep;
  const rows: readonly (readonly [string, StepRecord])[] = [
    ["label", { ...original, label: "task-done-duplicate" }],
    ["effects", { ...original, effects: ["Complete"] }],
    [
      "attempt",
      {
        ...original,
        attempt: { tag: "WOAttempt", project: 1, invalidated: false },
      },
    ],
  ];
  for (const [field, lastStep] of rows) {
    const findings = replay(withState(trace, 3, { lastStep }), plans);
    assert.ok(
      findings.some((f) => f.includes("recorded a different step")),
      `${field}: ${findings.join(" | ")}`,
    );
  }
});

test("a post-state one field off reds, and the walk stops there", () => {
  const { trace, plans } = walk(straight);
  const spent = stateAt(trace, 3);
  const ticket = spent.core.tickets.get(1);
  assert.ok(ticket !== undefined);
  const findings = replay(
    withState(trace, 3, {
      core: {
        tickets: new Map([[1, { ...ticket, gasLeft: ticket.gasLeft + 1 }]]),
      },
    }),
    plans,
  );
  assert.ok(findings.some((f) => f.includes("tickets[1].gasLeft")));
});

test("each step-history ghost is compared, so the measure and the record snapshot are pinned per step", () => {
  const { trace, plans } = walk(straight);
  const measured = replay(
    withState(trace, 2, { prevMeasure: stateAt(trace, 2).prevMeasure + 1 }),
    plans,
  );
  assert.ok(measured.some((f) => f.includes("prevMeasure")));
  const snapshotted = replay(
    withState(trace, 2, { prevRecords: new Map([[9, []]]) }),
    plans,
  );
  assert.ok(snapshotted.some((f) => f.includes("prevRecords")));
});

test("a command the replayed state does not enable is refused, never thrown on", () => {
  const { trace, plans } = walk(straight);
  // The trace's own step, replaced by a decision the machine cannot take there:
  // the deciders assume their guards, so this is the case that must answer
  // rather than crash.
  const tampered: readonly StepPlan[] = plans.map((plan, i) =>
    i === 2 ? { kind: "decided", cmd: { tag: "JRevoke", ticket: 9 } } : plan,
  );
  const findings = replay(trace, tampered);
  assert.ok(
    findings.some((f) => f.includes("is not enabled at the replayed state")),
  );
});

test("a stutter step is driven across its whole absorbing class", () => {
  // A duplicate delivery for a task already resolved: the class holds every
  // issued id that is not live and running, at both verdicts.
  const { trace, plans } = walk([...straight.slice(0, 4)]);
  const state = stateAt(trace, 4);
  // A stutter step is a real domain step: the fleet does not move, and BOTH
  // ghosts snapshot the state it departs from, exactly as `apply` writes them.
  const duplicate: DecodedState = {
    ...state,
    lastStep: {
      label: "task-done-duplicate",
      transitions: [],
      effects: [],
      attempt: { tag: "WONone" },
    },
    prevMeasure: currentMeasure(cfg, state.core),
    prevRecords: currentRecords(state.core),
  };
  const stutter: DecodedTrace = {
    ...trace,
    states: [...trace.states, duplicate],
  };
  const withStutter: readonly StepPlan[] = [
    ...plans,
    { kind: "stutter", label: "task-done-duplicate" },
  ];
  assert.deepEqual(replay(stutter, withStutter), []);

  // THE RECORDED PICK IS DRIVEN BESIDE THE CLASS, which is the other half of
  // `picks` and the half a tier-1 fixture uses. A recorded pick OUTSIDE the
  // class — a task that is still live and running — is a real step rather than
  // an absorbed one, so it comes back with a different record and the walk says
  // so. Dropped from `picks`, this trace replays clean.
  const foreign = replay(stutter, [
    ...plans,
    {
      kind: "stutter",
      label: "task-done-duplicate",
      recorded: { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
    },
  ]);
  assert.ok(
    foreign.some((f) => f.includes("recorded a different step")),
    foreign.join(" | "),
  );

  // The same step where no pick could have absorbed: at the state before any
  // task resolved, every issued id is live and running, so the class is empty
  // and an empty class is itself the finding.
  const early = walk(straight.slice(0, 3));
  const before = stateAt(early.trace, 3);
  const earlyStutter: DecodedTrace = {
    ...early.trace,
    states: [
      ...early.trace.states,
      {
        ...before,
        lastStep: duplicate.lastStep,
        prevMeasure: currentMeasure(cfg, before.core),
        prevRecords: currentRecords(before.core),
      },
    ],
  };
  const findings = replay(earlyStutter, [
    ...early.plans,
    { kind: "stutter", label: "task-done-duplicate" },
  ]);
  assert.ok(findings.some((f) => f.includes("no pick absorbs")));
});

test("a settled step claims quiet, an unmoved fleet and the settled record — each checked", () => {
  // The fleet is at its arrival bound and wholly terminal: the one state the
  // model's `settle` is enabled at.
  const quietWalk = walk([
    arrive,
    { tag: "JRevoke", ticket: 1 },
    arrive,
    { tag: "JRevoke", ticket: 2 },
  ]);
  const last = stateAt(quietWalk.trace, 4);
  const settled: DecodedState = {
    ...last,
    lastStep: settledStepRecord,
    prevMeasure: currentMeasure(cfg, last.core),
    prevRecords: currentRecords(last.core),
  };
  const withSettled = (state: DecodedState): DecodedTrace => ({
    ...quietWalk.trace,
    states: [...quietWalk.trace.states, state],
  });
  const plans: readonly StepPlan[] = [...quietWalk.plans, { kind: "settled" }];
  assert.deepEqual(replay(withSettled(settled), plans), []);

  // A settled step whose record is not the settled noop. THE FINDING IS NAMED
  // AT `settled.rec` AND NOT AT ITS `settled:` PREFIX, because the prefix is
  // also what `compareState` puts in front of a `lastStep` disagreement at this
  // step: matched loosely, this case passed with the claim discarded, pinning
  // the comparison one line further on instead of the claim the action makes.
  const wrongRecord = replay(
    withSettled({
      ...settled,
      lastStep: { ...settledStepRecord, effects: ["Complete"] },
    }),
    plans,
  );
  assert.ok(
    wrongRecord.some((f) => f.includes("settled.rec")),
    wrongRecord.join(" | "),
  );

  // A settled step the fleet moved across — the third claim, and the one the
  // action makes about the machine rather than about its own record. Named the
  // same way and for the same reason.
  const movedFleet = replay(
    withSettled({ ...settled, core: solo(jDone) }),
    plans,
  );
  assert.ok(
    movedFleet.some((f) => f.includes("settled moved the fleet")),
    movedFleet.join(" | "),
  );

  // And a settled step at a state the machine could still move from.
  const live = walk([arrive]);
  const running = stateAt(live.trace, 1);
  const notQuiet = replay(
    {
      ...live.trace,
      states: [
        ...live.trace.states,
        {
          ...running,
          lastStep: settledStepRecord,
          prevMeasure: currentMeasure(cfg, running.core),
          prevRecords: currentRecords(running.core),
        },
      ],
    },
    [...live.plans, { kind: "settled" }],
  );
  assert.ok(notQuiet.some((f) => f.includes("not quiet")));
});

test("the walk reports the state index its finding is about", () => {
  const { trace, plans } = walk(straight);
  const findings = replay(
    withState(trace, 5, {
      lastStep: { ...stateAt(trace, 5).lastStep, label: "dispatch" },
    }),
    plans,
  );
  assert.ok(findings.length > 0);
  assert.ok(
    findings.every((f) => f.startsWith("5: ")),
    findings.join(" | "),
  );
});
