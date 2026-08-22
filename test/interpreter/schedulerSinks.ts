/**
 * The scheduler's roster and the two sinks its cases are driven with, both
 * built from `./telemetrySinks.ts` so that this file names a service and not a
 * construction.
 */

import {
  silentExecutionSchedulerMetrics,
  type ExecutionSchedulerMetrics,
} from "../../src/interpreter/executionScheduler.ts";
import {
  telemetryObservations,
  telemetryRecording,
  telemetryThrowing,
} from "./telemetrySinks.ts";

/** Every observation the scheduler declares, read off the sink that ignores them all. */
export const allSchedulerObservations: readonly string[] =
  telemetryObservations(silentExecutionSchedulerMetrics);

/** A sink that keeps what it was told, spelled so a case can assert the sequence. */
export function recordingMetrics(seen: string[]): ExecutionSchedulerMetrics {
  return telemetryRecording(allSchedulerObservations, seen);
}

/** A sink that fails at every observation, which is the loudest one can be. */
export function throwingMetrics(thrown: string[]): ExecutionSchedulerMetrics {
  return telemetryThrowing(allSchedulerObservations, thrown);
}
