/**
 * `model/domain.qnt`'s STATE-AND-ACTIONS section in TypeScript: the four vars
 * as one record, the derived reads over them (`currentMeasure`,
 * `currentRecords`, `quiet`), `init`, `apply`, the machine step, and the
 * `settle` stutter.
 *
 * `domain.ts`'s header names this file's contents by exclusion — "the model's
 * state-and-actions section (the four vars, `init`, the thirteen actions,
 * `installCore`) is the machine's rather than a decider's — its TypeScript home
 * is the spine, s3". The thirteen actions are `cmd.ts`'s `Cmd` plus
 * `cmdEnabled` plus `stepWith` below: an action is its guard, its draws and its
 * decider, and TypeScript splits those three where Quint writes them as one.
 *
 * `installCore` WAS THE ONE PART DELIBERATELY LEFT FOR s5, and s5 is what
 * landed it. It is the refinement-layer seam — the model's own comment says so,
 * and says it is not in `step`'s roster because the domain machine cannot reach
 * it — so it had no caller until there was an executor cursor and a crash to
 * install a replay across. Its callers are now `actor.ts`'s `emitNext`,
 * `crashRecoverTo` and `effectCrash`, which is exactly the roster the model
 * gives it.
 *
 * THE STATE IS ONE RECORD BECAUSE THE INVARIANTS ALREADY ASK FOR IT THAT WAY.
 * `invariants.ts` takes a `Core` plus a `StepHistory` of exactly `lastStep`,
 * `prevMeasure` and `prevRecords` — the model's step-history vars — so a
 * machine state is a `Core` beside that record and the bundle reads it
 * directly. Quint's vars are separate declarations; nothing turns on which
 * side of that line the grouping falls.
 */

import { invariant } from "../domain/assert.ts";
import {
  boundsOf,
  canArriveIn,
  configAdmitsInit,
  type Config,
} from "../domain/domain.ts";
import { allInvariants, type StepHistory } from "../domain/invariants.ts";
import {
  sysMeasure,
  type Core,
  type Decision,
  type StepRecord,
  type Task,
} from "../domain/measure.ts";
import { cmdEnabled, execCmd, type Cmd } from "./cmd.ts";

/**
 * `model/domain.qnt`'s four vars: the fleet, the last decision's record, and
 * the two step-history ghosts.
 */
export type MachineState = { readonly core: Core } & StepHistory;

/** `model/domain.qnt` init's `lastStep'` — the record no decision produced. */
export const initStepRecord: StepRecord = {
  label: "init",
  transitions: [],
  effects: [],
  landing: { tag: "WONone" },
};

/** `model/domain.qnt` settle's `lastStep'` — the dead-end stutter's record. */
export const settledStepRecord: StepRecord = {
  label: "settled",
  transitions: [],
  effects: [],
  landing: { tag: "WONone" },
};

/** `model/domain.qnt` currentMeasure — `sysMeasure` at this instance's bounds. */
export function currentMeasure(cfg: Config, c: Core): number {
  return sysMeasure(boundsOf(cfg), c.tickets);
}

/**
 * `model/domain.qnt` currentRecords — the retained-record snapshot the ghost
 * carries forward, per ticket.
 */
export function currentRecords(c: Core): ReadonlyMap<number, readonly Task[]> {
  const snapshot = new Map<number, readonly Task[]>();
  for (const [j, jb] of c.tickets) {
    snapshot.set(j, jb.record);
  }
  return snapshot;
}

/**
 * `model/domain.qnt` quiet — no machine, operator or author action can move
 * anything: the fleet is fully arrived and every ticket is settled in a
 * terminal.
 *
 * IT IS THE `settle` GUARD, and the reason this file states it rather than
 * deriving exemption from the label: a `settled` step in a golden trace is a
 * claim that the machine had reached its one dead end, and replaying the step
 * without asking that question would accept a trace where it had not.
 */
export function quiet(cfg: Config, c: Core): boolean {
  // The model writes `not(canArrive)` — a REFERENCE to the arrival bound, not a
  // restatement of it. This predicate guards every settled step, so a second
  // spelling of that bound would be the copied guard `domain.ts` forbids, in
  // one of the few places a golden trace could not catch the drift.
  if (canArriveIn(cfg, c)) {
    return false;
  }
  for (const jb of c.tickets.values()) {
    if (jb.phase !== "PDone" && jb.phase !== "PRevoked") {
      return false;
    }
  }
  return true;
}

/**
 * `model/domain.qnt` init — the fleet starts EMPTY, the ghosts start at the
 * model's own bases.
 *
 * The model's validity conjuncts are `configAdmitsInit`'s, asked here as the
 * assertion `domain.ts` argues for at `freshTicket`: a configuration failing
 * one has no initial state, so the machine it describes does not exist, and
 * returning a state for it would be inventing one.
 */
export function initialState(cfg: Config): MachineState {
  invariant(
    configAdmitsInit(cfg),
    "initialState: this configuration admits no initial state",
  );
  return {
    core: { tickets: new Map() },
    lastStep: initStepRecord,
    prevMeasure: 0,
    prevRecords: new Map(),
  };
}

/**
 * `model/domain.qnt` apply — install a decision's post-state, record its step,
 * and snapshot BOTH ghosts from the state being left.
 *
 * The two ghosts read the PRE-state, which is the whole of what makes them
 * history: `prevMeasure'` is the measure of the state this step departs from,
 * so `stepDescends` compares the arriving measure against it, and
 * `prevRecords'` is that state's retained records, so `recordMonotone` compares
 * the arriving records against them.
 */
export function applyDecision(
  cfg: Config,
  state: MachineState,
  d: Decision,
): MachineState {
  return {
    core: d.post,
    lastStep: d.rec,
    prevMeasure: currentMeasure(cfg, state.core),
    prevRecords: currentRecords(state.core),
  };
}

/**
 * `model/domain.qnt` installCore — THE REFINEMENT-LAYER SEAM: install an
 * externally reconstructed `Core` WITHOUT taking a domain step.
 *
 * BOTH GHOSTS STAY STALE, and that is the whole of what distinguishes this from
 * `applyDecision`. The refinement layer's executor and crash actions are not
 * domain steps — the domain trace has no row for them — so `prevMeasure` and
 * `prevRecords` go on describing the last real decision, which keeps every
 * ghost-reading invariant's verdict byte-identical across the refinement-layer
 * step. Snapshotting them here would present a crash as a flat domain step and
 * make `stepDescends` compare a measure against itself, which is the shape that
 * is true forever and falsifiable never.
 *
 * `lastStep` ARRIVES AS AN ARGUMENT rather than being kept, because the model
 * passes it: every call site in `model/refinement.qnt` passes the CURRENT
 * `lastStep`, so the record does not move either — but the seam is written as
 * the model writes it, since a seam that decided for itself which record to
 * keep would be a second spelling of the caller's intent.
 *
 * THE DOMAIN MACHINE CANNOT REACH THIS. It is not in `step`'s roster in the
 * model and it is not called by `stepWith` or `settle` here; only the
 * refinement layer calls it, and only with a replay of its own journal.
 */
export function installCore(
  state: MachineState,
  c: Core,
  rec: StepRecord,
): MachineState {
  return {
    core: c,
    lastStep: rec,
    prevMeasure: state.prevMeasure,
    prevRecords: state.prevRecords,
  };
}

/**
 * One machine step at a named decision: the model's thirteen actions, with the
 * nondet draw supplied as data.
 *
 * The guard is checked BEFORE the decider runs, which is `journalLegalOn`'s
 * discipline and for its stated reason: the deciders assume their guards, so
 * running one on a state that refuses it is a lookup error rather than a
 * boolean. A refused command is refused, never crashed on.
 */
export function stepWith(
  cfg: Config,
  state: MachineState,
  cmd: Cmd,
): MachineState | undefined {
  if (!cmdEnabled(cfg, state.core, cmd)) {
    return undefined;
  }
  return applyDecision(cfg, state, execCmd(cfg, state.core, cmd));
}

/**
 * `model/domain.qnt` settle — the dead-end stutter. The fleet does not move;
 * the record becomes the settled noop; BOTH ghosts advance, exactly as they do
 * on a real step, because `settle` IS a step of the domain machine (it is in
 * `step`'s roster) even though no decider produced it.
 *
 * Refused when the machine is not quiet, for `quiet`'s stated reason.
 */
export function settle(
  cfg: Config,
  state: MachineState,
): MachineState | undefined {
  if (!quiet(cfg, state.core)) {
    return undefined;
  }
  return {
    core: state.core,
    lastStep: settledStepRecord,
    prevMeasure: currentMeasure(cfg, state.core),
    prevRecords: currentRecords(state.core),
  };
}

/**
 * The domain bundle at a machine state — every conjunct of `allInvariants`,
 * over the state's own `Core` and its own step history.
 *
 * A one-line adapter, and it earns its place by being the only spelling of the
 * pairing: the replayer asserts the bundle after every replayed step, the
 * randomized walker after every walk step, and the crash-seam and interpreter
 * suites at every state they observe — and all of them must ask it of the same
 * three history values the step just wrote.
 */
export function invariantsHold(cfg: Config, state: MachineState): boolean {
  return allInvariants(cfg, state.core, state);
}
