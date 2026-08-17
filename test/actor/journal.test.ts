/**
 * The journal machinery on hand-built histories, mirroring the model's
 * refinement unit suite: replay, legality, the tampered-journal refusals, and
 * the world-count arithmetic on concrete data.
 *
 * The three-decision history is built by the deciders themselves — arrive,
 * release, dispatch, records taken from the decisions — so it is the journal
 * an honest actor would write, and every refusal case below is that history
 * with exactly one thing forged.
 *
 * `cmdEnabled` AND `execCmd` GET A CASE PER ARM, from the two tables at the
 * foot. The refusal table carries a row per conjunct rather than per
 * constructor, because a row refused on a guard's first conjunct says nothing
 * about its second; the drive table takes the arms no walk in `test/actor/`
 * reaches, each answered against the domain decider called directly rather
 * than against `execCmd`'s own answer, so a mis-wired dispatch arm disagrees
 * with something.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cmdEnabled,
  cmdTags,
  execCmd,
  jArrive,
  jCompleteDuplicate,
  jDequeue,
  jDispatch,
  jEvalReduce,
  jGateResolve,
  jOpRetry,
  jRelease,
  jRevalFail,
  jRevoke,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import { coreEquals } from "../../src/actor/equality.ts";
import {
  genesis,
  journalLegalOn,
  replayCore,
  type Entry,
} from "../../src/actor/journal.ts";
import {
  journalCompletionsOn,
  journalSpawnsOn,
  worldSpawnsOn,
} from "../../src/actor/world.ts";
import {
  ticketAt,
  withTicket,
  type Core,
  type Decision,
} from "../../src/domain/core.ts";
import {
  decideOpRetry,
  decideRevalFail,
  decideRevoke,
  decideWrapUpResolve,
} from "../../src/domain/deciders.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import { id } from "../domain/fixtures.ts";
import { flatProgram, refinementInstance } from "./harness.ts";

const config = refinementInstance;

const cmd1 = jArrive([], flatProgram, asProjectId(1), wExclusive(1));
const d1 = execCmd(config, genesis, cmd1);
const e1: Entry = { seq: 1, cmd: cmd1, rec: d1.rec };
const cmd2 = jRelease(id(1));
const d2 = execCmd(config, d1.post, cmd2);
const e2: Entry = { seq: 2, cmd: cmd2, rec: d2.rec };
const cmd3 = jDispatch(id(1));
const d3 = execCmd(config, d2.post, cmd3);
const e3: Entry = { seq: 3, cmd: cmd3, rec: d3.rec };
const goodJournal: readonly Entry[] = [e1, e2, e3];

test("the empty journal is legal and replays to genesis", () => {
  assert.ok(journalLegalOn(config, []));
  assert.ok(coreEquals(replayCore(config, []), genesis));
});

test("an honest history is legal, and replay reconstructs what the deciders built", () => {
  assert.ok(journalLegalOn(config, goodJournal));
  const replayed = replayCore(config, goodJournal);
  assert.ok(coreEquals(replayed, d3.post));
  assert.equal(ticketAt(replayed, id(1)).phase, "PWorking");
  assert.equal(ticketAt(replayed, id(1)).gasLeft, 2);
});

test("replaying one more entry equals stepping the shorter replay once", () => {
  assert.ok(
    coreEquals(
      replayCore(config, goodJournal),
      execCmd(config, replayCore(config, [e1, e2]), cmd3).post,
    ),
  );
  assert.ok(
    coreEquals(
      replayCore(config, [e1, e2]),
      execCmd(config, replayCore(config, [e1]), cmd2).post,
    ),
  );
});

test("a sequence gap or a duplicate seq is refused", () => {
  assert.ok(!journalLegalOn(config, [{ ...e1, seq: 2 }]));
  assert.ok(!journalLegalOn(config, [e1, { ...e2, seq: 3 }]));
  assert.ok(!journalLegalOn(config, [e1, { ...e2, seq: 1 }]));
});

test("a decision that was never enabled is refused, cleanly, at any tampered payload", () => {
  assert.ok(!cmdEnabled(config, genesis, cmd2));
  assert.ok(!journalLegalOn(config, [{ ...e2, seq: 1 }]));
  assert.ok(
    !cmdEnabled(config, genesis, jTaskDone(id(1), asTaskId(1), "VPass")),
  );
  assert.ok(!cmdEnabled(config, genesis, jDispatch(id(1))));
  assert.ok(!cmdEnabled(config, genesis, jGateResolve(id(1), "WOk")));
  assert.ok(!cmdEnabled(config, genesis, jOpRetry(id(1))));
});

test("a forged record is refused: the entry's rec must be exactly the decider's", () => {
  assert.ok(
    !journalLegalOn(config, [
      e1,
      { ...e2, rec: { ...e2.rec, label: "ticket-done" } },
    ]),
  );
  assert.ok(
    !journalLegalOn(config, [
      e1,
      { ...e2, rec: { ...e2.rec, effects: ["Complete"] } },
    ]),
  );
});

test("an out-of-universe payload is refused by draw-set membership", () => {
  const phantom = jArrive([], flatProgram, asProjectId(1), wExclusive(99));
  const phantomEntry: Entry = {
    seq: 1,
    cmd: phantom,
    rec: execCmd(config, genesis, phantom).rec,
  };
  assert.ok(!cmdEnabled(config, genesis, phantom));
  assert.ok(!journalLegalOn(config, [phantomEntry]));
  assert.ok(
    !cmdEnabled(
      config,
      genesis,
      jArrive([], flatProgram, asProjectId(1), wExclusive(2)),
    ),
  );
});

test("the world arithmetic: emission closes the gap to the book, an orphan pushes past it", () => {
  assert.equal(journalSpawnsOn(goodJournal, id(1)), 1);
  assert.equal(worldSpawnsOn(goodJournal, new Set(), [], id(1)), 0);
  assert.equal(worldSpawnsOn(goodJournal, new Set([1, 2, 3]), [], id(1)), 1);
  assert.equal(
    worldSpawnsOn(goodJournal, new Set([1, 2, 3]), [d3.rec], id(1)),
    2,
  );
  assert.ok(
    worldSpawnsOn(goodJournal, new Set([1, 2, 3]), [d3.rec], id(1)) >
      journalSpawnsOn(goodJournal, id(1)),
  );
  assert.equal(journalCompletionsOn(goodJournal, id(1)), 0);
});

test("no-op decisions journal like any others and replay through", () => {
  const real = execCmd(config, d3.post, jTaskDone(id(1), asTaskId(1), "VPass"));
  const duplicate = execCmd(
    config,
    real.post,
    jTaskDone(id(1), asTaskId(1), "VFail"),
  );
  const e4: Entry = {
    seq: 4,
    cmd: jTaskDone(id(1), asTaskId(1), "VPass"),
    rec: real.rec,
  };
  const e5: Entry = {
    seq: 5,
    cmd: jTaskDone(id(1), asTaskId(1), "VFail"),
    rec: duplicate.rec,
  };
  assert.equal(duplicate.rec.label, "task-done-duplicate");
  assert.ok(coreEquals(duplicate.post, real.post));
  assert.ok(journalLegalOn(config, [e1, e2, e3, e4, e5]));
  assert.ok(coreEquals(replayCore(config, [e1, e2, e3, e4, e5]), real.post));
});

/** The journal an honest actor writes for this run of decisions, each record taken from the decider. */
function journalOf(cmds: readonly Cmd[]): readonly Entry[] {
  const entries: Entry[] = [];
  let core = genesis;
  for (const cmd of cmds) {
    const decision = execCmd(config, core, cmd);
    entries.push({ seq: entries.length + 1, cmd, rec: decision.rec });
    core = decision.post;
  }
  return entries;
}

/** The state that run reaches. */
function coreAfter(cmds: readonly Cmd[]): Core {
  return cmds.reduce((core, cmd) => execCmd(config, core, cmd).post, genesis);
}

const toDrafted: readonly Cmd[] = [cmd1];
const toReady: readonly Cmd[] = [...toDrafted, jRelease(id(1))];
const toWorking: readonly Cmd[] = [...toReady, jDispatch(id(1))];
const toEvaluating: readonly Cmd[] = [
  ...toWorking,
  jTaskDone(id(1), asTaskId(1), "VPass"),
  jWorkReduce(id(1)),
];
const toEnqueued: readonly Cmd[] = [
  ...toEvaluating,
  jTaskDone(id(1), asTaskId(2), "VPass"),
  jEvalReduce(id(1)),
];
const toHolding: readonly Cmd[] = [...toEnqueued, jDequeue(id(1), true)];
const toDone: readonly Cmd[] = [...toHolding, jGateResolve(id(1), "WOk")];
const toEscalated: readonly Cmd[] = [...toReady, jRevalFail(id(1))];

const drafted = coreAfter(toDrafted);
const ready = coreAfter(toReady);
const working = coreAfter(toWorking);
const evaluating = coreAfter(toEvaluating);
const enqueued = coreAfter(toEnqueued);
const holding = coreAfter(toHolding);
const done = coreAfter(toDone);
const escalated = coreAfter(toEscalated);
const full = coreAfter([...toDrafted, cmd1]);

/**
 * A Ready ticket out of gas, which the machine cannot reach: gas is spent only
 * by entering Working and nothing returns from there to Pending. Only a forged
 * prefix state refuses on the dispatch's second conjunct, and a replayed
 * journal is exactly where an unreachable prefix can turn up.
 */
const readyNoGas = withTicket(ready, id(1), {
  ...ticketAt(ready, id(1)),
  gasLeft: 0,
});

interface Refusal {
  readonly conjunct: string;
  readonly at: Core;
  readonly cmd: Cmd;
}

const refusals: readonly Refusal[] = [
  { conjunct: "JArrive/canArriveIn", at: full, cmd: cmd1 },
  {
    conjunct: "JArrive/dependableIn",
    at: drafted,
    cmd: jArrive([id(2)], flatProgram, asProjectId(1), wExclusive(1)),
  },
  {
    conjunct: "JArrive/depsDistinct",
    at: drafted,
    cmd: jArrive([id(1), id(1)], flatProgram, asProjectId(1), wExclusive(1)),
  },
  {
    conjunct: "JArrive/isValidProgram",
    at: genesis,
    cmd: jArrive(
      [],
      [...flatProgram, ...flatProgram],
      asProjectId(1),
      wExclusive(1),
    ),
  },
  {
    conjunct: "JArrive/projects",
    at: genesis,
    cmd: jArrive([], flatProgram, asProjectId(2), wExclusive(1)),
  },
  {
    conjunct: "JArrive/wrapUpChoices",
    at: genesis,
    cmd: jArrive([], flatProgram, asProjectId(1), wExclusive(99)),
  },
  { conjunct: "JRelease/draftsIn", at: ready, cmd: jRelease(id(1)) },
  { conjunct: "JRevoke/revocablesIn", at: done, cmd: jRevoke(id(1)) },
  { conjunct: "JDispatch/readiesIn", at: drafted, cmd: jDispatch(id(1)) },
  {
    conjunct: "JDispatch/dispatchableIn",
    at: readyNoGas,
    cmd: jDispatch(id(1)),
  },
  {
    conjunct: "JTaskDone/taskPhaseIn",
    at: ready,
    cmd: jTaskDone(id(1), asTaskId(1), "VPass"),
  },
  {
    conjunct: "JTaskDone/deliverableTaskIds",
    at: working,
    cmd: jTaskDone(id(1), asTaskId(9), "VPass"),
  },
  {
    conjunct: "JWorkReduce/reducibleWorkIn",
    at: working,
    cmd: jWorkReduce(id(1)),
  },
  {
    conjunct: "JEvalReduce/reducibleEvalIn",
    at: evaluating,
    cmd: jEvalReduce(id(1)),
  },
  {
    conjunct: "JDequeue/wrapUpStartablesIn",
    at: holding,
    cmd: jDequeue(id(1), true),
  },
  {
    conjunct: "JGateResolve/holdingIn",
    at: enqueued,
    cmd: jGateResolve(id(1), "WOk"),
  },
  {
    conjunct: "JCompleteDuplicate/doneIn",
    at: ready,
    cmd: jCompleteDuplicate(id(1)),
  },
  { conjunct: "JRevalFail/readiesIn", at: done, cmd: jRevalFail(id(1)) },
  { conjunct: "JOpRetry/retryablesIn", at: ready, cmd: jOpRetry(id(1)) },
];

/**
 * `JGateResolve`'s outcome membership has no row: `WrapUpOutcome` holds only
 * the two the model draws, so nothing outside the set can be constructed and
 * the `WFailed` drive below is what stands behind that conjunct.
 */
test("every conjunct of every enablement refuses on a state that fails it alone", () => {
  for (const { conjunct, at, cmd } of refusals) {
    assert.ok(!cmdEnabled(config, at, cmd), `${conjunct}: enabled anyway`);
  }
});

test("the refusal table names every constructor the model declares", () => {
  assert.deepEqual(
    [...new Set(refusals.map((row) => row.cmd.cmd))].sort(),
    [...cmdTags].sort(),
  );
});

/**
 * The repeat is refused for being a repeat and nothing else: the same arrival
 * naming the dep once is enabled at the same state, which is what the row above
 * cannot say on its own.
 */
test("an arrival repeating a dep is refused where naming it once is enabled", () => {
  const once = jArrive([id(1)], flatProgram, asProjectId(1), wExclusive(1));
  const twice = jArrive(
    [id(1), id(1)],
    flatProgram,
    asProjectId(1),
    wExclusive(1),
  );
  assert.ok(!cmdEnabled(config, drafted, twice), "the repeat was enabled");
  assert.ok(cmdEnabled(config, drafted, once), "the distinct twin was refused");
});

/** `decided` is the domain decider called directly, so a mis-wired dispatch arm has somewhere to disagree. */
interface Drive {
  readonly arm: string;
  readonly before: readonly Cmd[];
  readonly cmd: Cmd;
  readonly at: Core;
  readonly decided: Decision;
}

const drives: readonly Drive[] = [
  {
    arm: "JRevoke",
    before: toReady,
    cmd: jRevoke(id(1)),
    at: ready,
    decided: decideRevoke(ready, id(1)),
  },
  {
    arm: "JRevalFail",
    before: toReady,
    cmd: jRevalFail(id(1)),
    at: ready,
    decided: decideRevalFail(ready, id(1)),
  },
  {
    arm: "JGateResolve/WOk",
    before: toHolding,
    cmd: jGateResolve(id(1), "WOk"),
    at: holding,
    decided: decideWrapUpResolve(config, holding, id(1), "WOk", true),
  },
  {
    arm: "JGateResolve/WFailed",
    before: toHolding,
    cmd: jGateResolve(id(1), "WFailed"),
    at: holding,
    decided: decideWrapUpResolve(config, holding, id(1), "WFailed", true),
  },
  {
    arm: "JOpRetry",
    before: toEscalated,
    cmd: jOpRetry(id(1)),
    at: escalated,
    decided: decideOpRetry(config, escalated, id(1)),
  },
];

test("each otherwise-undriven arm journals legally and decides what the domain decides", () => {
  for (const { arm, before, cmd, at, decided } of drives) {
    assert.ok(cmdEnabled(config, at, cmd), `${arm}: refused at its own state`);
    const taken = execCmd(config, at, cmd);
    assert.deepEqual(taken.rec, decided.rec, `${arm}: a different record`);
    assert.deepEqual(
      taken.post,
      decided.post,
      `${arm}: a different post-state`,
    );
    const journal = journalOf([...before, cmd]);
    assert.equal(journal.length, before.length + 1);
    assert.ok(
      journalLegalOn(config, journal),
      `${arm}: the journal is illegal`,
    );
    assert.ok(
      coreEquals(replayCore(config, journal), decided.post),
      `${arm}: replay does not reach the decided state`,
    );
  }
});
