/**
 * Telemetry is not an authority, proved where the claim actually lives: in the
 * types, and in what the scheduler's sources do with the sink.
 *
 * THE TYPE-LEVEL CASES ARE THE STRUCTURAL HALF. Each one asserts an
 * assignability that the compiler decides, so it is `tsc` and not this runner
 * that fails when the seal is dropped from `SchedulerTelemetry` or an
 * observation is given something to answer with. Written as a runtime
 * assertion the same claim would only be a description of the day it was
 * written.
 *
 * THE SOURCE-READ CASE IS THE OTHER HALF OF "FULL SURFACE". A declared
 * observation nothing emits is exactly the defect this slice inherited, and it
 * is invisible to every case that drives behaviour, because the sink that is
 * never called is the one nobody notices.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recordScheduler,
  schedulerTelemetry,
  silentExecutionSchedulerMetrics,
  silentSchedulerTelemetry,
  type ExecutionSchedulerMetrics,
  type SchedulerTelemetry,
} from "../../src/interpreter/executionScheduler.ts";
import {
  allSchedulerObservations,
  recordingMetrics,
  throwingMetrics,
} from "./schedulerSinks.ts";
import { telemetryEmitted } from "./telemetrySinks.ts";

/** Whether the compiler will let the first type stand where the second is wanted. */
type Assignable<A, B> = [A] extends [B] ? true : false;

/** What each declared observation answers, which is what a branch could read. */
type Answers = {
  [Name in keyof ExecutionSchedulerMetrics]: ReturnType<
    ExecutionSchedulerMetrics[Name]
  >;
};

test("a bare sink cannot stand where the scheduler wants telemetry", () => {
  const bareIsNotTelemetry: Assignable<
    ExecutionSchedulerMetrics,
    SchedulerTelemetry
  > = false;
  const sealedIsTelemetry: Assignable<
    ReturnType<typeof schedulerTelemetry>,
    SchedulerTelemetry
  > = true;
  assert.equal(bareIsNotTelemetry, false);
  assert.equal(sealedIsTelemetry, true);
});

test("recording an observation answers nothing a branch could read", () => {
  const answersNothing: Assignable<
    ReturnType<typeof recordScheduler>,
    void
  > = true;
  const answersNoValue: Assignable<
    ReturnType<typeof recordScheduler>,
    boolean
  > = false;
  assert.equal(answersNothing, true);
  assert.equal(answersNoValue, false);
});

test("every declared observation answers nothing, so none of them can be read", () => {
  const everyAnswerIsNothing: Assignable<Answers[keyof Answers], void> = true;
  const noAnswerIsAValue: Assignable<Answers[keyof Answers], boolean> = false;
  assert.equal(everyAnswerIsNothing, true);
  assert.equal(noAnswerIsAValue, false);
});

test("a failing observation is not raised at the move that made it", () => {
  const thrown: string[] = [];
  const telemetry = schedulerTelemetry(throwingMetrics(thrown));
  recordScheduler(telemetry, (metrics) => {
    metrics.reaping(1);
  });
  assert.deepEqual(thrown, ["reaping"]);
});

test("a failing observation abandons the rest of its own block and nothing else", () => {
  const seen: string[] = [];
  const thrown: string[] = [];
  const telemetry = schedulerTelemetry({
    ...recordingMetrics(seen),
    reaping: () => {
      thrown.push("reaping");
      throw new Error("telemetry reaping failed");
    },
  });
  recordScheduler(telemetry, (metrics) => {
    metrics.reaping(1);
    metrics.fencing("Epoch", 2);
  });
  recordScheduler(telemetry, (metrics) => {
    metrics.fencing("Cancellation", 3);
  });
  assert.deepEqual(thrown, ["reaping"]);
  assert.deepEqual(seen, ["fencing:Cancellation:3"]);
});

test("the sink a caller supplies no telemetry for accepts every observation", () => {
  for (const name of allSchedulerObservations) {
    assert.equal(
      typeof silentExecutionSchedulerMetrics[
        name as keyof ExecutionSchedulerMetrics
      ],
      "function",
      `${name} has no silent arm`,
    );
  }
  recordScheduler(silentSchedulerTelemetry, (metrics) => {
    metrics.incident("ImpossibleState");
  });
});

test("every observation the scheduler declares is emitted by something", () => {
  const emitted = telemetryEmitted("recordScheduler");
  assert.ok(emitted.size > 0, "no call site was read, so this proves nothing");
  assert.deepEqual(
    allSchedulerObservations.filter((name) => !emitted.has(name)),
    [],
  );
});
