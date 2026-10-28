/**
 * A metric family as a plane serves it: a name, what it measures, and its
 * samples, each named by its labels. It is plain data, so what a family holds
 * is decided where it is read and how it is written is the writer's alone.
 */

/** One sample's labels, by label name. */
export type MetricsLabels = Readonly<Record<string, string>>;

/** One counter or gauge sample. */
export interface MetricsValueSample {
  readonly labels: MetricsLabels;
  readonly value: number;
}

/**
 * One histogram sample: how many observations fell in each bucket alone, in
 * the order of its family's bounds and one more past the last bound, and the
 * sum of what was observed.
 */
export interface MetricsHistogramSample {
  readonly labels: MetricsLabels;
  readonly bucketCounts: readonly number[];
  readonly sum: number;
}

export type MetricsFamily =
  | {
      readonly type: "counter" | "gauge";
      readonly name: string;
      readonly help: string;
      readonly samples: readonly MetricsValueSample[];
    }
  | {
      readonly type: "histogram";
      readonly name: string;
      readonly help: string;
      readonly bounds: readonly number[];
      readonly samples: readonly MetricsHistogramSample[];
    };

/** How many series `families` carry: a value sample is one, and a histogram's is each bucket, its sum and its count. */
export function metricsFamilySeries(
  families: readonly MetricsFamily[],
): number {
  return families.reduce(
    (series, family) =>
      series +
      family.samples.length *
        (family.type === "histogram" ? family.bounds.length + 3 : 1),
    0,
  );
}
