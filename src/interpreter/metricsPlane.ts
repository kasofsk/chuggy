/**
 * What every run cost and how long it took, as the metric families a scrape is
 * answered with, totalled from the rows already stored.
 *
 * NOTHING IS KEPT BETWEEN SCRAPES. Each one reads the rows afresh, so a counter
 * is a total over the rows that exist: it only rises while rows only accrue,
 * and a restart leaves it where it was.
 *
 * A COUNTER'S AND A HISTOGRAM'S SERIES BEGAN AT ITS EARLIEST ROW. A series
 * first appears already holding that row, so each names that row's time as
 * when it began, and a scraper counts the row as a rise from nothing. A gauge
 * names none.
 *
 * A PAGE IS WHOLE OR REFUSED. A read past its bound, and a page past the series
 * a page may carry, are each a refusal naming why, never a page with some of
 * its series left out.
 *
 * A LABEL IS A CLOSED ROSTER OR A BOUNDED NAME. The owner is the bare subject
 * a principal carries under the deployment's issuer, which is the login a
 * person signed in through that issuer holds, and empty where there is no
 * principal or it is another issuer's. No ticket, execution, attempt or
 * session is ever a label. A member's own session names no project, and its
 * turns carry `metricsPlaneMemberProject` rather than the partition reserved
 * for them, so no digest of a principal is a label.
 */

import {
  metricsFamilySeries,
  type MetricsFamily,
  type MetricsHistogramSample,
  type MetricsLabels,
  type MetricsValueSample,
} from "./metricsFamily.ts";
import { oidcPrincipalSubject } from "./principal.ts";

/** The bounds, in seconds, an attempt's and a session turn's duration is counted under. */
export const metricsPlaneDurationBoundsSecs: readonly number[] = [
  30, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200,
];

/** The project every member's own session is counted under: it begins `@`, which no project may, and is no member's partition. */
export const metricsPlaneMemberProject = "@member";

/** Where one execution's task ran and whose ticket it was, the owner as its label already. */
export interface MetricsPlaneTask {
  readonly tenant: string;
  readonly project: string;
  readonly owner: string;
  readonly phase: "Work" | "Evaluation";
  readonly stage: string;
  readonly runner: "Agent" | "Commands" | "";
  readonly workload: string;
  readonly placement: "Cluster" | "Pool" | "Personal";
}

/** Ended attempts of one task and end state, how many fell in each bucket of the bounds and the one past them, and when the first ended. */
export interface MetricsPlaneAttemptRow {
  readonly task: MetricsPlaneTask;
  readonly state: string;
  readonly buckets: readonly number[];
  readonly ended: number;
  readonly durationSecs: number;
  readonly createdSecs: number;
}

export interface MetricsPlaneRunRow {
  readonly task: MetricsPlaneTask;
  readonly turns: number;
  readonly durationMs: number;
  readonly durationApiMs: number;
  readonly createdSecs: number;
}

export interface MetricsPlaneModelRow {
  readonly task: MetricsPlaneTask;
  readonly model: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensCacheCreation: number;
  readonly tokensCacheRead: number;
  readonly costUsdMicros: number;
  readonly createdSecs: number;
}

/** Ended session turns of one owner, session kind, state and model, how many measured ones fell in each bucket, and when the first ended. */
export interface MetricsPlaneTurnRow {
  readonly tenant: string;
  readonly project: string;
  readonly owner: string;
  readonly session: "Lead" | "Thread" | "Inquiry";
  readonly state: string;
  readonly model: string | undefined;
  readonly buckets: readonly number[] | undefined;
  readonly ended: number;
  readonly tokens: number;
  readonly costMicros: number;
  readonly durationMs: number;
  readonly createdSecs: number;
}

export interface MetricsPlaneTicketRow {
  readonly tenant: string;
  readonly project: string;
  readonly phase: string;
  readonly tickets: number;
}

export interface MetricsPlaneRows {
  readonly attempts: readonly MetricsPlaneAttemptRow[];
  readonly runs: readonly MetricsPlaneRunRow[];
  readonly models: readonly MetricsPlaneModelRow[];
  readonly turns: readonly MetricsPlaneTurnRow[];
  readonly tickets: readonly MetricsPlaneTicketRow[];
}

export type MetricsPlaneRead =
  | { readonly read: "Read"; readonly rows: MetricsPlaneRows }
  | { readonly read: "Refused"; readonly why: string };

/** What one read is bounded by and labels with: the series a family may carry, and the owner a principal is. */
export interface MetricsPlaneBounds {
  readonly seriesMax: number;
  readonly owner: (principal: string) => string;
}

/** The stored rows, grouped by their labels, refusing a read any family of which carries more than `seriesMax` series. */
export interface MetricsPlaneReads {
  read(bounds: MetricsPlaneBounds): Promise<MetricsPlaneRead>;
}

export interface MetricsPlaneSettings {
  readonly issuer: string;
  readonly seriesMax: number;
}

export type MetricsPlaneScrape =
  | { readonly scraped: "Page"; readonly families: readonly MetricsFamily[] }
  | { readonly scraped: "Refused"; readonly why: string };

/** Sums of values under one label set, added to as rows sharing it are read, and the earliest of their created times. */
interface MetricsPlaneSum {
  readonly labels: MetricsLabels;
  readonly values: number[];
  createdSecs: number;
}

/** Rows summed per label set, so rows a label cannot tell apart are one series. */
function metricsPlaneSummed<Row extends { readonly createdSecs: number }>(
  rows: readonly Row[],
  labelled: (row: Row) => MetricsLabels,
  measured: (row: Row) => readonly number[],
): readonly MetricsPlaneSum[] {
  const sums = new Map<string, MetricsPlaneSum>();
  for (const row of rows) {
    const labels = labelled(row);
    const values = measured(row);
    const key = JSON.stringify(labels);
    const sum = sums.get(key);
    if (sum === undefined)
      sums.set(key, {
        labels,
        values: [...values],
        createdSecs: row.createdSecs,
      });
    else {
      for (const [index, value] of values.entries())
        sum.values[index] = (sum.values[index] ?? 0) + value;
      sum.createdSecs = Math.min(sum.createdSecs, row.createdSecs);
    }
  }
  return [...sums.values()];
}

/** The `index`th of every sum, as a counter's samples, each naming when its series began. */
function metricsPlaneValues(
  sums: readonly MetricsPlaneSum[],
  index: number,
  scale = 1,
): readonly MetricsValueSample[] {
  return sums.map(({ labels, values, createdSecs }) => ({
    labels,
    value: (values[index] ?? 0) / scale,
    createdSecs,
  }));
}

/** Bucket counts, one per bound and one past them, then the duration sum last. */
function metricsPlaneBucketed(
  buckets: readonly number[],
  sum: number,
): readonly number[] {
  if (buckets.length !== metricsPlaneDurationBoundsSecs.length + 1)
    throw new RangeError(
      `metrics plane: ${String(buckets.length)} buckets are not one per bound and one past them`,
    );
  return [...buckets, sum];
}

/** Bucketed sums as histogram samples, the duration sum scaled to seconds by `scale`. */
function metricsPlaneHistogram(
  sums: readonly MetricsPlaneSum[],
  scale: number,
): readonly MetricsHistogramSample[] {
  const buckets = metricsPlaneDurationBoundsSecs.length + 1;
  return sums.map(({ labels, values, createdSecs }) => ({
    labels,
    bucketCounts: values.slice(0, buckets),
    sum: (values[buckets] ?? 0) / scale,
    createdSecs,
  }));
}

/** The owner label a principal carries: its bare subject under `issuer`, and empty under any other. */
export function metricsPlaneOwner(issuer: string, principal: string): string {
  return oidcPrincipalSubject(issuer, principal) ?? "";
}

/** The labels every run and attempt series carries. */
function metricsPlaneTaskLabels(task: MetricsPlaneTask): MetricsLabels {
  return {
    tenant: task.tenant,
    project: task.project,
    owner: task.owner,
    phase: task.phase,
    stage: task.stage,
    runner: task.runner,
    placement: task.placement,
    workload: task.workload,
  };
}

function metricsPlaneAttemptFamilies(
  rows: readonly MetricsPlaneAttemptRow[],
): readonly MetricsFamily[] {
  const ended = metricsPlaneSummed(
    rows,
    (row) => ({
      ...metricsPlaneTaskLabels(row.task),
      state: row.state,
    }),
    (row) => [row.ended],
  );
  const durations = metricsPlaneSummed(
    rows,
    (row) => metricsPlaneTaskLabels(row.task),
    (row) => metricsPlaneBucketed(row.buckets, row.durationSecs),
  );
  return [
    {
      type: "counter",
      name: "chuggy_attempts_ended_total",
      help: "Execution attempts that have ended, by their stored end state.",
      samples: metricsPlaneValues(ended, 0),
    },
    {
      type: "histogram",
      name: "chuggy_attempt_duration_seconds",
      help: "How long each ended execution attempt ran, from a runner's claim where one claimed it, else its opening, to its ending.",
      bounds: metricsPlaneDurationBoundsSecs,
      samples: metricsPlaneHistogram(durations, 1),
    },
  ];
}

function metricsPlaneRunFamilies(
  rows: readonly MetricsPlaneRunRow[],
): readonly MetricsFamily[] {
  const runs = metricsPlaneSummed(
    rows,
    (row) => metricsPlaneTaskLabels(row.task),
    (row) => [row.turns, row.durationMs, row.durationApiMs],
  );
  return [
    {
      type: "counter",
      name: "chuggy_run_turns_total",
      help: "Agent turns the recorded runs took.",
      samples: metricsPlaneValues(runs, 0),
    },
    {
      type: "counter",
      name: "chuggy_run_duration_seconds_total",
      help: "Wall-clock time the recorded runs reported.",
      samples: metricsPlaneValues(runs, 1, 1_000),
    },
    {
      type: "counter",
      name: "chuggy_run_api_duration_seconds_total",
      help: "Time the recorded runs reported waiting on the model's API.",
      samples: metricsPlaneValues(runs, 2, 1_000),
    },
  ];
}

const metricsPlaneTokenTypes = [
  "input",
  "output",
  "cache_creation",
  "cache_read",
] as const;

function metricsPlaneTokensOf(
  row: MetricsPlaneModelRow,
  type: (typeof metricsPlaneTokenTypes)[number],
): number {
  switch (type) {
    case "input":
      return row.tokensInput;
    case "output":
      return row.tokensOutput;
    case "cache_creation":
      return row.tokensCacheCreation;
    case "cache_read":
      return row.tokensCacheRead;
  }
}

function metricsPlaneModelFamilies(
  rows: readonly MetricsPlaneModelRow[],
): readonly MetricsFamily[] {
  const tokens = metricsPlaneSummed(
    rows.flatMap((row) =>
      metricsPlaneTokenTypes.map((type) => ({
        row,
        type,
        createdSecs: row.createdSecs,
      })),
    ),
    ({ row, type }) => ({
      ...metricsPlaneTaskLabels(row.task),
      model: row.model,
      type,
    }),
    ({ row, type }) => [metricsPlaneTokensOf(row, type)],
  );
  const costs = metricsPlaneSummed(
    rows,
    (row) => ({
      ...metricsPlaneTaskLabels(row.task),
      model: row.model,
    }),
    (row) => [row.costUsdMicros],
  );
  return [
    {
      type: "counter",
      name: "chuggy_run_tokens_total",
      help: "Tokens the recorded runs spent, per model and kind of token.",
      samples: metricsPlaneValues(tokens, 0),
    },
    {
      type: "counter",
      name: "chuggy_run_cost_usd_total",
      help: "What the recorded runs cost at list price, in US dollars, per model.",
      samples: metricsPlaneValues(costs, 0, 1_000_000),
    },
  ];
}

function metricsPlaneTurnFamilies(
  rows: readonly MetricsPlaneTurnRow[],
): readonly MetricsFamily[] {
  const session = (row: MetricsPlaneTurnRow): MetricsLabels => ({
    tenant: row.tenant,
    project: row.project,
    owner: row.owner,
    session: row.session,
  });
  const measured = rows.flatMap((row) =>
    row.model === undefined ? [] : [{ ...row, model: row.model }],
  );
  const ended = metricsPlaneSummed(
    rows,
    (row) => ({ ...session(row), state: row.state }),
    (row) => [row.ended],
  );
  const spent = metricsPlaneSummed(
    measured,
    (row) => ({ ...session(row), model: row.model }),
    (row) => [row.tokens, row.costMicros],
  );
  const durations = metricsPlaneSummed(
    measured.flatMap((row) =>
      row.buckets === undefined ? [] : [{ ...row, buckets: row.buckets }],
    ),
    session,
    (row) => metricsPlaneBucketed(row.buckets, row.durationMs),
  );
  return [
    {
      type: "counter",
      name: "chuggy_session_turns_ended_total",
      help: "Session turns that have ended, by their stored end state.",
      samples: metricsPlaneValues(ended, 0),
    },
    {
      type: "counter",
      name: "chuggy_session_turn_tokens_total",
      help: "Tokens the measured session turns spent, per model.",
      samples: metricsPlaneValues(spent, 0),
    },
    {
      type: "counter",
      name: "chuggy_session_turn_cost_usd_total",
      help: "What the measured session turns cost, in US dollars, per model.",
      samples: metricsPlaneValues(spent, 1, 1_000_000),
    },
    {
      type: "histogram",
      name: "chuggy_session_turn_duration_seconds",
      help: "How long each measured session turn took.",
      bounds: metricsPlaneDurationBoundsSecs,
      samples: metricsPlaneHistogram(durations, 1_000),
    },
  ];
}

function metricsPlaneTicketFamily(
  rows: readonly MetricsPlaneTicketRow[],
): MetricsFamily {
  return {
    type: "gauge",
    name: "chuggy_tickets",
    help: "The project's tickets in each phase.",
    samples: rows.map((row) => ({
      labels: { tenant: row.tenant, project: row.project, phase: row.phase },
      value: row.tickets,
    })),
  };
}

/** Every family a page carries, from rows read once. */
export function metricsPlaneFamilies(
  rows: MetricsPlaneRows,
): readonly MetricsFamily[] {
  return [
    ...metricsPlaneAttemptFamilies(rows.attempts),
    ...metricsPlaneRunFamilies(rows.runs),
    ...metricsPlaneModelFamilies(rows.models),
    ...metricsPlaneTurnFamilies(rows.turns),
    metricsPlaneTicketFamily(rows.tickets),
  ];
}

/** One scrape: the rows read afresh and the families they total to, or the refusal naming the bound that stopped it. */
export function metricsPlane(
  reads: MetricsPlaneReads,
  settings: MetricsPlaneSettings,
): { readonly scrape: () => Promise<MetricsPlaneScrape> } {
  return {
    scrape: async () => {
      const read = await reads.read({
        seriesMax: settings.seriesMax,
        owner: (principal) => metricsPlaneOwner(settings.issuer, principal),
      });
      if (read.read === "Refused") return { scraped: "Refused", why: read.why };
      const families = metricsPlaneFamilies(read.rows);
      const series = metricsFamilySeries(families);
      return series > settings.seriesMax
        ? {
            scraped: "Refused",
            why: `the page would carry ${String(series)} series, past the cap of ${String(settings.seriesMax)}`,
          }
        : { scraped: "Page", families };
    },
  };
}
