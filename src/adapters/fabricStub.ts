/**
 * The fabric, as a stub: it records the task fan-outs it was asked to run and
 * runs nothing.
 *
 * Recording is the whole of it: the fabric runs work and decides nothing, so a
 * stub that records is a fabric missing only its compute. A launched set is
 * keyed by `emissionKey`, because a second delivery of one decision's fan-out
 * must not be a second fan-out; that is the assumption the model prices its
 * no-double-spend obligation against.
 */

import {
  emissionKey,
  type Emission,
  type FabricPort,
} from "../interpreter/ports.ts";

/** What kind of task set a launch was for, at the grain the fabric is asked in. */
export type FabricSet = "Work" | "Eval" | "Cancel";

/** One launch: which set, and the decision and ticket it belongs to. */
export interface FabricLaunch {
  readonly set: FabricSet;
  readonly emission: Emission;
}

/** The fabric with both readings exposed: what is running, and what it was asked for. */
export interface FabricStub extends FabricPort {
  readonly running: ReadonlyMap<string, FabricLaunch>;
  readonly requests: readonly FabricLaunch[];
}

/** A fresh fabric: nothing running, and nothing asked of it yet. */
export function fabricStub(): FabricStub {
  const running = new Map<string, FabricLaunch>();
  const requests: FabricLaunch[] = [];
  const launch = (set: FabricSet, emission: Emission): Promise<void> => {
    const asked: FabricLaunch = { set, emission };
    requests.push(asked);
    running.set(emissionKey(emission), asked);
    return Promise.resolve();
  };
  return {
    running,
    requests,
    spawnWorkTasks: (emission: Emission) => launch("Work", emission),
    spawnEvalTasks: (emission: Emission) => launch("Eval", emission),
    cancelTicketWork: (emission: Emission) => launch("Cancel", emission),
  };
}
