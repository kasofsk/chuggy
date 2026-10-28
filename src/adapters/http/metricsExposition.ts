/**
 * Metric families written in the Prometheus text exposition format, version
 * 0.0.4: a `# HELP` and a `# TYPE` line per family, then its samples, a
 * histogram's as its cumulative `_bucket` series ending at `+Inf`, its `_sum`
 * and its `_count`.
 *
 * A NAME THE FORMAT CANNOT CARRY IS REFUSED, NEVER REWRITTEN. A family or a
 * label is named in the code that builds it, so a bad one is that code's fault,
 * and a page written with it would be refused whole by the scraper.
 */

import type {
  MetricsFamily,
  MetricsHistogramSample,
  MetricsLabels,
} from "../../interpreter/metricsFamily.ts";

/** The media type a page in this format is served as. */
export const metricsExpositionContentType =
  "text/plain; version=0.0.4; charset=utf-8";

const metricNamePattern = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/u;

const labelNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

function metricsExpositionName(name: string): string {
  if (!metricNamePattern.test(name))
    throw new RangeError(
      `metrics: ${JSON.stringify(name)} is not a metric name`,
    );
  return name;
}

/** A label name, refusing what the format reserves: a leading `__`, and `le` beside a histogram's own. */
function metricsExpositionLabelName(name: string, histogram: boolean): string {
  if (
    !labelNamePattern.test(name) ||
    name.startsWith("__") ||
    (histogram && name === "le")
  )
    throw new RangeError(
      `metrics: ${JSON.stringify(name)} is not a label name`,
    );
  return name;
}

function metricsExpositionLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

function metricsExpositionHelp(help: string): string {
  return help.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function metricsExpositionNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  return String(value);
}

function metricsExpositionLabels(
  labels: MetricsLabels,
  histogram: boolean,
  le?: string,
): string {
  const pairs = Object.entries(labels).map(
    ([name, value]) =>
      `${metricsExpositionLabelName(name, histogram)}="${metricsExpositionLabelValue(value)}"`,
  );
  if (le !== undefined) pairs.push(`le="${le}"`);
  return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
}

/** One histogram sample's lines: every bucket counting what fell at or below it, then its sum and its count. */
function metricsExpositionHistogram(
  name: string,
  bounds: readonly number[],
  sample: MetricsHistogramSample,
): readonly string[] {
  if (sample.bucketCounts.length !== bounds.length + 1)
    throw new RangeError(`metrics: ${name} has a sample of the wrong buckets`);
  const lines: string[] = [];
  let cumulative = 0;
  for (const [index, count] of sample.bucketCounts.entries()) {
    cumulative += count;
    const bound = bounds[index];
    const le = bound === undefined ? "+Inf" : metricsExpositionNumber(bound);
    lines.push(
      `${name}_bucket${metricsExpositionLabels(sample.labels, true, le)} ${metricsExpositionNumber(cumulative)}`,
    );
  }
  const labels = metricsExpositionLabels(sample.labels, true);
  lines.push(`${name}_sum${labels} ${metricsExpositionNumber(sample.sum)}`);
  lines.push(`${name}_count${labels} ${metricsExpositionNumber(cumulative)}`);
  return lines;
}

/** Whether a histogram's bounds are finite and each above the one before it. */
function metricsExpositionBoundsAscend(bounds: readonly number[]): boolean {
  return bounds.every(
    (bound, index) =>
      Number.isFinite(bound) && (bounds[index - 1] ?? -Infinity) < bound,
  );
}

function metricsExpositionFamily(family: MetricsFamily): readonly string[] {
  const name = metricsExpositionName(family.name);
  const head = [
    `# HELP ${name} ${metricsExpositionHelp(family.help)}`,
    `# TYPE ${name} ${family.type}`,
  ];
  if (family.type !== "histogram")
    return [
      ...head,
      ...family.samples.map(
        (sample) =>
          `${name}${metricsExpositionLabels(sample.labels, false)} ${metricsExpositionNumber(sample.value)}`,
      ),
    ];
  if (!metricsExpositionBoundsAscend(family.bounds))
    throw new RangeError(`metrics: ${name}'s bounds do not ascend`);
  return [
    ...head,
    ...family.samples.flatMap((sample) =>
      metricsExpositionHistogram(name, family.bounds, sample),
    ),
  ];
}

/** The page `families` are written as, every line ended by a line feed. */
export function metricsExposition(families: readonly MetricsFamily[]): string {
  return families
    .flatMap(metricsExpositionFamily)
    .map((line) => `${line}\n`)
    .join("");
}
