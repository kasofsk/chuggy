/**
 * The two telemetry sinks every scheduler case in this directory is driven
 * with: one that keeps what it was told and one that fails at everything.
 *
 * BOTH ARE BUILT FROM THE ROSTER RATHER THAN FROM A LIST OF NAMES. The silent
 * sink names every observation the scheduler declares, so reading its keys is
 * how these cover the whole surface — an observation added later is recorded,
 * and failed, without this file being edited. A hand-written sink would pass
 * the day the surface grew and prove one method less every time after.
 */

import {
  silentExecutionSchedulerMetrics,
  type ExecutionSchedulerMetrics,
} from "../../src/interpreter/executionScheduler.ts";

/** Every observation the scheduler declares, read off the sink that ignores them all. */
export const allSchedulerObservations: readonly string[] = Object.keys(
  silentExecutionSchedulerMetrics,
).sort();

/** What a sink is handed, which is a label or a count and never a payload. */
type Observed = string | number | undefined;

/** One sink built by giving every declared observation the same body. */
function sinkOf(
  body: (name: string) => (...args: Observed[]) => void,
): ExecutionSchedulerMetrics {
  return Object.fromEntries(
    allSchedulerObservations.map((name) => [name, body(name)]),
  ) as unknown as ExecutionSchedulerMetrics;
}

/** A sink that keeps what it was told, spelled so a case can assert the sequence. */
export function recordingMetrics(seen: string[]): ExecutionSchedulerMetrics {
  return sinkOf((name) => (...args) => {
    seen.push([name, ...args.filter((arg) => arg !== undefined)].join(":"));
  });
}

/** A sink that fails at every observation, which is the loudest one can be. */
export function throwingMetrics(thrown: string[]): ExecutionSchedulerMetrics {
  return sinkOf((name) => () => {
    thrown.push(name);
    throw new Error(`telemetry ${name} failed`);
  });
}
