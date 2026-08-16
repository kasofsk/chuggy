/**
 * THE SEEDED RANDOM LEGAL ACTION WALKER — `check-model.sh`'s randomized stage,
 * in TypeScript: from `init` at an mc instance's consts, enumerate the enabled
 * command universe, draw one legal action, step the machine, and evaluate the
 * whole domain invariant bundle after every step.
 *
 * WHY THE SLICE EXISTS AT ALL, in the model's own words: twice an all-green
 * deterministic suite hid a defect that only randomized exploration found. The
 * golden corpus replays the traces the model already emitted, so it can only
 * ever re-ask the questions the model already asked; this layer asks questions
 * nobody wrote down.
 *
 * IT MINTS NO DISPATCH OF ITS OWN. Every candidate command is filtered through
 * `cmdEnabled` and every step goes through `stepWith`, which asks the same
 * question again before running a decider — the s2a/s3 lesson, that a second
 * spelling of a guard is a guard that goes on admitting what the first one
 * stopped admitting. The enumeration below is therefore also the largest single
 * exercise of `cmdEnabled` in the tree: it asks it of the WHOLE bounded payload
 * space at every state of every walk, absent ticket ids and never-issued task
 * ids included, which is what makes its documented totality a fact rather than
 * a paragraph.
 *
 * THE PAYLOAD SPACES ARE BOUNDED BY THE CONFIGURATION, NEVER BY THE STATE'S OWN
 * ENABLEMENT SETS. A ticket id ranges over `1..N_TICKETS` rather than over
 * `draftsIn(c)`, and a task id over the ticket's whole spawn history plus one id
 * it never issued. Drawing the id out of the enablement set would make the
 * filter tautological — the walker would be asking `cmdEnabled` about commands
 * `cmdEnabled`'s own definitions had just produced, and a defect in either would
 * agree with itself.
 *
 * Two kinds of draw are the exception, and they are exceptions for two
 * different reasons. The AUTHORING universes — `dependableIn`,
 * `validPrograms`, `projects`, `wrapUpChoices` — are taken from the model's own
 * sets because there the refusal rule IS the set: the model's action draws from
 * exactly those, and there is no wider bounded space to draw from. The two
 * CLOSED payloads — a verdict and the dequeue's `moved` — are written out here
 * as the model writes them, `Set(VPass, VFail)` and `Set(true, false)`, because
 * a two-element universe has no set to consult.
 *
 * That leaves ONE draw taken from a set `cmdEnabled` then filters by:
 * `wrapUpOutcomes(true)`, the gate resolution's outcome. It is the tautological
 * shape this paragraph warns about, and it is harmless here rather than
 * defended: the set is the model's refusal rule for that draw exactly as the
 * authoring universes are, and enumerating a wider space would mean inventing
 * an outcome the type does not have. It is named because a reader counting the
 * exceptions should find the count already made.
 *
 * THE ACTION IS DRAWN IN TWO STAGES — a tag, then a payload — because that is
 * the shape of the model's own `step`: `any { arrive, release, … }` picks among
 * the enabled ACTIONS, and each action's `nondet … oneOf()` then picks among
 * that action's draws. One flat draw over the union would be a different
 * distribution and a much worse one: at these consts an arrival's product of
 * four draws outnumbers every other constructor's picks together, so a flat
 * walk would spend its budget authoring tickets and never reach a gate.
 *
 * `settle` IS ONE OF THE OPTIONS, not a fallback, because it is one of the
 * disjuncts of the model's `step` — a step of the domain machine that happens
 * to have no decider, rather than something the walker does when it runs out of
 * ideas. A walker that took it only when nothing else was enabled would be
 * walking a machine whose `step` roster has twelve entries instead of
 * thirteen. (The tempting second reason — that a quiet fleet still enables
 * `complete-duplicate`, so a fallback would never fire — does not survive
 * measurement: that arm needs a landed ticket AND the re-delivery drawn on it
 * before the run ends, and the sampled walks in `randomized.test.ts` do land
 * one without ever going on to draw the duplicate. The decision stands on the
 * model's roster, which is why the roster is the reason given.)
 *
 * WHAT THIS FILE IS NOT. It declares no test: it is the harness
 * `randomized.test.ts` drives, on `fixtures.test.ts`'s precedent — the `.test.ts`
 * suffix is this tree's file class for "exists only for the suite", and nothing
 * that ships may import one. It is under `src/spine/`, so the purity rule binds
 * it in full: the generator below is the only source of variation in it, and it
 * is a pure function of an integer.
 */

import { messageOf } from "../domain/assert.ts";
import {
  dependableIn,
  projects,
  validPrograms,
  wrapUpChoices,
  wrapUpOutcomes,
  type Config,
} from "../domain/domain.ts";
import { redConjuncts } from "../domain/bundle.test.ts";
import type { Core } from "../domain/measure.ts";
import { cmdEnabled, type Cmd, type CmdTag } from "./cmd.ts";
import { CoverageBuilder, type Coverage } from "./coverage.ts";
import { stepLabel } from "./decode.ts";
import {
  currentMeasure,
  initialState,
  invariantsHold,
  quiet,
  settle,
  stepWith,
  type MachineState,
} from "./machine.ts";

// === The generator =========================================================

/**
 * SPLITMIX32 — the 32-bit analogue of the SplitMix64 generator of Steele, Lea
 * and Flood, "Fast Splittable Pseudorandom Number Generators" (OOPSLA 2014):
 * a Weyl sequence over the golden-ratio increment `0x9e3779b9`, finalized by a
 * Murmur3-style xor-shift-multiply mixer. It is written out here rather than
 * taken from a package for two reasons this slice cannot trade away — the
 * purity rule forbids `Math.random` outright, and a walk whose failures cannot
 * be reproduced from a seed reports a defect nobody can look at.
 *
 * THE STATE IS EXPLICIT AND THE FUNCTION IS PURE. `draw` takes a generator
 * state and returns the value beside the NEXT state; there is no hidden
 * counter, so a walk is a fold over its seed and a step index names a state the
 * reader can reach. `Math.imul` is the 32-bit multiply this needs; `Math` is
 * not an ambient capability and only `Math.random` is rostered.
 */
export type Gen = number;

/** One draw: a uint32, and the generator state that follows it. */
export function draw(g: Gen): { readonly value: number; readonly gen: Gen } {
  const gen = (g + 0x9e3779b9) | 0;
  let t = gen ^ (gen >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return { value: t >>> 0, gen };
}

/**
 * THE SEEDS OF A RUN OF WALKS, from one root — SplitMix's own split idiom: each
 * walk is seeded with a DRAWN VALUE of the root's generator rather than with a
 * successive state of it.
 *
 * The distinction is the whole reason this function exists rather than a
 * `root + k` in the caller. The states of this generator are a Weyl sequence,
 * so seeding walk `k` with the `k`-th state would make walk `k + 1`'s draws the
 * same stream as walk `k`'s, offset by one draw — a run of walks that looked
 * independent and was one walk read through a sliding window. The mixer is what
 * separates them, and it is exactly what the mixer is for.
 */
export function walkSeeds(root: Gen, count: number): readonly number[] {
  const seeds: number[] = [];
  let gen: Gen = root | 0;
  for (let k = 0; k < count; k += 1) {
    const drawn = draw(gen);
    gen = drawn.gen;
    seeds.push(drawn.value);
  }
  return seeds;
}

/**
 * A uniform index below `n`, by remainder.
 *
 * The remainder's bias is the standard one and it is negligible here: `n` is
 * the number of enabled actions or of one action's picks, which at these consts
 * is a few hundred at the very most, against a 32-bit range. What a rejection
 * loop would buy is a uniformity no exploration budget can distinguish, at the
 * cost of a loop whose step count depends on the draw — and this walker's whole
 * contract is that a seed and a step index name one state.
 */
export function drawIndex(
  g: Gen,
  n: number,
): { readonly index: number; readonly gen: Gen } {
  const { value, gen } = draw(g);
  return { index: value % n, gen };
}

// === The enabled command universe ==========================================

/**
 * One machine action available at a state: a `Cmd` constructor with every
 * payload the state enables under it, or the `settle` stutter.
 *
 * The picks are carried rather than recomputed because both stages of the draw
 * need them — the tag is available exactly when its pick list is non-empty.
 */
export type Available =
  | {
      readonly kind: "cmd";
      readonly tag: CmdTag;
      readonly picks: readonly Cmd[];
    }
  | { readonly kind: "settle" };

/**
 * Every constructor's BOUNDED PAYLOAD SPACE at a state, before enablement.
 *
 * A `Record` over `CmdTag` rather than a list of tags beside a switch: the
 * typechecker then refuses a tree where `Cmd` grew a constructor and this
 * enumeration did not, which is the one drift that would make the walker
 * quietly explore less than it claims.
 */
const payloadSpace: Readonly<
  Record<CmdTag, (cfg: Config, c: Core) => readonly Cmd[]>
> = {
  JArrive: (cfg, c) => {
    const cmds: Cmd[] = [];
    for (const deps of subsetsOf(dependableIn(c))) {
      for (const program of validPrograms(cfg)) {
        for (const project of projects(cfg)) {
          for (const wrapUp of wrapUpChoices(cfg)) {
            cmds.push({ tag: "JArrive", deps, program, project, wrapUp });
          }
        }
      }
    }
    return cmds;
  },
  JRelease: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JRelease", ticket })),
  JRevoke: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JRevoke", ticket })),
  JDispatch: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JDispatch", ticket })),
  JTaskDone: (cfg, c) => {
    const cmds: Cmd[] = [];
    for (const ticket of ticketIds(cfg)) {
      for (const tid of taskIds(c, ticket)) {
        cmds.push({ tag: "JTaskDone", ticket, tid, verdict: "VPass" });
        cmds.push({ tag: "JTaskDone", ticket, tid, verdict: "VFail" });
      }
    }
    return cmds;
  },
  JWorkReduce: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JWorkReduce", ticket })),
  JEvalReduce: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JEvalReduce", ticket })),
  JDequeue: (cfg) =>
    ticketIds(cfg).flatMap((ticket) => [
      { tag: "JDequeue", ticket, moved: true },
      { tag: "JDequeue", ticket, moved: false },
    ]),
  JGateResolve: (cfg) => {
    const cmds: Cmd[] = [];
    for (const ticket of ticketIds(cfg)) {
      for (const out of wrapUpOutcomes(true)) {
        cmds.push({ tag: "JGateResolve", ticket, out });
      }
    }
    return cmds;
  },
  JCompleteDuplicate: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JCompleteDuplicate", ticket })),
  JRevalFail: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JRevalFail", ticket })),
  JOpRetry: (cfg) =>
    ticketIds(cfg).map((ticket) => ({ tag: "JOpRetry", ticket })),
};

/**
 * The ticket-id universe: `1..N_TICKETS`, whatever the fleet currently holds.
 *
 * `idsDense` is the invariant that makes this the whole space — live ids are
 * `1..size` — and `canArriveIn` is what bounds the size. Ids no ticket occupies
 * are enumerated deliberately: `cmdEnabled` promises to REFUSE them rather than
 * crash on them, and this is where that promise is exercised at scale.
 */
function ticketIds(cfg: Config): readonly number[] {
  const ids: number[] = [];
  for (let j = 1; j <= cfg.nTickets; j += 1) {
    ids.push(j);
  }
  return ids;
}

/**
 * The task-id universe for one ticket: every id it has ever spawned, plus the
 * next one it has not.
 *
 * `spawned` is the ghost counter `idsAccounted` keeps honest, so it bounds the
 * history without asking `deliverableTaskIds` — which is the set `cmdEnabled`
 * itself filters by, and drawing from it would make the filter tautological.
 * The extra id is the never-issued one, refused.
 */
function taskIds(c: Core, ticket: number): readonly number[] {
  const jb = c.tickets.get(ticket);
  const ceiling = jb === undefined ? 1 : jb.spawned + 1;
  const ids: number[] = [];
  for (let tid = 1; tid <= ceiling; tid += 1) {
    ids.push(tid);
  }
  return ids;
}

/** Every subset of a bounded set of ids — the model's `powerset().oneOf()`. */
function subsetsOf(xs: ReadonlySet<number>): readonly ReadonlySet<number>[] {
  let subsets: ReadonlySet<number>[] = [new Set()];
  for (const x of xs) {
    subsets = [...subsets, ...subsets.map((s) => new Set([...s, x]))];
  }
  return subsets;
}

/**
 * THE ENABLED COMMAND UNIVERSE at a state, grouped by constructor, with
 * `settle` appended when the machine is quiet.
 *
 * Every candidate is filtered through the shipped `cmdEnabled` and nothing
 * else — no arm of it is restated, and no enablement set is consulted directly.
 */
export function availableActions(cfg: Config, c: Core): readonly Available[] {
  const available: Available[] = [];
  for (const [tag, space] of Object.entries(payloadSpace)) {
    const picks = space(cfg, c).filter((cmd) => cmdEnabled(cfg, c, cmd));
    if (picks.length > 0) {
      available.push({ kind: "cmd", tag: tag as CmdTag, picks });
    }
  }
  if (quiet(cfg, c)) {
    available.push({ kind: "settle" });
  }
  return available;
}

// === The anti-vacuity witnesses ============================================

/**
 * `model/domain.qnt`'s three ANTI-VACUITY WITNESSES — not invariants of the
 * machine, and the whole point of them is that they are EXPECTED TO BE
 * VIOLATED. Each names a shape whose absence would make a green invariant
 * vacuous: an exemption arm nothing fires is indistinguishable from dead code,
 * a cascade that never parks makes `cascadeSafety` true over an empty set, and
 * a fleet that only ever drew single-stage programs never takes the advance
 * edge.
 *
 * THEY ARE HERE AND NOT IN `invariants.ts` because the model's own comment says
 * what they are: "not an invariant of the machine". `invariants.ts` ships
 * `allInvariants`' conjuncts and the two halves of `measureDescends`, and
 * nothing that ships would call these — the layer that needs them is the
 * randomized one, which is this layer, and a shipped predicate with no shipped
 * caller is the shape this tree already declined once for `installCore`.
 */
export const witnessNames = [
  "freeClimbNever",
  "cascadeParkNever",
  "stageAdvanceNever",
] as const;

export type WitnessName = (typeof witnessNames)[number];

/**
 * The three, each as the model writes it, over a machine state.
 *
 * `freeClimbNever` reads `currentMeasure` against the `prevMeasure` ghost —
 * the model's own comparison — and deliberately EXCLUDES the pre-work
 * `RPending` resume: that flavor climbs for free under both meterings, so
 * admitting it would let a charged instance violate this witness without ever
 * exercising the `RetryFree` arm it exists to prove alive.
 */
export const witnesses: Readonly<
  Record<WitnessName, (cfg: Config, s: MachineState) => boolean>
> = {
  freeClimbNever: (cfg, s) =>
    !(
      s.lastStep.label === "operator-retry" &&
      s.lastStep.transitions.some(
        (t) => t.to === "PEvaluating" || t.to === "PWrapUp",
      ) &&
      currentMeasure(cfg, s.core) > s.prevMeasure
    ),
  cascadeParkNever: (_cfg, s) =>
    !(
      s.lastStep.label === "ticket-revoked" && s.lastStep.transitions.length > 1
    ),
  stageAdvanceNever: (_cfg, s) => s.lastStep.label !== "eval-stage-passed",
};

/** Where a witness was violated: the step that fired it, and under what label. */
export type WitnessFiring = {
  readonly witness: WitnessName;
  readonly step: number;
  readonly label: string;
};

// === The run ===============================================================

/**
 * The next step of a run: one of the model's twelve decisions, or its stutter.
 *
 * A DECISION CARRIES WHERE IT CAME FROM, because a refusal means opposite
 * things on the two paths. A command DRAWN from the enumeration and then
 * refused is `cmdEnabled` disagreeing with itself about one state — the
 * model-conformance alarm. A SCRIPTED command refused is a script that named a
 * step the machine does not offer, which is a defect in the script or in the
 * shape it is trying to reach. One message for both would be a lie on one of
 * them.
 */
export type Move =
  | { readonly kind: "cmd"; readonly cmd: Cmd; readonly from: MoveSource }
  | { readonly kind: "settle" };

export type MoveSource = "enumeration" | "script";

/**
 * How a run chooses its next move, given everything the state enables.
 *
 * THE ONE LOOP HAS TWO CHOOSERS, and that is why this type exists rather than
 * two loops. A random walk and a deterministic witness trace disagree about
 * exactly one thing — where the next move comes from — and agree about
 * everything the loop does after it: the bundle after every step, the rosters,
 * the witnesses, the reproduction a finding carries. Written twice, the second
 * copy is where one of those checks would go missing.
 *
 * `report` is how a chooser states a finding of its own; returning nothing ends
 * the run.
 */
type Chooser = (
  options: readonly Available[],
  state: MachineState,
  step: number,
  report: (detail: string) => void,
) => Move | undefined;

/**
 * What one run found. The rosters are what it REACHED — labels, deciders,
 * `stepDescends` exemption arms — and the findings are what it caught.
 *
 * `steps` is what the run actually took rather than its budget: a walk can end
 * early on a state with no enabled action at all, which is a real dead end of
 * the machine rather than a defect (a ticket parked on the desk that cannot
 * afford its resume is terminal for the simulator, and `settle` does not cover
 * it, because a parked ticket is not settled).
 */
export type RunResult = {
  readonly where: string;
  readonly steps: number;
  /**
   * The moves taken, in order — the run itself, not a summary of it.
   *
   * It is kept because two different things need a run's IDENTITY and neither
   * can get it from the rosters: the reproducibility probe, which must be able
   * to say that two seeds walked DIFFERENT machines rather than that they
   * happened to reach different label sets, and a reader chasing a finding,
   * for whom the steps before the one that failed are the counterexample. A
   * roster is lossy about both — two walks that reach the same labels in a
   * different order are the same coverage and different runs.
   */
  readonly trace: readonly string[];
  readonly coverage: Coverage;
  readonly firings: readonly WitnessFiring[];
  readonly findings: readonly string[];
};

/**
 * THE LOOP: from `init` at `cfg`, take up to `budget` chosen steps, and after
 * every one evaluate the bundle, the rosters and the three witnesses.
 *
 * A FINDING NAMES ITS OWN REPRODUCTION — the run, the step index, the command
 * taken, and the conjuncts that went red — because a randomized layer whose
 * failure reads "expected true" has found a defect and then thrown away the
 * only copy of it. The conjunct names come from `bundle.test.ts`'s roster,
 * which `invariants.test.ts` keeps in agreement with the shipped bundle; naming
 * them from a second roster here is the drift this tree spends its duplication
 * gate on.
 *
 * IT STOPS AT THE FIRST FINDING, unlike the replayer, and for the opposite
 * reason. A replayed trace's later steps are evidence about which decider
 * moved; a run's later steps depart from a state the machine should never have
 * reached, so everything after the first violation is noise around one
 * counterexample.
 *
 * A WITNESS IS RECORDED ONCE, on the FIRST step that violates it. What a probe
 * asks of a run is that the shape occurred at all, and where; a second firing
 * of the same witness is the same answer again, and keeping every one would
 * make a run's report grow with its budget rather than with what it found.
 */
function runMachine(
  cfg: Config,
  instance: string,
  where: string,
  budget: number,
  choose: Chooser,
): RunResult {
  const coverage = new CoverageBuilder();
  coverage.observeInstance(instance);
  const firings: WitnessFiring[] = [];
  const findings: string[] = [];
  const trace: string[] = [];
  const report = (detail: string): void => {
    findings.push(`${where}: ${detail}`);
  };

  let state = initialState(cfg);
  observe(coverage, cfg, state, 0, findings, where);
  let step = 0;
  let ended = false;
  while (step < budget && findings.length === 0 && !ended) {
    const options = availableActions(cfg, state.core);
    if (options.length === 0) {
      break;
    }
    // A RUN ENDS ON ITS FIRST STEP OUT OF A QUIET FLEET, one step after it
    // reaches the dead end rather than at it. Every action a quiet state
    // enables is a self-loop — `settle` by construction, `complete-duplicate`
    // because `PDone` is absorbing — so the steps after this one are the same
    // state redrawn, and a walk that kept spending its budget there would be
    // reporting a length it had not explored. The one step is kept because the
    // `settled` and `complete-duplicate` exemption arms are reachable nowhere
    // else, which is the corpus emitter's rule for the same run of steps:
    // truncate it, and keep a representative.
    ended = quiet(cfg, state.core);
    step += 1;
    const move = choose(options, state, step, report);
    if (move === undefined) {
      step -= 1;
      break;
    }
    const stepped = takeStep(cfg, state, move, step, report);
    if (stepped === undefined) {
      // The step was not taken, so it is not counted: `steps` is what the run
      // reached, and a refusal is reported by its own finding.
      step -= 1;
      break;
    }
    state = stepped;
    const taken = showMove(move);
    trace.push(taken);
    if (move.kind === "cmd") {
      coverage.observeCmd(move.cmd);
    }
    observe(coverage, cfg, state, step, findings, where, taken);
    // GUARDED FOR `observe`'s REASON, and it is the same hazard: `freeClimbNever`
    // reads `currentMeasure`, so `measure.ts`'s assertions are reachable from a
    // witness too. A witness that cannot be evaluated is a finding here rather
    // than an exception thrown past the run.
    try {
      for (const witness of witnessNames) {
        if (
          !witnesses[witness](cfg, state) &&
          !firings.some((f) => f.witness === witness)
        ) {
          firings.push({ witness, step, label: state.lastStep.label });
        }
      }
    } catch (error) {
      report(
        `step ${String(step)} after ${taken}: a witness threw: ${messageOf(error)}`,
      );
    }
  }
  return {
    where,
    steps: step,
    trace,
    coverage: coverage.taken(),
    firings,
    findings,
  };
}

/**
 * The chosen move, taken.
 *
 * A REFUSED STEP IS A FINDING, never an exception: `stepWith` re-asks
 * `cmdEnabled` before running the decider, so a command the enumeration offered
 * and that step refused is the two answering differently about the same state —
 * the model-conformance alarm this layer exists to be able to raise. A decider
 * that THROWS on a command `cmdEnabled` admitted is the same alarm from the
 * other side, and is caught here for the same reason.
 */
function takeStep(
  cfg: Config,
  state: MachineState,
  move: Move,
  step: number,
  report: (detail: string) => void,
): MachineState | undefined {
  if (move.kind === "settle") {
    const settled = settle(cfg, state);
    if (settled === undefined) {
      report(`step ${String(step)}: settle refused a quiet fleet`);
      return undefined;
    }
    return settled;
  }
  let stepped;
  try {
    stepped = stepWith(cfg, state, move.cmd);
  } catch (error) {
    report(
      `step ${String(step)}: ${showCmd(move.cmd)} threw ${messageOf(error)} — a command cmdEnabled admits and its decider refuses`,
    );
    return undefined;
  }
  if (stepped === undefined) {
    report(
      move.from === "enumeration"
        ? `step ${String(step)}: ${showCmd(move.cmd)} was enumerated as enabled and then refused by stepWith — cmdEnabled disagreeing with itself about one state`
        : `step ${String(step)}: ${showCmd(move.cmd)} is scripted here and cmdEnabled does not admit it`,
    );
    return undefined;
  }
  return stepped;
}

// === The two runs ==========================================================

/**
 * ONE SEEDED WALK: up to `budget` steps, every one drawn from the enabled
 * universe under `seed`.
 *
 * THE DRAW IS IN TWO STAGES, and the file header argues why: an action, then
 * that action's payload — the shape of the model's `any { … }` over its
 * thirteen actions, each with its own `nondet … oneOf()`. Within one action the
 * payload is drawn flat over the enabled product rather than binder by binder,
 * which is the same distribution wherever the binders are independent (an
 * arrival's four draws) and differs only where one binder's range depends on an
 * earlier one (a completion's task id, whose range is the drawn ticket's own
 * history). Nothing in the exploration turns on the difference, and a flat draw
 * is what "pick from the enabled universe" means.
 */
export function walkOnce(
  cfg: Config,
  instance: string,
  seed: number,
  budget: number,
): RunResult {
  let gen: Gen = seed | 0;
  return runMachine(
    cfg,
    instance,
    `${instance} seed=${hex(seed)}`,
    budget,
    (options, _state, step, report) => {
      const action = drawIndex(gen, options.length);
      gen = action.gen;
      const chosen = options[action.index];
      if (chosen === undefined) {
        report(`step ${String(step)}: the action draw left the roster`);
        return undefined;
      }
      if (chosen.kind === "settle") {
        return { kind: "settle" };
      }
      const payload = drawIndex(gen, chosen.picks.length);
      gen = payload.gen;
      const cmd = chosen.picks[payload.index];
      if (cmd === undefined) {
        report(`step ${String(step)}: the payload draw left the picks`);
        return undefined;
      }
      return { kind: "cmd", cmd, from: "enumeration" };
    },
  );
}

/**
 * ONE DETERMINISTIC TRACE: the named commands in order, through the same loop.
 *
 * THIS IS THE MODEL'S OWN FALLBACK, and it is here for the model's own reason.
 * `chuggy_witness_test.qnt` exists under the no-arm-without-a-witness rule
 * because sampling cannot reach every shape that has to be reachable, and its
 * `do*` drivers are exactly this: a machine action with its nondet picks named,
 * its guard checked in the pre-state. A `Cmd` IS an action with its picks
 * named, so the script below is that driver with no translation.
 *
 * IT ALSO CHECKS THAT THE ENUMERATION OFFERED WHAT IT TOOK. A scripted command
 * that `cmdEnabled` admits and `availableActions` did not enumerate is an
 * enumeration that covers less of the payload space than it claims — the one
 * defect a random walk could never report, because a walk only ever takes what
 * the enumeration hands it.
 */
export function driveTrace(
  cfg: Config,
  instance: string,
  label: string,
  script: readonly Cmd[],
): RunResult {
  const run = runMachine(
    cfg,
    instance,
    label,
    script.length,
    (options, state, step, report) => {
      const cmd = script[step - 1];
      if (cmd === undefined) {
        report(`step ${String(step)}: the script ran out`);
        return undefined;
      }
      if (cmdEnabled(cfg, state.core, cmd) && !offered(options, cmd)) {
        report(
          `step ${String(step)}: ${showCmd(cmd)} is enabled here and the enumeration did not offer it`,
        );
      }
      return { kind: "cmd", cmd, from: "script" };
    },
  );
  return run.steps === script.length
    ? run
    : {
        ...run,
        findings: [
          ...run.findings,
          `${label}: the run took ${String(run.steps)} of the ${String(script.length)} scripted steps`,
        ],
      };
}

/**
 * Was this command among the ones the enumeration offered? Asked through the
 * printed form, which is total over `Cmd` and distinguishes every payload —
 * a structural equality would be a second definition of what makes two
 * decisions the same, and `Cmd` has no such definition to reuse.
 */
function offered(options: readonly Available[], cmd: Cmd): boolean {
  const wanted = showCmd(cmd);
  return options.some(
    (o) => o.kind === "cmd" && o.picks.some((p) => showCmd(p) === wanted),
  );
}

/**
 * The bundle, and the rosters, at the state a step just produced.
 *
 * The bundle asked here is the SHIPPED one — `invariantsHold`, a plain
 * short-circuiting conjunction — so what the walk checks is exactly what the
 * model's `--invariant=allInvariants` checks. The roster is consulted only to
 * describe a failure, and a bundle that goes red while the roster finds nothing
 * is itself reported: that pair disagreeing is a defect in the checking layer
 * rather than in the machine.
 *
 * NOTHING IN HERE MAY THROW PAST THIS FUNCTION, and that is the whole reason
 * the body is three guarded regions rather than four lines. Every call below
 * reaches `measure.ts`, whose helpers assert their preconditions liberally and
 * are RIGHT to — but a walker exists precisely to reach states nobody wrote a
 * precondition for, so an assertion firing here is this layer's most valuable
 * result, not its accident. Unguarded it escapes the run, escapes the module
 * scope the runs are built at, and takes every test in the file down with it
 * carrying no seed, no step and no command: the found-a-defect-and-threw-away-
 * the-only-copy failure this file's own header names. Guarded it is a finding
 * in the same shape as every other, and the eight probes go on reporting
 * independently.
 */
/**
 * `observe`'s findings for ONE state a caller supplies — the probe seam for its
 * three alarm regions.
 *
 * IT EXISTS BECAUSE THE ALARMS CANNOT FIRE FROM A WALK, and that is the same
 * shape `replay.test.ts` states for the replayer's bundle verdict: every state
 * a run reaches is a shipped decider's own output, so a correct roster and a
 * correct bundle are true over all of them. Two of the three regions were
 * therefore exercised by nothing at all — mute the unrostered-label report or
 * the bundle verdict and every walk in the tree stayed green. What can falsify
 * them is a state no decider produced, which a probe can build and a walk
 * cannot, so the seam is here rather than the claim being left as prose.
 *
 * It is a probe rather than a second observer: the body below is the one the
 * loop calls, with the accumulator and the step index a run would have
 * supplied.
 */
export function observeOnce(
  cfg: Config,
  state: MachineState,
): readonly string[] {
  const findings: string[] = [];
  observe(new CoverageBuilder(), cfg, state, 0, findings, "probe");
  return findings;
}

function observe(
  coverage: CoverageBuilder,
  cfg: Config,
  state: MachineState,
  step: number,
  findings: string[],
  where: string,
  taken = "init",
): void {
  const at = `${where} step ${String(step)} after ${taken}`;
  // A LABEL OUTSIDE THE REACHABLE ROSTER IS A FINDING, not an exception.
  // `stepLabel` throws on one, and it is right to — the decoder is reading a
  // trace it cannot place. Here the label came out of a decider this tree
  // shipped, so an unrostered one is this layer's own alarm to report: the
  // machine took a step whose label the corpus's roster does not know.
  try {
    coverage.observeLabel(stepLabel(state.lastStep, at));
  } catch (error) {
    // The message alone, and not `${at}: ` in front of it: `stepLabel` is
    // handed `at` and puts it at the head of what it throws, so prefixing here
    // printed the site twice. The other two regions below raise from functions
    // that name no site, which is why only this one is spelled this way.
    findings.push(messageOf(error));
    return;
  }
  // THE ARM ATTRIBUTION ASKS `stepDescends` TWICE, THROUGH `sysMeasure`, so
  // every account assertion in `measure.ts` is reachable from this one line.
  try {
    coverage.observeArm(cfg, state.core, state.lastStep);
  } catch (error) {
    findings.push(
      `${at}: the exemption arm could not be read: ${messageOf(error)}`,
    );
    return;
  }
  // THE BUNDLE, AND THE ROSTER THAT NAMES ITS FAILURE — one region, because a
  // state that makes the bundle throw makes the roster throw on the same
  // conjunct, and a reader wants the state named once. `measureNonNegative`'s
  // own header says this is how a negative account arrives: louder than the
  // model's `false`, as a thrown assertion.
  try {
    if (invariantsHold(cfg, state)) {
      return;
    }
    const red = [...redConjuncts({ cfg, core: state.core, history: state })];
    findings.push(
      `${at}: allInvariants is false; red conjuncts: ${red.length === 0 ? "none — the bundle and the roster disagree" : red.join(", ")}`,
    );
  } catch (error) {
    findings.push(`${at}: allInvariants threw: ${messageOf(error)}`);
  }
}

// === Reporting =============================================================

/** A move as one line: the stutter has no payload, a decision is its command. */
function showMove(move: Move): string {
  return move.kind === "settle" ? "settle" : showCmd(move.cmd);
}

/**
 * A command as one line, in a CANONICAL form: its one set spelled as the ids it
 * holds in ascending order, and its remaining fields in a fixed key order.
 *
 * BOTH ORDERINGS ARE LOAD-BEARING, not cosmetic. `offered` compares two
 * commands by this string, so anything about it that depended on how the record
 * was BUILT rather than on what it SAYS would make two equal decisions read as
 * different ones — and the enumeration builds its commands here while a
 * deterministic script builds its own by hand. A set iterates in insertion
 * order and an object's own keys enumerate in declaration order; sorting closes
 * both, and the whole reason a printed form is the comparison at all is that
 * `Cmd` ships no structural equality to reuse.
 */
export function showCmd(cmd: Cmd): string {
  if (cmd.tag === "JArrive") {
    return `JArrive deps={${[...cmd.deps].sort((a, b) => a - b).join(",")}} program=${cmd.program.map((s) => `${String(s.fanout)}${s.combinator}`).join("/")} project=${String(cmd.project)} wrapUp=${cmd.wrapUp.tag === "WNone" ? "WNone" : `WExclusive(${String(cmd.wrapUp.resource)})`}`;
  }
  const rest = Object.entries(cmd)
    .filter(([key]) => key !== "tag")
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `${cmd.tag} ${rest}`;
}

/** A seed as the model's own `--seed` spelling. */
export function hex(seed: number): string {
  return `0x${(seed >>> 0).toString(16)}`;
}
