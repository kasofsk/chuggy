/**
 * The driver: it owns the actor state and serializes every submission through
 * one promise chain, which makes the single writer structural inside the
 * process the way the store's key makes it structural outside it.
 *
 * A SUBMISSION IS ANSWERED, NEVER ASSUMED. `Accepted` resolves only after
 * `decide` resolved, and `decide` returns only after the store's append is
 * durable — journal-before-ack is the composition of those two facts, not a
 * convention. A submission enablement refuses is answered `Dropped` with the
 * reason: a drop is an answer, and the world's delivery duty ends with it.
 *
 * AFTER EVERY ACCEPTED DECISION THE DRIVE PUMPS: drain, then the actor's own
 * follow-ups from `followUpsIn`, each decided and drained through the same
 * chain until none are enabled. The fixpoint needs no counter — every
 * follow-up descends the measure, and each iteration asserts its own descent
 * so a command that stopped descending is an error rather than a loop.
 *
 * THE ONE DEFERRAL IS INJECTED. A failed pump leaves a durable decision whose
 * effects the world has not heard, so the pump is retried through `wakeAfter`
 * down an explicit delay ladder; the ladder's end re-raises the failure
 * through the timer, where the composition root lets it end the process and
 * boot re-drives. The layer itself names no clock and no timer, which is what
 * keeps it under the same ambient ban as the interpreter.
 *
 * THE READ IS BESIDE THE FACE BECAUSE THE STATE IS HERE. The drive owns the
 * actor state, so a face that rendered the machine from its own copy would
 * render a stale one, and a face that replayed the journal itself would be a
 * second reader of the single writer's book. `core` hands back the state the
 * chain has reached and nothing else: it takes no argument, decides nothing,
 * and cannot advance the machine.
 */

import {
  cmdEnabled,
  jArrive,
  jGateResolve,
  jOpRetry,
  jRelease,
  jRevoke,
  jTaskDone,
  type Cmd,
} from "../actor/command.ts";
import { memoryCore, type ActorState } from "../actor/state.ts";
import { boundsOf } from "../domain/config.ts";
import type { Core } from "../domain/core.ts";
import { sysMeasure } from "../domain/measure.ts";
import { decide, drain, type Executor } from "../interpreter/executor.ts";
import type { Inbound, Submitted } from "../interpreter/inbound.ts";
import { followUpsIn } from "./followUps.ts";

/** The one capability the runtime is granted: run `wake` after the delay, off this layer's stack. */
export type WakeAfter = (delayMs: number, wake: () => Promise<void>) => void;

/** What the drive hands out: the inbound face, and the pure read of the state it holds. */
export interface Drive extends Inbound {
  readonly core: () => Core;
}

/** The pump's retry ladder; running off its end re-raises the failure through the timer. */
export const driveDrainRetryDelaysMs: readonly number[] = [100, 1000, 10000];

/** What the drive owns: the actor state, the chain every submission joins, and the ladder's position. */
interface DriveState {
  actor: ActorState;
  chain: Promise<void>;
  drainFailures: number;
}

const driveNothing = (): void => undefined;

/** Runs `job` after every earlier submission, keeping the chain alive past a failure the job's caller owns. */
function driveSerialize<T>(own: DriveState, job: () => Promise<T>): Promise<T> {
  const outcome = own.chain.then(job);
  own.chain = outcome.then(driveNothing, driveNothing);
  return outcome;
}

/** Drain, then decide and drain each enabled follow-up to the fixpoint, asserting descent per iteration. */
async function drivePump(executor: Executor, own: DriveState): Promise<void> {
  const bounds = boundsOf(executor.config);
  own.actor = await drain(executor, own.actor);
  for (;;) {
    const cmd = followUpsIn(memoryCore(own.actor)).at(0);
    if (cmd === undefined) return;
    const before = sysMeasure(bounds, memoryCore(own.actor));
    own.actor = await decide(executor, own.actor, cmd);
    own.actor = await drain(executor, own.actor);
    const after = sysMeasure(bounds, memoryCore(own.actor));
    if (after >= before) {
      throw new Error(
        `drive: follow-up ${cmd.cmd} left the measure at ${String(after)} from ${String(before)}; an internal command must descend`,
      );
    }
  }
}

/** The pump behind its retry ladder: a failure books a later attempt, and the ladder's end surfaces it. */
async function drivePumpGuarded(
  executor: Executor,
  wakeAfter: WakeAfter,
  own: DriveState,
): Promise<void> {
  try {
    await drivePump(executor, own);
    own.drainFailures = 0;
  } catch (failure) {
    own.drainFailures += 1;
    const delayMs = driveDrainRetryDelaysMs.at(own.drainFailures - 1);
    if (delayMs === undefined) {
      wakeAfter(0, () => Promise.reject(driveFailureAsError(failure)));
      return;
    }
    wakeAfter(delayMs, () =>
      driveSerialize(own, () => drivePumpGuarded(executor, wakeAfter, own)),
    );
  }
}

function driveFailureAsError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** One submission: refused cleanly, or journaled, pumped and answered with its own sequence number. */
function driveSubmit(
  executor: Executor,
  wakeAfter: WakeAfter,
  own: DriveState,
  cmd: Cmd,
): Promise<Submitted> {
  return driveSerialize(own, async () => {
    if (!cmdEnabled(executor.config, memoryCore(own.actor), cmd)) {
      return {
        submitted: "Dropped",
        why: `${cmd.cmd} is not a decision the machine takes at this fleet`,
      };
    }
    own.actor = await decide(executor, own.actor, cmd);
    const seq = own.actor.journal.length;
    await drivePumpGuarded(executor, wakeAfter, own);
    return { submitted: "Accepted", seq };
  });
}

/**
 * The inbound face over the handed state, which the drive owns from here on.
 * Construction books one pump, so a state recovered mid-follow-up is driven
 * to its fixpoint before the first submission rather than on it.
 */
export function drive(
  executor: Executor,
  wakeAfter: WakeAfter,
  booted: ActorState,
): Drive {
  const own: DriveState = {
    actor: booted,
    chain: Promise.resolve(),
    drainFailures: 0,
  };
  const submit = (cmd: Cmd): Promise<Submitted> =>
    driveSubmit(executor, wakeAfter, own, cmd);
  void driveSerialize(own, () => drivePumpGuarded(executor, wakeAfter, own));
  return {
    core: () => memoryCore(own.actor),
    arrive: (deps, program, project, wrapUp) =>
      submit(jArrive(deps, program, project, wrapUp)),
    release: (ticket) => submit(jRelease(ticket)),
    revoke: (ticket) => submit(jRevoke(ticket)),
    opRetry: (ticket) => submit(jOpRetry(ticket)),
    taskDone: (ticket, taskId, verdict) =>
      submit(jTaskDone(ticket, taskId, verdict)),
    gateOutcome: (ticket, outcome) => submit(jGateResolve(ticket, outcome)),
  };
}
