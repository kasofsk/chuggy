/**
 * A finalizer that records what it was asked to run and runs nothing.
 *
 * It is its own adapter rather than a member of the fabric stub because the
 * port it answers is its own: the finalizer is the one side of the world that
 * can reach a point of no return, and a suite that wants to see a finalization
 * requested should not have to read it out of the same log as a task launch.
 */

import {
  emissionKey,
  type Emission,
  type FinalizerPort,
} from "../interpreter/ports.ts";

/** One run: the decision and ticket it belongs to. */
export interface FinalizerRun {
  readonly emission: Emission;
}

/** The finalizer with both readings exposed: what is in flight, and what was asked for. */
export interface FinalizerStub extends FinalizerPort {
  readonly inFlight: ReadonlyMap<string, FinalizerRun>;
  readonly requests: readonly FinalizerRun[];
}

/** A fresh finalizer: nothing in flight, and nothing asked of it yet. */
export function finalizerStub(): FinalizerStub {
  const inFlight = new Map<string, FinalizerRun>();
  const requests: FinalizerRun[] = [];
  return {
    inFlight,
    requests,
    runFinalizer: (emission: Emission) => {
      const asked: FinalizerRun = { emission };
      requests.push(asked);
      inFlight.set(emissionKey(emission), asked);
      return Promise.resolve();
    },
  };
}
