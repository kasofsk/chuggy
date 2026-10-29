/**
 * Metric families written in the Prometheus text exposition format, version
 * 0.0.4, or in OpenMetrics text, version 1.0.0, whichever the scraper's
 * `Accept` ranks highest of the two.
 *
 * THE TEXT FORMAT is a `# HELP` and a `# TYPE` line per family, then its
 * samples, a histogram's as its cumulative `_bucket` series ending at `+Inf`,
 * its `_sum` and its `_count`. It carries no time a series began.
 *
 * OPENMETRICS names a counter's family without its `_total`, which its samples
 * carry, writes `le` canonically, follows a sample naming when its series began
 * with that series' `_created`, and ends the page `# EOF`.
 *
 * A NAME THE FORMAT CANNOT CARRY IS REFUSED, NEVER REWRITTEN. A family or a
 * label is named in the code that builds it, so a bad one is that code's fault,
 * and a page written with it would be refused whole by the scraper. So is, in
 * OpenMetrics, a counter not named `_total`, a gauge naming when it began, and
 * two families writing a sample of the same name.
 */

import type {
  MetricsFamily,
  MetricsHistogramSample,
  MetricsLabels,
} from "../../interpreter/metricsFamily.ts";

/** The media type a page in the text format is served as. */
export const metricsExpositionContentType =
  "text/plain; version=0.0.4; charset=utf-8";

/** The media type a page in OpenMetrics is served as. */
export const metricsExpositionOpenMetricsContentType =
  "application/openmetrics-text; version=1.0.0; charset=utf-8";

export type MetricsExpositionFormat = "Text" | "OpenMetrics";

/** The most `Accept` ranges read; any past them are ignored. */
const metricsExpositionAcceptRangesMax = 64;

const metricsExpositionWeightPattern =
  /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/u;

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

/** The format one `Accept` range names, and its weight, or none where it names neither format. */
function metricsExpositionRange(
  range: string,
):
  | { readonly format: MetricsExpositionFormat; readonly weight: number }
  | undefined {
  const [type = "", ...parameters] = range
    .split(";")
    .map((part) => part.trim().toLowerCase());
  const named = new Map(
    parameters.map((parameter) => {
      const [name = "", value = ""] = parameter.split("=", 2);
      return [name.trim(), value.trim().replace(/^"(.*)"$/u, "$1")];
    }),
  );
  const q = named.get("q") ?? "1";
  const version = named.get("version");
  if (!metricsExpositionWeightPattern.test(q)) return undefined;
  const format: MetricsExpositionFormat | undefined =
    type === "application/openmetrics-text" &&
    (version === undefined || version === "1.0.0")
      ? "OpenMetrics"
      : (type === "text/plain" &&
            (version === undefined || version === "0.0.4")) ||
          type === "*/*"
        ? "Text"
        : undefined;
  return format === undefined ? undefined : { format, weight: Number(q) };
}

/** The format `accept` ranks highest, the earlier range on a tie, and the text format where it ranks neither. */
export function metricsExpositionNegotiated(
  accept: string | undefined,
): MetricsExpositionFormat {
  let chosen: { format: MetricsExpositionFormat; weight: number } = {
    format: "Text",
    weight: 0,
  };
  for (const range of (accept ?? "")
    .split(",")
    .slice(0, metricsExpositionAcceptRangesMax)) {
    const ranked = metricsExpositionRange(range);
    if (ranked !== undefined && ranked.weight > chosen.weight) chosen = ranked;
  }
  return chosen.format;
}

function metricsExpositionOpenMetricsHelp(help: string): string {
  return metricsExpositionHelp(help).replaceAll('"', '\\"');
}

/** A bound as OpenMetrics writes `le`: an integer with its `.0`. */
function metricsExpositionOpenMetricsBound(bound: number): string {
  return Number.isInteger(bound)
    ? bound.toFixed(1)
    : metricsExpositionNumber(bound);
}

/** The `_created` line of a sample naming when its series began, or none. */
function metricsExpositionOpenMetricsCreated(
  name: string,
  labels: string,
  createdSecs: number | undefined,
): readonly string[] {
  if (createdSecs === undefined) return [];
  if (!Number.isFinite(createdSecs))
    throw new RangeError(`metrics: ${name} began at no finite time`);
  return [`${name}_created${labels} ${String(createdSecs)}`];
}

function metricsExpositionOpenMetricsHistogram(
  name: string,
  bounds: readonly number[],
  sample: MetricsHistogramSample,
): readonly string[] {
  if (sample.bucketCounts.length !== bounds.length + 1)
    throw new RangeError(`metrics: ${name} has a sample of the wrong buckets`);
  const labels = metricsExpositionLabels(sample.labels, true);
  let cumulative = 0;
  const buckets = sample.bucketCounts.map((count, index) => {
    cumulative += count;
    const bound = bounds[index];
    const le =
      bound === undefined ? "+Inf" : metricsExpositionOpenMetricsBound(bound);
    return `${name}_bucket${metricsExpositionLabels(sample.labels, true, le)} ${metricsExpositionNumber(cumulative)}`;
  });
  return [
    ...buckets,
    `${name}_count${labels} ${metricsExpositionNumber(cumulative)}`,
    `${name}_sum${labels} ${metricsExpositionNumber(sample.sum)}`,
    ...metricsExpositionOpenMetricsCreated(name, labels, sample.createdSecs),
  ];
}

const metricsExpositionOpenMetricsCounterSuffix = "_total";

/** A family's name in OpenMetrics, and every sample name it writes. */
function metricsExpositionOpenMetricsNames(family: MetricsFamily): {
  readonly name: string;
  readonly written: readonly string[];
} {
  const named = metricsExpositionName(family.name);
  switch (family.type) {
    case "counter": {
      const name = named.endsWith(metricsExpositionOpenMetricsCounterSuffix)
        ? named.slice(0, -metricsExpositionOpenMetricsCounterSuffix.length)
        : "";
      if (!metricNamePattern.test(name))
        throw new RangeError(`metrics: counter ${named} is not named _total`);
      return { name, written: [name, named, `${name}_created`] };
    }
    case "gauge":
      return { name: named, written: [named] };
    case "histogram":
      return {
        name: named,
        written: ["", "_bucket", "_count", "_sum", "_created"].map(
          (suffix) => `${named}${suffix}`,
        ),
      };
  }
}

function metricsExpositionOpenMetricsFamily(
  family: MetricsFamily,
  name: string,
): readonly string[] {
  const head = [
    `# TYPE ${name} ${family.type}`,
    `# HELP ${name} ${metricsExpositionOpenMetricsHelp(family.help)}`,
  ];
  if (family.type === "histogram") {
    if (!metricsExpositionBoundsAscend(family.bounds))
      throw new RangeError(`metrics: ${name}'s bounds do not ascend`);
    return [
      ...head,
      ...family.samples.flatMap((sample) =>
        metricsExpositionOpenMetricsHistogram(name, family.bounds, sample),
      ),
    ];
  }
  const sampled = family.type === "counter" ? `${name}_total` : name;
  return [
    ...head,
    ...family.samples.flatMap((sample) => {
      if (family.type === "gauge" && sample.createdSecs !== undefined)
        throw new RangeError(`metrics: gauge ${name} names when it began`);
      const labels = metricsExpositionLabels(sample.labels, false);
      return [
        `${sampled}${labels} ${metricsExpositionNumber(sample.value)}`,
        ...metricsExpositionOpenMetricsCreated(
          name,
          labels,
          sample.createdSecs,
        ),
      ];
    }),
  ];
}

/** The OpenMetrics page `families` are written as, ended by `# EOF`. */
export function metricsExpositionOpenMetrics(
  families: readonly MetricsFamily[],
): string {
  const written = new Set<string>();
  const lines = families.flatMap((family) => {
    const names = metricsExpositionOpenMetricsNames(family);
    for (const sample of names.written) {
      if (written.has(sample))
        throw new RangeError(`metrics: ${sample} is written by two families`);
      written.add(sample);
    }
    return metricsExpositionOpenMetricsFamily(family, names.name);
  });
  return [...lines, "# EOF"].map((line) => `${line}\n`).join("");
}

/** The page `families` are written as in `format`, and the media type it is served as. */
export function metricsExpositionPage(
  families: readonly MetricsFamily[],
  format: MetricsExpositionFormat,
): { readonly contentType: string; readonly page: string } {
  switch (format) {
    case "Text":
      return {
        contentType: metricsExpositionContentType,
        page: metricsExposition(families),
      };
    case "OpenMetrics":
      return {
        contentType: metricsExpositionOpenMetricsContentType,
        page: metricsExpositionOpenMetrics(families),
      };
  }
}
