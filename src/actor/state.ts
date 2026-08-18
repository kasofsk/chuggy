/**
 * The journaled actor as a pure machine: its state, and the step per seam —
 * decide-and-journal, emit, crash-and-recover, and the effect-first hazard the
 * discipline forbids.
 *
 * THE CARRIED VIEW IS THE CARRY RULE. `view.post` is the actor's in-memory
 * state; `view.pre` and `view.rec` are the state before the last domain
 * decision and that decision's record, which is what every domain invariant is
 * evaluated against. Only `journalStep` advances the pair — the executor and
 * crash steps are not domain steps, so they carry `(pre, rec)` unchanged, the
 * same stale-ghost arrangement `installCore` states in `model/domain.qnt` and
 * `src/domain/invariants.ts` explains: re-snapshotting on an emit would
 * compare the measure against itself and falsely report `stepDescends` broken
 * on a step the model proves harmless.
 *
 * THE DISCIPLINE IS THE DELTA BETWEEN TWO STEP RELATIONS. The disciplined
 * machine is `journalStep`, `emitNext` and `crashRecoverTo`; the hazard
 * machine is those plus `effectCrash`, the one seam an effect-first
 * implementation admits. Every action here is a deterministic function of the
 * state and its named picks, which is what makes crashing at every observable
 * seam exhaustive rather than a scheduling problem — the reason this slice is
 * pure and the single impure loop belongs to the interpreter's layer.
 *
 * Each step's guard is checked here and violation throws: the actor
 * structurally cannot journal a refused decision, and a driver that asks for
 * an impossible step has left the machine's step relation entirely.
 */

import type { Config } from "../domain/config.ts";
import {
  initRecord,
  type Core,
  type Decision,
  type StepRecord,
} from "../domain/core.ts";
import type { StepView } from "../domain/invariants.ts";
import {
  decisionEventEnabled,
  execDecisionEvent,
  type DecisionEvent,
} from "./decisionEvent.ts";
import { genesis, replayCore, type Entry } from "./journal.ts";

/** The actor's whole state: the carried view, the journal, the executor cursor, and the world's ledger. */
export interface ActorState {
  readonly view: StepView;
  readonly journal: readonly Entry[];
  readonly applied: number;
  readonly worldEffects: ReadonlySet<number>;
  readonly orphans: readonly StepRecord[];
}

/** The actor's in-memory domain state, which is the carried view's post. */
export function memoryCore(state: ActorState): Core {
  return state.view.post;
}

/** The initial state: an empty fleet, an empty journal, a world that has received nothing. */
export function actorInit(): ActorState {
  return {
    view: { pre: genesis, rec: initRecord, post: genesis },
    journal: [],
    applied: 0,
    worldEffects: new Set(),
    orphans: [],
  };
}

/** The refused-decision guard both decision-bearing steps share. */
function decideEnabled(
  config: Config,
  state: ActorState,
  event: DecisionEvent,
  step: string,
): Decision {
  if (!decisionEventEnabled(config, memoryCore(state), event)) {
    throw new Error(
      `${step}: ${event.event} is refused at this state; the actor journals no decision the machine would not take`,
    );
  }
  return execDecisionEvent(config, memoryCore(state), event);
}

/**
 * The actor's step: decide and journal, atomically — the decide-to-journal
 * seam is unobservable, so there is no action between them to crash in. No
 * emission happens here; the executor cursor lags, which is the
 * journal-then-effect discipline itself.
 */
export function journalStep(
  config: Config,
  state: ActorState,
  event: DecisionEvent,
): ActorState {
  const decision = decideEnabled(config, state, event, "journalStep");
  const entry: Entry = {
    seq: state.journal.length + 1,
    event,
    rec: decision.rec,
  };
  return {
    view: { pre: memoryCore(state), rec: decision.rec, post: decision.post },
    journal: [...state.journal, entry],
    applied: state.applied,
    worldEffects: state.worldEffects,
    orphans: state.orphans,
  };
}

/**
 * The executor: emit the next unemitted entry's effects toward the world. The
 * received set is keyed by the decision's seq, so a re-emission after cursor
 * loss is absorbed — the world cannot be made to act twice on one decision.
 */
export function emitNext(state: ActorState): ActorState {
  if (state.applied >= state.journal.length) {
    throw new Error(
      "emitNext: every journaled decision is already emitted; the cursor has nothing to advance onto",
    );
  }
  const seq = state.applied + 1;
  return {
    ...state,
    applied: seq,
    worldEffects: new Set([...state.worldEffects, seq]),
  };
}

/**
 * Crash and recover with the cursor regressed to `cursor`: memory becomes the
 * genuine replay of the journal, and the lost cursor suffix will re-emit. The
 * carried `(pre, rec)` does not move — recovery is not a domain decision.
 */
export function crashRecoverTo(
  config: Config,
  state: ActorState,
  cursor: number,
): ActorState {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > state.applied) {
    throw new Error(
      `crashRecoverTo: ${String(cursor)} is not a checkpoint this run could have written`,
    );
  }
  return {
    ...state,
    view: { ...state.view, post: replayCore(config, state.journal) },
    applied: cursor,
  };
}

/**
 * The hazard seam: decide, emit toward the world, die before the journal
 * write. The world keeps the record as an un-keyed orphan, recovery replays a
 * journal that never saw the decision, and the actor will legitimately
 * re-decide — which is the double-spend the discipline exists to forbid.
 */
export function effectCrash(
  config: Config,
  state: ActorState,
  event: DecisionEvent,
): ActorState {
  const decision = decideEnabled(config, state, event, "effectCrash");
  return {
    ...state,
    view: { ...state.view, post: replayCore(config, state.journal) },
    orphans: [...state.orphans, decision.rec],
  };
}
