/**
 * The pure half of run evidence: the paths the server derives, the bounds a
 * read is refused outside, and what makes a run complete.
 *
 * The paths are checked against the artifact store's own path rule rather than
 * against a literal, because a path this module derives and that store refuses
 * would be a run whose bytes could never be written.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeHttpPageItemsMax,
  runTranscriptBatchesMax,
  runTurnSeriesMax,
} from "../../src/contract/http.ts";
import { allAttemptStates } from "../../src/interpreter/executionScheduler.ts";
import { artifactPathRejection } from "../../src/interpreter/resultManifest.ts";
import {
  checkedRunTranscriptAfter,
  checkedRunTurnsQuery,
  runConfigurationPath,
  runEndedEvidences,
  runEndedLoss,
  runIsComplete,
  runTranscriptBatchPath,
} from "../../src/interpreter/runEvidence.ts";

test("every derived evidence path is one the artifact store accepts", () => {
  for (const path of [
    runConfigurationPath(),
    runTranscriptBatchPath(1),
    runTranscriptBatchPath(runTranscriptBatchesMax),
  ])
    assert.equal(artifactPathRejection(path), undefined, path);
});

test("a transcript path names its own batch and no other", () => {
  assert.notEqual(runTranscriptBatchPath(1), runTranscriptBatchPath(2));
  assert.match(runTranscriptBatchPath(7), /\/7\.jsonl$/u);
});

test("a batch outside the run's bound has no path at all", () => {
  for (const batch of [0, -1, 1.5, runTranscriptBatchesMax + 1])
    assert.throws(() => runTranscriptBatchPath(batch), RangeError);
});

test("a run is complete exactly when its attempt can no longer write", () => {
  const complete = allAttemptStates.filter((state) => runIsComplete(state));
  assert.deepEqual(
    [...complete],
    ["Reported", "Lost", "Withdrawn", "Superseded"],
  );
});

test("a turn page is refused outside the wire's page and series bounds", () => {
  assert.deepEqual(checkedRunTurnsQuery({ limit: nativeHttpPageItemsMax }), {
    limit: nativeHttpPageItemsMax,
  });
  assert.deepEqual(checkedRunTurnsQuery({ after: 0, limit: 1 }), {
    after: 0,
    limit: 1,
  });
  for (const limit of [0, -1, 1.5, nativeHttpPageItemsMax + 1])
    assert.throws(() => checkedRunTurnsQuery({ limit }), RangeError);
  for (const after of [-1, 1.5, runTurnSeriesMax + 1])
    assert.throws(() => checkedRunTurnsQuery({ after, limit: 1 }), RangeError);
});

test("a transcript cursor is refused outside the run's own batch bound", () => {
  assert.equal(checkedRunTranscriptAfter(0), 0);
  assert.equal(
    checkedRunTranscriptAfter(runTranscriptBatchesMax),
    runTranscriptBatchesMax,
  );
  for (const after of [-1, 1.5, runTranscriptBatchesMax + 1])
    assert.throws(() => checkedRunTranscriptAfter(after), RangeError);
});

test("a rate-limited run is withdrawn and every other ending is a loss", () => {
  assert.equal(runEndedLoss("RunRateLimited"), "Withdrawn");
  for (const evidence of runEndedEvidences)
    assert.equal(
      runEndedLoss(evidence),
      evidence === "RunRateLimited" ? "Withdrawn" : "Lost",
      `${evidence} spends the retry budget`,
    );
  assert.deepEqual(
    new Set(runEndedEvidences.map(runEndedLoss)),
    new Set(["Lost", "Withdrawn"]),
  );
});
