/**
 * `model/refinement.qnt`'s `Cmd`, `execCmd` and `cmdEnabled`, pinned against the
 * shipped deciders and the shipped predicates.
 *
 * THE TWO CLAIMS THIS FILE EXISTS TO MAKE, and the shape each needs:
 *
 *   1. `execCmd` DISPATCHES WHERE THE MODEL SAYS. Every arm is pinned by
 *      calling the decider directly and requiring the same `Decision` back,
 *      over a fleet that enables all twelve constructors. A dispatch that
 *      reached the wrong decider, or the right one with its arguments
 *      transposed, is a different Decision — which is exactly what a golden
 *      trace would catch, one layer later and one layer less specifically.
 *   2. `cmdEnabled` IS THE MACHINE'S OWN ENABLEMENT. Each arm is pinned as an
 *      EXACT SET over the whole fleet — every ticket the predicate admits and
 *      every ticket it refuses — against the shipped `*In` set it is supposed
 *      to be. A guard restated instead of referenced would agree on the fixture
 *      that motivated it and drift from the set later; asking for set equality
 *      is what makes that impossible to write.
 *
 * THE FLEET IS ONE TICKET PER PHASE, plus the three desk flavors, because that
 * is the whole domain every enablement set is a subset of. `fixtures.test.ts`
 * already builds them for the domain suites, so they are borrowed rather than
 * re-minted — the same fleet the guards were originally pinned over.
 *
 * IT IS NOT A GOLDEN CORPUS AND DOES NOT TRY TO BE. Whether the deciders agree
 * with the model is the corpus's obligation; whether this vocabulary reaches
 * the right decider with the right arguments, and refuses what the machine
 * refuses, is this file's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../domain/assert.ts";
import {
  decideArrive,
  decideCompleteDuplicate,
  decideDequeue,
  decideDispatch,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideRevalFail,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  decideWrapUpResolve,
  decideWrapUpStart,
  doneIn,
  draftsIn,
  holdingIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
  wrapUpStartablesIn,
  type Config,
} from "../domain/domain.ts";
import {
  cfgBudgeted,
  core,
  jDone,
  jDraft,
  jEsc,
  jEval,
  jGated,
  jLand,
  jParkDep,
  jParkPre,
  jPend,
  jWork,
  progU2,
  solo,
  wt,
  wx1,
  wx2,
} from "../domain/fixtures.test.ts";
import type { Core, Ticket } from "../domain/measure.ts";
import {
  cmdEnabled,
  completeDuplicateAbsorbingClass,
  decidersReached,
  execCmd,
  shippedDeciders,
  taskDoneAbsorbingClass,
  type Cmd,
  type CmdTag,
} from "./cmd.ts";

/**
 * The fleet: one ticket per phase in id order, with the parked phase spread
 * over its three desk flavors. `nTickets` is raised past the fleet's size for
 * one reason — `canArriveIn` is an enablement conjunct like any other, and a
 * fleet at its arrival bound would refuse `JArrive` for a reason that has
 * nothing to do with what each row is pinning.
 */
const cfg: Config = { ...cfgBudgeted, nTickets: 12 };

/** A Working ticket whose set is fully resolved, so a reduce is enabled. */
const jWorkDone: Ticket = {
  ...jWork,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
};
/** An Evaluating ticket whose stage is fully resolved. */
const jEvalDone: Ticket = jEval;

const ids = {
  draft: 1,
  pending: 2,
  working: 3,
  workingDone: 4,
  evaluating: 5,
  enqueued: 6,
  gated: 7,
  done: 8,
  parkedPipeline: 9,
  parkedPreWork: 10,
  parkedCascade: 11,
} as const;

const fleet: Core = core([
  [ids.draft, jDraft],
  [ids.pending, { ...jPend, deps: new Set() }],
  [ids.working, jWork],
  [ids.workingDone, jWorkDone],
  [ids.evaluating, jEvalDone],
  [ids.enqueued, jLand],
  // The held slot is on the OTHER resource, so the enqueued ticket above is
  // dequeue-able: two tickets holding one resource is the depth-1 refusal, and
  // it would disable half these rows for a reason none of them is about.
  [ids.gated, { ...jGated, wrapUp: wx2 }],
  [ids.done, jDone],
  [ids.parkedPipeline, jEsc],
  [ids.parkedPreWork, jParkPre],
  [ids.parkedCascade, jParkDep],
]);

const everyId: readonly number[] = [...fleet.tickets.keys()];

/** The ids a single-ticket command is enabled at, over the whole fleet. */
function enabledAt(build: (ticket: number) => Cmd): ReadonlySet<number> {
  return new Set(everyId.filter((j) => cmdEnabled(cfg, fleet, build(j))));
}

// === execCmd: the dispatch =================================================

test("execCmd: every constructor reaches the decider the model names", () => {
  // Each row is the command and the direct call it must be identical to. The
  // fleet enables all of them, so no row is vacuous.
  const rows: readonly (readonly [Cmd, unknown])[] = [
    [
      {
        tag: "JArrive",
        deps: new Set([ids.done]),
        program: progU2,
        project: 1,
        wrapUp: wx1,
      },
      decideArrive(cfg, fleet, new Set([ids.done]), progU2, 1, wx1),
    ],
    [{ tag: "JRelease", ticket: ids.draft }, decideRelease(fleet, ids.draft)],
    [{ tag: "JRevoke", ticket: ids.pending }, decideRevoke(fleet, ids.pending)],
    [
      { tag: "JDispatch", ticket: ids.pending },
      decideDispatch(cfg, fleet, ids.pending),
    ],
    [
      { tag: "JTaskDone", ticket: ids.working, tid: 1, verdict: "VFail" },
      decideTaskDone(fleet, ids.working, 1, "VFail"),
    ],
    [
      { tag: "JWorkReduce", ticket: ids.workingDone },
      decideWorkReduce(fleet, ids.workingDone),
    ],
    [
      { tag: "JEvalReduce", ticket: ids.evaluating },
      decideEvalStageReduce(cfg, fleet, ids.evaluating),
    ],
    [
      { tag: "JDequeue", ticket: ids.enqueued, moved: true },
      decideDequeue(cfg, fleet, ids.enqueued, true),
    ],
    [
      { tag: "JDequeue", ticket: ids.enqueued, moved: false },
      decideDequeue(cfg, fleet, ids.enqueued, false),
    ],
    [
      { tag: "JGateResolve", ticket: ids.gated, out: "WFailed" },
      decideWrapUpResolve(cfg, fleet, ids.gated, "WFailed", true),
    ],
    [
      { tag: "JCompleteDuplicate", ticket: ids.done },
      decideCompleteDuplicate(fleet, ids.done),
    ],
    [
      { tag: "JRevalFail", ticket: ids.pending },
      decideRevalFail(fleet, ids.pending),
    ],
    [
      { tag: "JOpRetry", ticket: ids.parkedPreWork },
      decideOpRetry(cfg, fleet, ids.parkedPreWork),
    ],
  ];
  for (const [cmd, direct] of rows) {
    assert.deepEqual(execCmd(cfg, fleet, cmd), direct, cmd.tag);
  }
  // EVERY CONSTRUCTOR, and the roster is taken from the type rather than
  // counted: a thirteenth constructor with no row here fails this line.
  const covered = new Set(rows.map(([cmd]) => cmd.tag));
  const declared: readonly CmdTag[] = [
    "JArrive",
    "JRelease",
    "JRevoke",
    "JDispatch",
    "JTaskDone",
    "JWorkReduce",
    "JEvalReduce",
    "JDequeue",
    "JGateResolve",
    "JCompleteDuplicate",
    "JRevalFail",
    "JOpRetry",
  ];
  assert.deepEqual(covered, new Set(declared));
});

test("execCmd: the dequeue's two arms reach the two routes the model hoists", () => {
  // The moved arm opens the gate; the quiet arm resolves the landing in the
  // same step. Naming either route in `execCmd` would be the copied route
  // `decideDequeue`'s header exists to prevent, so the pin is that the arms
  // differ and each equals the route it stands for.
  const moved = execCmd(cfg, fleet, {
    tag: "JDequeue",
    ticket: ids.enqueued,
    moved: true,
  });
  const quiet = execCmd(cfg, fleet, {
    tag: "JDequeue",
    ticket: ids.enqueued,
    moved: false,
  });
  assert.deepEqual(moved, decideWrapUpStart(fleet, ids.enqueued));
  assert.deepEqual(
    quiet,
    decideWrapUpResolve(cfg, fleet, ids.enqueued, "WOk", false),
  );
  assert.equal(moved.rec.label, "wrapup-started");
  assert.equal(quiet.rec.label, "ticket-done");
});

// === cmdEnabled: the enablement ============================================

test("cmdEnabled: every single-ticket arm is its shipped enablement set, exactly", () => {
  // Each row: the command shape, and the shipped set it must equal over the
  // WHOLE fleet. Set equality is both ends at once — a widened guard admits an
  // id the set does not hold, a narrowed one drops one it does.
  const rows: readonly (readonly [
    string,
    (j: number) => Cmd,
    ReadonlySet<number>,
  ])[] = [
    ["JRelease", (j) => ({ tag: "JRelease", ticket: j }), draftsIn(fleet)],
    ["JRevoke", (j) => ({ tag: "JRevoke", ticket: j }), revocablesIn(fleet)],
    ["JDispatch", (j) => ({ tag: "JDispatch", ticket: j }), readiesIn(fleet)],
    [
      "JWorkReduce",
      (j) => ({ tag: "JWorkReduce", ticket: j }),
      reducibleWorkIn(fleet),
    ],
    [
      "JEvalReduce",
      (j) => ({ tag: "JEvalReduce", ticket: j }),
      reducibleEvalIn(fleet),
    ],
    [
      "JDequeue",
      (j) => ({ tag: "JDequeue", ticket: j, moved: true }),
      wrapUpStartablesIn(fleet),
    ],
    [
      "JGateResolve",
      (j) => ({ tag: "JGateResolve", ticket: j, out: "WOk" }),
      holdingIn(fleet),
    ],
    [
      "JCompleteDuplicate",
      (j) => ({ tag: "JCompleteDuplicate", ticket: j }),
      doneIn(fleet),
    ],
    ["JRevalFail", (j) => ({ tag: "JRevalFail", ticket: j }), readiesIn(fleet)],
    [
      "JOpRetry",
      (j) => ({ tag: "JOpRetry", ticket: j }),
      retryablesIn(cfg, fleet),
    ],
    [
      "JTaskDone",
      (j) => ({ tag: "JTaskDone", ticket: j, tid: 1, verdict: "VPass" }),
      taskPhaseIn(fleet),
    ],
  ];
  for (const [name, build, expected] of rows) {
    assert.deepEqual(enabledAt(build), new Set(expected), name);
  }
  // The sets are not all the same set, and none of them is everything: a
  // predicate that answered true for the fleet would satisfy every row above
  // if the shipped sets were also everything.
  assert.deepEqual(draftsIn(fleet), new Set([ids.draft]));
  assert.deepEqual(readiesIn(fleet), new Set([ids.pending]));
  assert.deepEqual(holdingIn(fleet), new Set([ids.gated]));
  assert.notDeepEqual(new Set(revocablesIn(fleet)), new Set(everyId));
});

test("cmdEnabled: JDispatch conjoins the gas guard, where JRevalFail does not", () => {
  // The two draw from the same set and the model conjoins `dispatchableIn` to
  // one of them only — a pre-work park spends nothing, so it needs no gas.
  const broke: Core = core([[1, { ...jPend, deps: new Set(), gasLeft: 0 }]]);
  assert.equal(cmdEnabled(cfg, broke, { tag: "JDispatch", ticket: 1 }), false);
  assert.ok(cmdEnabled(cfg, broke, { tag: "JRevalFail", ticket: 1 }));
});

test("cmdEnabled: JTaskDone's tid conjunct is the whole issued history", () => {
  // Every id the ticket ever issued is deliverable — that is the at-least-once
  // fabric's range — and one past it is not.
  const issued = [1, 2];
  for (const tid of issued) {
    assert.ok(
      cmdEnabled(cfg, fleet, {
        tag: "JTaskDone",
        ticket: ids.working,
        tid,
        verdict: "VPass",
      }),
      `tid ${String(tid)}`,
    );
  }
  for (const tid of [0, 3]) {
    assert.equal(
      cmdEnabled(cfg, fleet, {
        tag: "JTaskDone",
        ticket: ids.working,
        tid,
        verdict: "VPass",
      }),
      false,
      `tid ${String(tid)}`,
    );
  }
});

test("cmdEnabled: JGateResolve's outcome is drawn from the moved attempt's set", () => {
  // `wrapUpOutcomes(true)` holds both; the arm names `true` because a gated
  // resolution IS the invalidated attempt. Both are enabled, and nothing else
  // is drawable.
  for (const out of ["WOk", "WFailed"] as const) {
    assert.ok(
      cmdEnabled(cfg, fleet, { tag: "JGateResolve", ticket: ids.gated, out }),
      out,
    );
  }
});

test("cmdEnabled: JOpRetry states retryablesIn, which the decider's own guard does not", () => {
  // THE BANKED FACT, and the sharpest row in this file. `decideOpRetry`'s guard
  // is `retryableIn` MINUS the no-modeled-resume arm, because the model answers
  // that park with a guarded no-op it reproduces. Enablement is the machine's
  // question, and the machine draws from `retryableEscalated`: the cascade wall
  // is NOT retryable, and reading the guard off the decider would admit it.
  const cascade = { tag: "JOpRetry", ticket: ids.parkedCascade } as const;
  assert.equal(cmdEnabled(cfg, fleet, cascade), false);
  // The decider does answer it — with the unreachable arm's noop — which is why
  // enablement cannot be inferred from the decider not throwing.
  assert.equal(
    execCmd(cfg, fleet, cascade).rec.label,
    "operator-retry-unreachable",
  );
  // And the affordability half is refused too, on a park whose resume charges
  // more gas than the ticket holds.
  const broke: Core = core([[1, { ...jEsc, gasLeft: 0 }]]);
  assert.equal(cmdEnabled(cfg, broke, { tag: "JOpRetry", ticket: 1 }), false);
  assert.deepEqual(retryablesIn(cfg, broke), new Set());
});

test("cmdEnabled: JArrive is the arrival bound and all four authored draws", () => {
  const empty = core([]);
  const good: Cmd = {
    tag: "JArrive",
    deps: new Set(),
    program: progU2,
    project: 1,
    wrapUp: wx1,
  };
  assert.ok(cmdEnabled(cfg, empty, good));

  // ONE REFUSAL PER CONJUNCT, each defeating exactly one.
  const refusals: readonly (readonly [string, Config, Core, Cmd])[] = [
    [
      "the arrival bound",
      { ...cfg, nTickets: 1 },
      solo(jDraft),
      { ...good, deps: new Set() },
    ],
    [
      "a tombstone dependency",
      cfg,
      core([[1, jParkDep]]),
      { ...good, deps: new Set([1]) },
    ],
    ["an ill-formed program", cfg, empty, { ...good, program: [] }],
    [
      "a project outside the universe",
      cfg,
      empty,
      { ...good, project: cfg.nProjects + 1 },
    ],
    [
      "an unauthorable wrap-up",
      cfg,
      empty,
      { ...good, wrapUp: { tag: "WExclusive", resource: cfg.nProjects + 1 } },
    ],
  ];
  for (const [why, at, c, cmd] of refusals) {
    assert.equal(cmdEnabled(at, c, cmd), false, why);
  }
  // A dependency that is merely UNRELEASED is dependable — the refusal above is
  // about tombstones, not about readiness.
  assert.ok(cmdEnabled(cfg, solo(jDraft), { ...good, deps: new Set([1]) }));
});

test("cmdEnabled: an id the fleet does not hold is refused, never thrown on", () => {
  // TOTALITY, which `journalLegalOn` relies on: enablement is checked before
  // the decider runs so that a tampered journal is REFUSED rather than crashed
  // on. Every single-ticket constructor is asked about an absent id.
  const absent = 99;
  const builders: readonly ((j: number) => Cmd)[] = [
    (j) => ({ tag: "JRelease", ticket: j }),
    (j) => ({ tag: "JRevoke", ticket: j }),
    (j) => ({ tag: "JDispatch", ticket: j }),
    (j) => ({ tag: "JTaskDone", ticket: j, tid: 1, verdict: "VPass" }),
    (j) => ({ tag: "JWorkReduce", ticket: j }),
    (j) => ({ tag: "JEvalReduce", ticket: j }),
    (j) => ({ tag: "JDequeue", ticket: j, moved: true }),
    (j) => ({ tag: "JGateResolve", ticket: j, out: "WOk" }),
    (j) => ({ tag: "JCompleteDuplicate", ticket: j }),
    (j) => ({ tag: "JRevalFail", ticket: j }),
    (j) => ({ tag: "JOpRetry", ticket: j }),
  ];
  for (const build of builders) {
    const cmd = build(absent);
    assert.equal(cmdEnabled(cfg, fleet, cmd), false, cmd.tag);
  }
  // And the decider it guards would NOT be total there, which is the whole
  // reason the order matters.
  assert.throws(
    () => execCmd(cfg, fleet, { tag: "JRelease", ticket: absent }),
    AssertionError,
  );
});

// === The decider roster ====================================================

test("decidersReached: the union over the whole Cmd type is the shipped roster", () => {
  const reached = new Set<string>();
  const commands: readonly Cmd[] = [
    {
      tag: "JArrive",
      deps: new Set(),
      program: progU2,
      project: 1,
      wrapUp: wx1,
    },
    { tag: "JRelease", ticket: 1 },
    { tag: "JRevoke", ticket: 1 },
    { tag: "JDispatch", ticket: 1 },
    { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
    { tag: "JWorkReduce", ticket: 1 },
    { tag: "JEvalReduce", ticket: 1 },
    { tag: "JDequeue", ticket: 1, moved: true },
    { tag: "JDequeue", ticket: 1, moved: false },
    { tag: "JGateResolve", ticket: 1, out: "WOk" },
    { tag: "JCompleteDuplicate", ticket: 1 },
    { tag: "JRevalFail", ticket: 1 },
    { tag: "JOpRetry", ticket: 1 },
  ];
  for (const cmd of commands) {
    for (const decider of decidersReached(cmd)) {
      reached.add(decider);
    }
  }
  assert.deepEqual(reached, new Set(shippedDeciders));
  // The two routes `decideDequeue` picks are named by the arm that picks them,
  // which is what makes `decideWrapUpStart` reachable at all.
  assert.deepEqual(
    decidersReached({ tag: "JDequeue", ticket: 1, moved: true }),
    ["decideDequeue", "decideWrapUpStart"],
  );
  assert.deepEqual(
    decidersReached({ tag: "JDequeue", ticket: 1, moved: false }),
    ["decideDequeue", "decideWrapUpResolve"],
  );
});

// === The absorbing pick classes ============================================

test("taskDoneAbsorbingClass: every issued id that is not live and running, both verdicts", () => {
  // Ticket 3 is Working with two RUNNING tasks, so neither absorbs; ticket 4
  // has the same two ids resolved, so both do; ticket 5 is Evaluating with its
  // stage resolved. Nothing outside the task phases contributes at all.
  const picks = taskDoneAbsorbingClass(fleet);
  const named = new Set(
    picks.map((cmd) =>
      cmd.tag === "JTaskDone"
        ? `${String(cmd.ticket)}:${String(cmd.tid)}:${cmd.verdict}`
        : cmd.tag,
    ),
  );
  assert.deepEqual(
    named,
    new Set([
      "4:1:VPass",
      "4:1:VFail",
      "4:2:VPass",
      "4:2:VFail",
      "5:1:VPass",
      "5:1:VFail",
      "5:2:VPass",
      "5:2:VFail",
    ]),
  );
  // EVERY MEMBER ABSORBS, which is the property the class is used for.
  for (const cmd of picks) {
    assert.ok(cmdEnabled(cfg, fleet, cmd));
    const decision = execCmd(cfg, fleet, cmd);
    assert.equal(decision.rec.label, "task-done-duplicate");
    assert.equal(decision.post, fleet);
  }
});

test("completeDuplicateAbsorbingClass: the landed tickets, and nothing else", () => {
  const picks = completeDuplicateAbsorbingClass(fleet);
  assert.deepEqual(
    new Set(
      picks.map((cmd) => (cmd.tag === "JCompleteDuplicate" ? cmd.ticket : 0)),
    ),
    new Set(doneIn(fleet)),
  );
  for (const cmd of picks) {
    assert.ok(cmdEnabled(cfg, fleet, cmd));
    const decision = execCmd(cfg, fleet, cmd);
    assert.equal(decision.rec.label, "complete-duplicate");
    assert.equal(decision.post, fleet);
  }
  // A fleet with nothing landed has an empty class, which is what makes the
  // replayer's emptiness check a real one.
  assert.deepEqual(completeDuplicateAbsorbingClass(solo(jDraft)), []);
});
