/**
 * The latest report of each runner the pool plane serves, and the facts of its
 * latest poll, held in memory and served as metric families.
 *
 * A REPORT IS A READING, NOT A FACT. Nothing here is stored or decided on, so a
 * restart forgets every report and each runner's next one restores it.
 *
 * A RUNNER IS HELD AGAINST WHO ITS BEARER RESOLVED TO, never against anything
 * it sent, and its labels are taken from that identity alone but for the
 * machine name its report gives.
 *
 * A RUNNER IS SERVED ONLY WHILE ITS REPORT IS HELD. Its poll facts are kept
 * from its first poll, so its series are whole from its first report, and are
 * served beside that report alone. A report or poll facts older than the age
 * bound are dropped, and past the runners bound the runner heard from least
 * recently is dropped whole.
 */

import {
  workerPoolSettlementOutcomes,
  workerRunnerImagePullBoundsSecs,
  workerRunnerJobEnds,
  workerRunnerRefusalFaults,
  workerRunnerRunBoundsSecs,
  workerRunnerRunKinds,
  type WorkerRunner,
  type WorkerRunnerReport,
} from "../contract/workerPool.ts";
import { sessionContainerEnds } from "../contract/rosters.ts";
import type {
  MetricsFamily,
  MetricsLabels,
  MetricsValueSample,
} from "./metricsFamily.ts";
import { oidcPrincipalSubject } from "./principal.ts";
import type {
  DedicatedPoolIdentity,
  PersonalRunnerIdentity,
} from "./workerPoolIdentity.ts";

/** How long a report or a poll's facts are held once made. */
export const workerPoolReportAgeMsMax = 180_000;

/** A caller whose reports are held: a project's pool or a member's personal runner. */
export type WorkerPoolReporter =
  | DedicatedPoolIdentity
  | (PersonalRunnerIdentity & { readonly kind: "Personal" });

/** What a poll named that is served beside its runner's report, where it named each. */
export interface WorkerPoolPolled {
  readonly runner?: WorkerRunner;
  readonly memoryRoomMib?: number;
  readonly memoryCeilingMib?: number;
}

export interface WorkerPoolReportSettings {
  /** The issuer a personal runner's owner and client are subjects of. */
  readonly issuer: string;
  readonly runnersMax: number;
  readonly ageMsMax: number;
  readonly now: () => number;
}

export interface WorkerPoolReports {
  polled(reporter: WorkerPoolReporter, polled: WorkerPoolPolled): void;
  reported(reporter: WorkerPoolReporter, report: WorkerRunnerReport): void;
  /** Every held runner's series, of the runners whose report is held. */
  families(): readonly MetricsFamily[];
}

interface WorkerPoolReportHeld {
  readonly reporter: WorkerPoolReporter;
  readonly poll?: WorkerPoolPolled & { readonly atMs: number };
  readonly report?: {
    readonly atMs: number;
    readonly report: WorkerRunnerReport;
  };
}

/** One held runner whose report is held, as the families are built from it. */
interface WorkerPoolReportServed {
  readonly labels: MetricsLabels;
  readonly poll: (WorkerPoolPolled & { readonly atMs: number }) | undefined;
  readonly atMs: number;
  readonly report: WorkerRunnerReport;
}

const workerPoolReportBytesPerMib = 1_048_576;

/** The labels every series of one runner carries, each its kind does not name empty. */
function workerPoolReportLabels(
  reporter: WorkerPoolReporter,
  host: string,
  issuer: string,
): MetricsLabels {
  switch (reporter.kind) {
    case "Dedicated":
      return {
        tenant: reporter.partition.tenant,
        project: reporter.partition.project,
        pool: reporter.pool,
        owner: "",
        personal_runner: "",
        host,
      };
    case "Personal":
      return {
        tenant: reporter.tenant,
        project: "",
        pool: "",
        owner: oidcPrincipalSubject(issuer, reporter.owner) ?? "",
        personal_runner: oidcPrincipalSubject(issuer, reporter.principal) ?? "",
        host,
      };
  }
}

/** A gauge of what `measured` reads of each runner, a runner it reads nothing of left out. */
function workerPoolReportGauge(
  served: readonly WorkerPoolReportServed[],
  name: string,
  help: string,
  measured: (runner: WorkerPoolReportServed) => number | undefined,
): MetricsFamily {
  return {
    type: "gauge",
    name,
    help,
    samples: served.flatMap((runner): MetricsValueSample[] => {
      const value = measured(runner);
      return value === undefined ? [] : [{ labels: runner.labels, value }];
    }),
  };
}

/** A counter of each runner's tally by every label of `roster`, a label its report left out counting none. */
function workerPoolReportTally<Label extends string>(
  served: readonly WorkerPoolReportServed[],
  family: { readonly name: string; readonly help: string },
  label: string,
  roster: readonly Label[],
  tallied: (
    report: WorkerRunnerReport,
  ) => Readonly<Partial<Record<Label, number | undefined>>>,
): MetricsFamily {
  return {
    type: "counter",
    ...family,
    samples: served.flatMap((runner) =>
      roster.map((value) => ({
        labels: { ...runner.labels, [label]: value },
        value: tallied(runner.report)[value] ?? 0,
      })),
    ),
  };
}

function workerPoolReportMachineFamilies(
  served: readonly WorkerPoolReportServed[],
): readonly MetricsFamily[] {
  const gauge = (
    name: string,
    help: string,
    measured: (report: WorkerRunnerReport) => number | undefined,
  ) =>
    workerPoolReportGauge(served, name, help, (runner) =>
      measured(runner.report),
    );
  return [
    gauge(
      "chuggy_runner_uptime_seconds",
      "How long the runner process has run.",
      (report) => report.uptimeSecs,
    ),
    gauge(
      "chuggy_runner_jobs_running",
      "Jobs the runner runs now.",
      (report) => report.jobsRunning,
    ),
    gauge(
      "chuggy_runner_jobs_max",
      "The most jobs the runner takes at once.",
      (report) => report.concurrencyMax,
    ),
    gauge(
      "chuggy_runner_sessions_running",
      "Sessions the runner runs now.",
      (report) => report.sessionsRunning,
    ),
    gauge(
      "chuggy_runner_sessions_max",
      "The most sessions the runner takes at once.",
      (report) => report.sessionsMax,
    ),
    gauge(
      "chuggy_runner_disk_free_bytes",
      "Disk free where the runner's backend measures it.",
      (report) => report.diskFreeBytes,
    ),
    gauge(
      "chuggy_runner_disk_floor_bytes",
      "The free disk below which the runner takes no job.",
      (report) => report.diskFloorBytes,
    ),
    gauge(
      "chuggy_runner_machine_cpus",
      "CPUs the runner's machine has.",
      (report) => report.cpus,
    ),
    gauge(
      "chuggy_runner_machine_load1",
      "The runner's machine's one-minute load average.",
      (report) => report.loadAverageOneMinute,
    ),
    gauge(
      "chuggy_runner_machine_memory_total_bytes",
      "Memory the runner's machine has.",
      (report) => report.memoryTotalBytes,
    ),
    gauge(
      "chuggy_runner_machine_memory_available_bytes",
      "Memory the runner's machine has available.",
      (report) => report.memoryAvailableBytes,
    ),
  ];
}

function workerPoolReportCountFamilies(
  served: readonly WorkerPoolReportServed[],
): readonly MetricsFamily[] {
  const counter = (
    name: string,
    help: string,
    counted: (report: WorkerRunnerReport) => number,
  ): MetricsFamily => ({
    type: "counter",
    name,
    help,
    samples: served.map((runner) => ({
      labels: runner.labels,
      value: counted(runner.report),
    })),
  });
  return [
    counter(
      "chuggy_runner_polls_total",
      "Polls the runner process has made.",
      (report) => report.polls,
    ),
    counter(
      "chuggy_runner_polls_failed_total",
      "Polls the runner process made that never reached the plane.",
      (report) => report.pollsFailed,
    ),
    workerPoolReportTally(
      served,
      {
        name: "chuggy_runner_settlements_total",
        help: "Assignments the runner process settled, by outcome.",
      },
      "outcome",
      workerPoolSettlementOutcomes,
      (report) => report.settlements,
    ),
    workerPoolReportTally(
      served,
      {
        name: "chuggy_runner_refusals_total",
        help: "Assignments the runner process refused, by the image fault named.",
      },
      "fault",
      workerRunnerRefusalFaults,
      (report) => report.refusals,
    ),
    workerPoolReportTally(
      served,
      {
        name: "chuggy_runner_jobs_ended_total",
        help: "Jobs the runner process ran that ended, by how.",
      },
      "end",
      workerRunnerJobEnds,
      (report) => report.jobsEnded,
    ),
    workerPoolReportTally(
      served,
      {
        name: "chuggy_runner_sessions_ended_total",
        help: "Sessions the runner process ran that ended, by how.",
      },
      "end",
      sessionContainerEnds,
      (report) => report.sessionsEnded,
    ),
  ];
}

/** The bucket counts and sum of a histogram a report left out, which observed nothing. */
function workerPoolReportHistogramNone(bounds: readonly number[]) {
  return { bucketCounts: bounds.map(() => 0).concat(0), sumSecs: 0 };
}

function workerPoolReportHistogramFamilies(
  served: readonly WorkerPoolReportServed[],
): readonly MetricsFamily[] {
  return [
    {
      type: "histogram",
      name: "chuggy_runner_image_pull_seconds",
      help: "How long each image pull the runner process made took.",
      bounds: workerRunnerImagePullBoundsSecs,
      samples: served.map((runner) => ({
        labels: runner.labels,
        bucketCounts: runner.report.imagePullSecs.bucketCounts,
        sum: runner.report.imagePullSecs.sumSecs,
      })),
    },
    {
      type: "histogram",
      name: "chuggy_runner_run_seconds",
      help: "How long each job or session the runner process ran took.",
      bounds: workerRunnerRunBoundsSecs,
      samples: served.flatMap((runner) =>
        workerRunnerRunKinds.map((kind) => {
          const run =
            runner.report.runSecs[kind] ??
            workerPoolReportHistogramNone(workerRunnerRunBoundsSecs);
          return {
            labels: { ...runner.labels, kind },
            bucketCounts: run.bucketCounts,
            sum: run.sumSecs,
          };
        }),
      ),
    },
  ];
}

function workerPoolReportPollFamilies(
  served: readonly WorkerPoolReportServed[],
): readonly MetricsFamily[] {
  return [
    {
      type: "gauge",
      name: "chuggy_runner_info",
      help: "The runner package and version the runner's latest poll named.",
      samples: served.flatMap((runner) => {
        const named = runner.poll?.runner;
        return named === undefined
          ? []
          : [
              {
                labels: {
                  ...runner.labels,
                  package: named.package,
                  version: named.version,
                },
                value: 1,
              },
            ];
      }),
    },
    workerPoolReportGauge(
      served,
      "chuggy_runner_last_poll_timestamp_seconds",
      "When the runner last polled.",
      (runner) =>
        runner.poll === undefined ? undefined : runner.poll.atMs / 1_000,
    ),
    workerPoolReportGauge(
      served,
      "chuggy_runner_last_report_timestamp_seconds",
      "When the runner last reported.",
      (runner) => runner.atMs / 1_000,
    ),
    workerPoolReportGauge(
      served,
      "chuggy_runner_memory_room_bytes",
      "The memory room the runner's latest poll named.",
      (runner) => workerPoolReportBytes(runner.poll?.memoryRoomMib),
    ),
    workerPoolReportGauge(
      served,
      "chuggy_runner_memory_ceiling_bytes",
      "The memory ceiling the runner's latest poll named.",
      (runner) => workerPoolReportBytes(runner.poll?.memoryCeilingMib),
    ),
  ];
}

function workerPoolReportBytes(mib: number | undefined): number | undefined {
  return mib === undefined ? undefined : mib * workerPoolReportBytesPerMib;
}

/** What is held of one runner once whatever of it is past `ageMsMax` is dropped. */
function workerPoolReportFresh(
  held: WorkerPoolReportHeld,
  nowMs: number,
  ageMsMax: number,
): WorkerPoolReportHeld {
  const fresh = (atMs: number) => nowMs - atMs <= ageMsMax;
  return {
    reporter: held.reporter,
    ...(held.poll !== undefined && fresh(held.poll.atMs)
      ? { poll: held.poll }
      : {}),
    ...(held.report !== undefined && fresh(held.report.atMs)
      ? { report: held.report }
      : {}),
  };
}

/** Drops from `held` whatever of each runner is past `ageMsMax`, and each runner nothing is left of. */
function workerPoolReportSwept(
  held: Map<string, WorkerPoolReportHeld>,
  nowMs: number,
  ageMsMax: number,
): void {
  for (const [principal, runner] of held) {
    const fresh = workerPoolReportFresh(runner, nowMs, ageMsMax);
    if (fresh.poll === undefined && fresh.report === undefined)
      held.delete(principal);
    else held.set(principal, fresh);
  }
}

/** Each held runner whose report is held, labelled. */
function workerPoolReportServed(
  held: ReadonlyMap<string, WorkerPoolReportHeld>,
  issuer: string,
): readonly WorkerPoolReportServed[] {
  return [...held.values()].flatMap((runner): WorkerPoolReportServed[] =>
    runner.report === undefined
      ? []
      : [
          {
            labels: workerPoolReportLabels(
              runner.reporter,
              runner.report.report.host,
              issuer,
            ),
            poll: runner.poll,
            atMs: runner.report.atMs,
            report: runner.report.report,
          },
        ],
  );
}

/** The reports and poll facts of at most `runnersMax` runners, each held no longer than `ageMsMax`. */
export function workerPoolReports(
  settings: WorkerPoolReportSettings,
): WorkerPoolReports {
  if (!Number.isSafeInteger(settings.runnersMax) || settings.runnersMax < 1)
    throw new RangeError("worker pool reports: runnersMax must be positive");
  if (!(settings.ageMsMax > 0))
    throw new RangeError("worker pool reports: ageMsMax must be positive");
  const held = new Map<string, WorkerPoolReportHeld>();
  const swept = (nowMs: number) => {
    workerPoolReportSwept(held, nowMs, settings.ageMsMax);
  };
  const kept = (
    reporter: WorkerPoolReporter,
    made: (
      before: WorkerPoolReportHeld | undefined,
      nowMs: number,
    ) => WorkerPoolReportHeld,
  ) => {
    const nowMs = settings.now();
    swept(nowMs);
    const before = held.get(reporter.principal);
    held.delete(reporter.principal);
    held.set(reporter.principal, made(before, nowMs));
    for (const principal of held.keys()) {
      if (held.size <= settings.runnersMax) break;
      held.delete(principal);
    }
    if (held.size > settings.runnersMax)
      throw new Error("worker pool reports: held past runnersMax");
  };
  return {
    polled: (reporter, polled) => {
      kept(reporter, (before, atMs) => ({
        ...before,
        reporter,
        poll: { ...polled, atMs },
      }));
    },
    reported: (reporter, report) => {
      kept(reporter, (before, atMs) => ({
        ...before,
        reporter,
        report: { atMs, report },
      }));
    },
    families: () => {
      swept(settings.now());
      const served = workerPoolReportServed(held, settings.issuer);
      return [
        ...workerPoolReportMachineFamilies(served),
        ...workerPoolReportCountFamilies(served),
        ...workerPoolReportHistogramFamilies(served),
        ...workerPoolReportPollFamilies(served),
      ];
    },
  };
}
