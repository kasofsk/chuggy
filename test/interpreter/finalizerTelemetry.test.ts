/**
 * Telemetry is not an authority, proved where the claim lives: in the types,
 * and in what the finalizer's own sources do with the sink.
 *
 * THE TYPE-LEVEL CASES ARE THE STRUCTURAL HALF. Each asserts an assignability
 * the compiler decides, so `tsc` and not this runner is what fails when the
 * seal is dropped or an observation is given something to answer with.
 *
 * THE SOURCE-READ CASE IS THE OTHER HALF. A declared observation nothing emits
 * is invisible to every case that drives behaviour, because a sink that is
 * never called is the one nobody notices.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  finalizerHoldLog,
  finalizerTelemetry,
  recordFinalizer,
  silentFinalizerMetrics,
  silentFinalizerTelemetry,
  type FinalizerHoldReason,
  type FinalizerMetrics,
  type FinalizerTelemetry,
} from "../../src/interpreter/finalizerTelemetry.ts";
import {
  telemetryEmitted,
  telemetryObservations,
  telemetryRecording,
  telemetryThrowing,
} from "./telemetrySinks.ts";

/** Every observation the finalizer declares, read off the sink that ignores them all. */
const declared: readonly string[] = telemetryObservations(
  silentFinalizerMetrics,
);

/** Whether the compiler will let the first type stand where the second is wanted. */
type Admits<Offered, Wanted> = [Offered] extends [Wanted] ? true : false;

/** What each declared observation answers, which is what a branch could read. */
type Answered = {
  [Named in keyof FinalizerMetrics]: ReturnType<FinalizerMetrics[Named]>;
};

test("a bare sink cannot stand where the finalizer wants telemetry", () => {
  const bareIsRefused: Admits<FinalizerMetrics, FinalizerTelemetry> = false;
  const sealedIsAdmitted: Admits<
    ReturnType<typeof finalizerTelemetry>,
    FinalizerTelemetry
  > = true;
  assert.equal(bareIsRefused, false);
  assert.equal(sealedIsAdmitted, true);
});

test("recording one observation answers nothing a branch could read", () => {
  const nothingIsAnswered: Admits<
    ReturnType<typeof recordFinalizer>,
    void
  > = true;
  const noValueIsAnswered: Admits<
    ReturnType<typeof recordFinalizer>,
    boolean
  > = false;
  assert.equal(nothingIsAnswered, true);
  assert.equal(noValueIsAnswered, false);
});

test("every declared observation answers nothing, so none of them can be read", () => {
  const allAnswerNothing: Admits<Answered[keyof Answered], void> = true;
  const noneAnswersAValue: Admits<Answered[keyof Answered], boolean> = false;
  assert.equal(allAnswerNothing, true);
  assert.equal(noneAnswersAValue, false);
});

test("a failing observation is not raised at the move that made it", () => {
  const thrown: string[] = [];
  const sealed = finalizerTelemetry(
    telemetryThrowing<FinalizerMetrics>(declared, thrown),
  );
  recordFinalizer(sealed, (metrics) => {
    metrics.holding("PermitRefused");
  });
  assert.deepEqual(thrown, ["holding"]);
});

test("a failing observation abandons its own block and no later one", () => {
  const seen: string[] = [];
  const thrown: string[] = [];
  const sealed = finalizerTelemetry({
    ...telemetryRecording<FinalizerMetrics>(declared, seen),
    permit: () => {
      thrown.push("permit");
      throw new Error("telemetry permit failed");
    },
  });
  recordFinalizer(sealed, (metrics) => {
    metrics.permit("Granted");
    metrics.promotion("Advanced");
  });
  recordFinalizer(sealed, (metrics) => {
    metrics.promotion("Ambiguous");
  });
  assert.deepEqual(thrown, ["permit"]);
  assert.deepEqual(seen, ["promotion:Ambiguous"]);
});

test("the sink a caller supplies no telemetry for accepts every observation", () => {
  for (const named of declared) {
    assert.equal(
      typeof silentFinalizerMetrics[named as keyof FinalizerMetrics],
      "function",
      `${named} has no silent arm`,
    );
  }
  recordFinalizer(silentFinalizerTelemetry, (metrics) => {
    metrics.holding("ReconciliationUnrecorded");
  });
});

test("every observation the finalizer declares is emitted by something", () => {
  const emitted = telemetryEmitted("recordFinalizer");
  assert.ok(emitted.size > 0, "no call site was read, so this proves nothing");
  assert.deepEqual(
    declared.filter((named) => !emitted.has(named)),
    [],
  );
});

/** What a hold log wrote, each line with its newline taken off. */
function holdLogLines(
  requestsMax?: number,
): readonly [FinalizerTelemetry, string[]] {
  const lines: string[] = [];
  const sealed = finalizerHoldLog((line) => {
    assert.ok(line.endsWith("\n"), line);
    lines.push(line.slice(0, -1));
  }, requestsMax);
  return [sealed, lines];
}

/** Advances one request as many times in a row as asked, held at one reason or moved. */
function holdLogAdvance(
  sealed: FinalizerTelemetry,
  request: string,
  held: FinalizerHoldReason | undefined,
  times = 1,
): void {
  for (let advance = 0; advance < times; advance += 1) {
    recordFinalizer(sealed, (metrics) => {
      metrics.advanced(request, held);
    });
  }
}

test("a request held at one reason pass after pass is written as its run doubles, not every pass", () => {
  const [sealed, lines] = holdLogLines();
  holdLogAdvance(sealed, "request-one", "CandidateUnbuilt", 9);
  assert.deepEqual(lines, [
    'finalizer: request "request-one" held at CandidateUnbuilt, 1 advances in a row',
    'finalizer: request "request-one" held at CandidateUnbuilt, 2 advances in a row',
    'finalizer: request "request-one" held at CandidateUnbuilt, 4 advances in a row',
    'finalizer: request "request-one" held at CandidateUnbuilt, 8 advances in a row',
  ]);
});

test("a hold at another reason, or after the request moved, starts its run again", () => {
  const [sealed, lines] = holdLogLines();
  holdLogAdvance(sealed, "request-one", "CandidateUnbuilt", 3);
  holdLogAdvance(sealed, "request-one", "TargetUnreadable");
  holdLogAdvance(sealed, "request-one", undefined);
  holdLogAdvance(sealed, "request-one", "TargetUnreadable");
  holdLogAdvance(sealed, "request-two", undefined, 3);
  assert.deepEqual(lines, [
    'finalizer: request "request-one" held at CandidateUnbuilt, 1 advances in a row',
    'finalizer: request "request-one" held at CandidateUnbuilt, 2 advances in a row',
    'finalizer: request "request-one" held at TargetUnreadable, 1 advances in a row',
    'finalizer: request "request-one" held at TargetUnreadable, 1 advances in a row',
  ]);
});

test("a hold log remembers no more requests than its bound, forgetting the oldest", () => {
  const [sealed, lines] = holdLogLines(1);
  holdLogAdvance(sealed, "request-one", "CandidateUnbuilt", 2);
  holdLogAdvance(sealed, "request-two", "CandidateUnbuilt");
  holdLogAdvance(sealed, "request-one", "CandidateUnbuilt");
  assert.deepEqual(lines, [
    'finalizer: request "request-one" held at CandidateUnbuilt, 1 advances in a row',
    'finalizer: request "request-one" held at CandidateUnbuilt, 2 advances in a row',
    'finalizer: request "request-two" held at CandidateUnbuilt, 1 advances in a row',
    'finalizer: request "request-one" held at CandidateUnbuilt, 1 advances in a row',
  ]);
  assert.throws(() => finalizerHoldLog(() => undefined, 0), RangeError);
});

test("a hold log writes nothing for any observation but an advance", () => {
  const [sealed, lines] = holdLogLines();
  recordFinalizer(sealed, (metrics) => {
    metrics.holding("CandidateUnbuilt");
    metrics.claiming(1, 1);
  });
  assert.deepEqual(lines, []);
});
