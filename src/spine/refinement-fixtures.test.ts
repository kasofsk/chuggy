/**
 * `model/tests/chuggy_refinement_test.qnt`'s FIXTURE VOCABULARY, once: the
 * refinement instance's consts, the flat program every run authors, the
 * three-decision journal the unit module builds by hand, and the run harness
 * the witness and hazard suites drive the actor through.
 *
 * WHY IT IS ITS OWN FILE. Four suites mirror one model file against one
 * instance, and `.chug/tasks/check-duplication.sh` is at threshold 0 with tests
 * deliberately in scope. Its rule is the line this file sits on: a test's
 * SCENARIO may repeat, its HARNESS is extracted. The model extracts the same
 * thing for the same reason — `stepEmit` is an action in the model's own
 * witness module, packaged there so the run's chain stays inside the
 * evaluator's expression-depth budget.
 *
 * EVERY JOURNAL ROW HERE COMES OUT OF A DECIDER. `d1`, `d2` and `d3` are
 * `execCmd` results and each row's `rec` is read back off the decision that
 * produced it — the journal an honest actor would write. A row assembled from a
 * record literal would be testing the checker against a fixture rather than
 * against the machine.
 */

import assert from "node:assert/strict";

import type { Config } from "../domain/domain.ts";
import type { Decision, Stage, WrapUp } from "../domain/measure.ts";
import { createInMemoryJournalStore } from "../adapters/in-memory-journal-store.ts";
import {
  actorInit,
  commit,
  emitNext,
  type ActorState,
  type DurableState,
} from "./actor.ts";
import type { JournalStore } from "./journal-store.ts";
import { execCmd, type Cmd } from "./cmd.ts";
import type { Entry } from "./entry.ts";
import {
  genesis,
  journalCompletionsOn,
  journalSpawnsOn,
  worldCompletionsOn,
  worldSpawnsOn,
} from "./journal.ts";
import { invariantsHold } from "./machine.ts";
import { refinementInvariants } from "./refinement-invariants.ts";

/**
 * `model/refinement.qnt`'s own instance consts, and the header's argument for
 * each is why they are not the domain suites' fixtures: this module embeds the
 * domain machine, so its state space is the domain's TIMES the journal, and the
 * instance is fixed TINY at the smallest consts that exercise a REWORK — which
 * is where a double-spend bites, being the re-entry that charges.
 */
export const cfgRefinement: Config = {
  nTickets: 2,
  nTasks: 1,
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  gas: 3,
  wrapUpPricing: { tag: "Budgeted", budget: 1 },
  opRetryPricing: "RetryCharged",
  maxStages: 1,
  nProjects: 1,
};

/** The model's `progFlat` — one unanimous stage at fan-out one. */
export const progFlat: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
];

/** The lease every gated run authors. At `nProjects: 1` there is exactly one. */
export const wx1: WrapUp = { tag: "WExclusive", resource: 1 };

// === The decision vocabulary the runs are written in =======================
// Named once, because every suite in this slice spells the same ticket's life.
// The first three are the model unit module's `cmd1`, `cmd2` and `cmd3`.

export const arrive: Cmd = {
  tag: "JArrive",
  deps: new Set(),
  program: progFlat,
  project: 1,
  wrapUp: wx1,
};
/** The same arrival, authored WITHOUT a lease: the route that skips the gate. */
export const arriveLeaseFree: Cmd = { ...arrive, wrapUp: { tag: "WNone" } };
export const release: Cmd = { tag: "JRelease", ticket: 1 };
export const dispatch: Cmd = { tag: "JDispatch", ticket: 1 };
export const workReduce: Cmd = { tag: "JWorkReduce", ticket: 1 };
export const evalReduce: Cmd = { tag: "JEvalReduce", ticket: 1 };
/**
 * The valid-artifact dequeue: the wrap-up resolves in this same step, no gate.
 *
 * "Quiet land" is the model's own name for this route — the witness run
 * `quietLandDeterministicTest` and the invariant `quietProjectLandsCleanly`
 * both spell it — so the name here is the model's rather than this file's.
 */
export const quietLand: Cmd = { tag: "JDequeue", ticket: 1, moved: false };
/** The moved dequeue: into the gate, which a resolution then promotes. */
export const enterGate: Cmd = { tag: "JDequeue", ticket: 1, moved: true };
export const resolveGate: Cmd = { tag: "JGateResolve", ticket: 1, out: "WOk" };
export const completeAgain: Cmd = { tag: "JCompleteDuplicate", ticket: 1 };

/** A task completion event, at a task id and a verdict. */
export function done(tid: number, verdict: "VPass" | "VFail"): Cmd {
  return { tag: "JTaskDone", ticket: 1, tid, verdict };
}

// === The hand-built history (the unit module's `goodJ`) ====================

export const d1: Decision = execCmd(cfgRefinement, genesis, arrive);
export const e1: Entry = { seq: 1, cmd: arrive, rec: d1.rec };

export const d2: Decision = execCmd(cfgRefinement, d1.post, release);
export const e2: Entry = { seq: 2, cmd: release, rec: d2.rec };

export const d3: Decision = execCmd(cfgRefinement, d2.post, dispatch);
export const e3: Entry = { seq: 3, cmd: dispatch, rec: d3.rec };

/** The honest three-decision journal: arrive, release, dispatch. */
export const goodJ: readonly Entry[] = [e1, e2, e3];

/**
 * Journal these decisions in order and emit every row — a settled prefix, with
 * its own store, for a suite that wants the state rather than the walk.
 */
export function driveEmitted(cmds: readonly Cmd[]): DurableState {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfgRefinement);
  for (const cmd of cmds) {
    s = journalThenEmit(store, s, cmd);
  }
  return s;
}

/**
 * The quiet-land walk, end to end: a ticket that arrives with a lease, works,
 * evaluates, lands on the fast path and absorbs a stale confirmation.
 */
export const quietLandWalk: readonly Cmd[] = [
  arrive,
  release,
  dispatch,
  done(1, "VPass"),
  workReduce,
  done(2, "VPass"),
  evalReduce,
  quietLand,
  completeAgain,
];

// === The run harness ======================================================

/**
 * An action's result, or a failed run. Every actor action refuses by answering
 * `undefined`, and a refusal inside a witness run is that run failing — exactly
 * as a `journalStep` whose `cmdEnabled` conjunct is false fails the model's run
 * rather than skipping a step.
 */
export function must<T>(state: T | undefined, what: string): T {
  assert.ok(state !== undefined, `${what}: the action was refused`);
  return state;
}

/**
 * The model's `and { allDomainInvariants, refinementInvariants }` — the pair
 * every disciplined expect conjoins.
 *
 * THE TWO HALVES ARE ASSERTED SEPARATELY so a failure says which machine broke.
 * That distinction is the hazard suite's entire content, and a helper that
 * merged them would make the two indistinguishable exactly where it matters.
 */
export function expectSteady(s: ActorState): void {
  assert.ok(invariantsHold(cfgRefinement, s.mem), "the domain bundle");
  assert.ok(refinementInvariants(cfgRefinement, s), "the refinement bundle");
}

/**
 * The model's `stepEmit` action: the routine decision-and-emission pair, with
 * the invariants asserted at BOTH intermediate states — post-journal, with the
 * produced label pinned, and post-emission.
 *
 * WHICH DISCIPLINE THE MIRRORS EXERCISE, since the type now distinguishes two.
 * The model's `journalStep` appends to a `journal` var that IS the durable log —
 * durability is free there, because a Quint var cannot fail to be written. Here
 * durability is a store, so the faithful spelling of that action is `commit`:
 * decide, append, and only then a state the executor may emit from. Every
 * mirrored run therefore drives `commit` against an in-memory store, and
 * `journalStep` alone — the same decision with nothing durable behind it —
 * appears only where a suite is pinning that function's own behaviour.
 */
export function stepEmit(
  store: JournalStore,
  s: DurableState,
  cmd: Cmd,
  label: string,
): DurableState {
  const journaled = must(
    commit(cfgRefinement, store, s, cmd),
    `commit ${label}`,
  );
  assert.equal(journaled.mem.lastStep.label, label);
  expectSteady(journaled);
  const emitted = must(emitNext(journaled), `emitNext ${label}`);
  expectSteady(emitted);
  return emitted;
}

/**
 * The same pair WITHOUT the disciplined expects, for the hazard runs.
 *
 * It exists because the assertions are the difference. After the hazard's first
 * orphan the refinement bundle is expected to be RED, so a hazard run that
 * walked its cycle through `stepEmit` would fail on the discipline it is
 * demonstrating the absence of. The model inlines the pair in its hazard runs
 * for the same reason.
 */
export function journalThenEmit(
  store: JournalStore,
  s: DurableState,
  cmd: Cmd,
): DurableState {
  const journaled = must(
    commit(cfgRefinement, store, s, cmd),
    "commit (hazard walk)",
  );
  return must(emitNext(journaled), "emitNext (hazard walk)");
}

/** The model's `n.reps(_ => emitNext)` — the executor catching up. */
export function emitTimes(s: DurableState, n: number): DurableState {
  let state = s;
  for (let i = 0; i < n; i += 1) {
    state = must(emitNext(state), `emitNext #${String(i + 1)}`);
  }
  return state;
}

// The model's four per-ticket counters over the LIVE vars (`def worldSpawns(j)`
// and friends), which is how its runs read them. The pure forms take the vars
// apart because they are also asked of hand-built journals; these are the
// spelling a run wants.

export function worldSpawns(s: ActorState, j: number): number {
  return worldSpawnsOn(s.journal, s.worldEffects, s.orphans, j);
}

export function worldCompletions(s: ActorState, j: number): number {
  return worldCompletionsOn(s.journal, s.worldEffects, s.orphans, j);
}

export function journalSpawns(s: ActorState, j: number): number {
  return journalSpawnsOn(s.journal, j);
}

export function journalCompletions(s: ActorState, j: number): number {
  return journalCompletionsOn(s.journal, j);
}

/** One live ticket's record, by id — the model's `memCore.tickets.get(j)`. */
export function memTicket(s: ActorState, j: number) {
  const jb = s.mem.core.tickets.get(j);
  assert.ok(jb !== undefined, `no ticket ${String(j)} in the actor's memory`);
  return jb;
}
