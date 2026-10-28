/** Runner reports a suite sends: the least a runner may say, and the heaviest it may. */

import { sessionContainerEnds } from "../../src/contract/rosters.ts";
import {
  workerPoolSettlementOutcomes,
  workerRunnerHostCharsMax,
  workerRunnerImagePullBoundsSecs,
  workerRunnerJobEnds,
  workerRunnerRefusalFaults,
  workerRunnerRunBoundsSecs,
  workerRunnerRunKinds,
  type WorkerRunnerReport,
} from "../../src/contract/workerPool.ts";

/** A report naming nothing optional and counting nothing. */
export const workerRunnerReportLeast: WorkerRunnerReport = {
  host: "build-box.local",
  uptimeSecs: 42.5,
  jobsRunning: 1,
  concurrencyMax: 2,
  sessionsRunning: 0,
  sessionsMax: 1,
  polls: 7,
  pollsFailed: 1,
  settlements: { Accepted: 3 },
  refusals: {},
  jobsEnded: { Succeeded: 2 },
  sessionsEnded: {},
  imagePullSecs: {
    bucketCounts: workerRunnerImagePullBoundsSecs.map(() => 0).concat(1),
    sumSecs: 700,
  },
  runSecs: {},
};

/** Each count of a report `count`, keyed by every label of `roster`. */
function workerRunnerReportTallied<Label extends string>(
  roster: readonly Label[],
  count: number,
): Record<Label, number> {
  return Object.fromEntries(roster.map((label) => [label, count])) as Record<
    Label,
    number
  >;
}

/** A report naming every field at the longest it may be written. */
export function workerRunnerReportHeaviest(): WorkerRunnerReport {
  const count = Number.MAX_SAFE_INTEGER;
  const seconds = Number.MAX_VALUE;
  const histogram = (bounds: readonly number[]) => ({
    bucketCounts: bounds.map(() => count).concat(count),
    sumSecs: seconds,
  });
  return {
    host: "h".repeat(workerRunnerHostCharsMax),
    uptimeSecs: seconds,
    jobsRunning: count,
    concurrencyMax: count,
    sessionsRunning: count,
    sessionsMax: count,
    diskFreeBytes: count,
    diskFloorBytes: count,
    cpus: count,
    loadAverageOneMinute: seconds,
    memoryTotalBytes: count,
    memoryAvailableBytes: count,
    polls: count,
    pollsFailed: count,
    settlements: workerRunnerReportTallied(workerPoolSettlementOutcomes, count),
    refusals: workerRunnerReportTallied(workerRunnerRefusalFaults, count),
    jobsEnded: workerRunnerReportTallied(workerRunnerJobEnds, count),
    sessionsEnded: workerRunnerReportTallied(sessionContainerEnds, count),
    imagePullSecs: histogram(workerRunnerImagePullBoundsSecs),
    runSecs: Object.fromEntries(
      workerRunnerRunKinds.map((kind) => [
        kind,
        histogram(workerRunnerRunBoundsSecs),
      ]),
    ),
  };
}
