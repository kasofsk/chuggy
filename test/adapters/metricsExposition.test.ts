/** Metric families in the Prometheus text format and in OpenMetrics: escaping, cumulative buckets, when a series began, a name the format cannot carry refused, and the format a scraper's `Accept` asks for. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  metricsExposition,
  metricsExpositionNegotiated,
  metricsExpositionOpenMetrics,
} from "../../src/adapters/http/metricsExposition.ts";
import type { MetricsFamily } from "../../src/interpreter/metricsFamily.ts";

test("a counter and a gauge are written under their help and type, each sample on its own line", () => {
  assert.equal(
    metricsExposition([
      {
        type: "counter",
        name: "chuggy_things_total",
        help: "Things.",
        samples: [
          { labels: { project: "web" }, value: 3 },
          { labels: {}, value: 0.25 },
        ],
      },
      {
        type: "gauge",
        name: "chuggy_open",
        help: "Open.",
        samples: [{ labels: { phase: "Work" }, value: 2 }],
      },
    ]),
    [
      "# HELP chuggy_things_total Things.",
      "# TYPE chuggy_things_total counter",
      'chuggy_things_total{project="web"} 3',
      "chuggy_things_total 0.25",
      "# HELP chuggy_open Open.",
      "# TYPE chuggy_open gauge",
      'chuggy_open{phase="Work"} 2',
      "",
    ].join("\n"),
  );
});

test("a label value escapes its backslash, double quote and line feed, and help its backslash and line feed", () => {
  const page = metricsExposition([
    {
      type: "counter",
      name: "chuggy_escaped_total",
      help: 'Back\\slash, "quoted",\nand on.',
      samples: [{ labels: { model: 'a\\b"c\nd' }, value: 1 }],
    },
  ]);
  assert.equal(
    page,
    [
      '# HELP chuggy_escaped_total Back\\\\slash, "quoted",\\nand on.',
      "# TYPE chuggy_escaped_total counter",
      'chuggy_escaped_total{model="a\\\\b\\"c\\nd"} 1',
      "",
    ].join("\n"),
  );
  assert.equal(page.split("\n").length, 4, "no value breaks a line");
});

test("a histogram's buckets count everything at or below them and end at +Inf, then its sum and its count", () => {
  assert.equal(
    metricsExposition([
      {
        type: "histogram",
        name: "chuggy_wait_seconds",
        help: "Waits.",
        bounds: [30, 60, 120],
        samples: [
          { labels: { owner: "" }, bucketCounts: [1, 0, 2, 4], sum: 900.5 },
        ],
      },
    ]),
    [
      "# HELP chuggy_wait_seconds Waits.",
      "# TYPE chuggy_wait_seconds histogram",
      'chuggy_wait_seconds_bucket{owner="",le="30"} 1',
      'chuggy_wait_seconds_bucket{owner="",le="60"} 1',
      'chuggy_wait_seconds_bucket{owner="",le="120"} 3',
      'chuggy_wait_seconds_bucket{owner="",le="+Inf"} 7',
      'chuggy_wait_seconds_sum{owner=""} 900.5',
      'chuggy_wait_seconds_count{owner=""} 7',
      "",
    ].join("\n"),
  );
});

test("a name the format cannot carry is refused rather than written", () => {
  for (const name of ["chuggy-dashed", "9starts_with_a_digit", "", "a b"])
    assert.throws(
      () =>
        metricsExposition([{ type: "counter", name, help: "", samples: [] }]),
      RangeError,
      name,
    );
  for (const label of ["owner-name", "__reserved", "9th"])
    assert.throws(
      () =>
        metricsExposition([
          {
            type: "gauge",
            name: "chuggy_ok",
            help: "",
            samples: [{ labels: { [label]: "x" }, value: 1 }],
          },
        ]),
      RangeError,
      label,
    );
  assert.throws(
    () =>
      metricsExposition([
        {
          type: "histogram",
          name: "chuggy_ok_seconds",
          help: "",
          bounds: [1],
          samples: [{ labels: { le: "1" }, bucketCounts: [0, 0], sum: 0 }],
        },
      ]),
    RangeError,
    "a histogram's own le is not a label a sample may carry",
  );
});

test("a histogram whose bounds do not ascend, or whose sample has the wrong buckets, is refused", () => {
  assert.throws(
    () =>
      metricsExposition([
        {
          type: "histogram",
          name: "chuggy_h",
          help: "",
          bounds: [60, 30],
          samples: [],
        },
      ]),
    RangeError,
  );
  assert.throws(
    () =>
      metricsExposition([
        {
          type: "histogram",
          name: "chuggy_h",
          help: "",
          bounds: [30, 60],
          samples: [{ labels: {}, bucketCounts: [1, 2], sum: 0 }],
        },
      ]),
    RangeError,
  );
});

/** A counter, a histogram and a gauge, the first two naming when each series began. */
const begun: readonly MetricsFamily[] = [
  {
    type: "counter",
    name: "chuggy_things_total",
    help: "Things.",
    samples: [
      { labels: { project: "web" }, value: 3, createdSecs: 1_767_225_610 },
      { labels: {}, value: 0.25, createdSecs: 1_767_225_600.5 },
    ],
  },
  {
    type: "histogram",
    name: "chuggy_wait_seconds",
    help: "Waits.",
    bounds: [0.5, 30, 60],
    samples: [
      {
        labels: { owner: "" },
        bucketCounts: [1, 0, 2, 4],
        sum: 900.5,
        createdSecs: 1_767_225_645,
      },
    ],
  },
  {
    type: "gauge",
    name: "chuggy_open",
    help: "Open.",
    samples: [{ labels: { phase: "Work" }, value: 2 }],
  },
];

test("in OpenMetrics a counter's family drops its _total, every series is followed by when it began, and # EOF ends the page", () => {
  assert.equal(
    metricsExpositionOpenMetrics(begun),
    [
      "# TYPE chuggy_things counter",
      "# HELP chuggy_things Things.",
      'chuggy_things_total{project="web"} 3',
      'chuggy_things_created{project="web"} 1767225610',
      "chuggy_things_total 0.25",
      "chuggy_things_created 1767225600.5",
      "# TYPE chuggy_wait_seconds histogram",
      "# HELP chuggy_wait_seconds Waits.",
      'chuggy_wait_seconds_bucket{owner="",le="0.5"} 1',
      'chuggy_wait_seconds_bucket{owner="",le="30.0"} 1',
      'chuggy_wait_seconds_bucket{owner="",le="60.0"} 3',
      'chuggy_wait_seconds_bucket{owner="",le="+Inf"} 7',
      'chuggy_wait_seconds_count{owner=""} 7',
      'chuggy_wait_seconds_sum{owner=""} 900.5',
      'chuggy_wait_seconds_created{owner=""} 1767225645',
      "# TYPE chuggy_open gauge",
      "# HELP chuggy_open Open.",
      'chuggy_open{phase="Work"} 2',
      "# EOF",
      "",
    ].join("\n"),
  );
});

test("a series with no time it began has no _created in OpenMetrics", () => {
  assert.equal(
    metricsExpositionOpenMetrics([
      {
        type: "counter",
        name: "chuggy_polls_total",
        help: "Polls.",
        samples: [{ labels: {}, value: 1 }],
      },
    ]),
    [
      "# TYPE chuggy_polls counter",
      "# HELP chuggy_polls Polls.",
      "chuggy_polls_total 1",
      "# EOF",
      "",
    ].join("\n"),
  );
});

test("the text format page is unchanged by when a series began", () => {
  const unbegun = begun.map((family): MetricsFamily =>
    family.type === "histogram"
      ? {
          ...family,
          samples: family.samples.map(({ labels, bucketCounts, sum }) => ({
            labels,
            bucketCounts,
            sum,
          })),
        }
      : {
          ...family,
          samples: family.samples.map(({ labels, value }) => ({
            labels,
            value,
          })),
        },
  );
  const page = metricsExposition(begun);
  assert.equal(page, metricsExposition(unbegun));
  assert.doesNotMatch(page, /_created|# EOF/u);
  assert.match(page, /^# TYPE chuggy_things_total counter$/mu);
});

test("in OpenMetrics help escapes its backslash, double quote and line feed, and a label value the same", () => {
  const page = metricsExpositionOpenMetrics([
    {
      type: "counter",
      name: "chuggy_escaped_total",
      help: 'Back\\slash, "quoted",\nand on.',
      samples: [{ labels: { model: 'a\\b"c\nd' }, value: 1 }],
    },
  ]);
  assert.equal(
    page,
    [
      "# TYPE chuggy_escaped counter",
      '# HELP chuggy_escaped Back\\\\slash, \\"quoted\\",\\nand on.',
      'chuggy_escaped_total{model="a\\\\b\\"c\\nd"} 1',
      "# EOF",
      "",
    ].join("\n"),
  );
});

test("OpenMetrics refuses a counter not named _total, a gauge naming when it began, and two families writing one sample name", () => {
  const counter = (name: string): MetricsFamily => ({
    type: "counter",
    name,
    help: "",
    samples: [],
  });
  const gauge = (name: string): MetricsFamily => ({
    type: "gauge",
    name,
    help: "",
    samples: [],
  });
  for (const families of [
    [counter("chuggy_things")],
    [counter("_total")],
    [
      {
        type: "gauge",
        name: "chuggy_open",
        help: "",
        samples: [{ labels: {}, value: 1, createdSecs: 1 }],
      },
    ],
    [counter("chuggy_x_total"), gauge("chuggy_x_created")],
    [counter("chuggy_x_total"), gauge("chuggy_x")],
    [
      gauge("chuggy_wait_count"),
      {
        type: "histogram",
        name: "chuggy_wait",
        help: "",
        bounds: [],
        samples: [],
      },
    ],
    [gauge("chuggy_open"), gauge("chuggy_open")],
    [
      {
        type: "counter",
        name: "chuggy_things_total",
        help: "",
        samples: [{ labels: {}, value: 1, createdSecs: Number.NaN }],
      },
    ],
  ] satisfies readonly (readonly MetricsFamily[])[])
    assert.throws(
      () => metricsExpositionOpenMetrics(families),
      RangeError,
      JSON.stringify(families),
    );
});

/** The Accept Prometheus sends for `scrape_protocols`, built as its scrape loop builds it. */
function prometheusAccept(protocols: readonly string[]): string {
  const headers: Readonly<Record<string, string>> = {
    PrometheusProto:
      "application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited",
    "PrometheusText0.0.4": "text/plain;version=0.0.4",
    "PrometheusText1.0.0": "text/plain;version=1.0.0;escaping=allow-utf-8",
    "OpenMetricsText0.0.1": "application/openmetrics-text;version=0.0.1",
    "OpenMetricsText1.0.0":
      "application/openmetrics-text;version=1.0.0;escaping=allow-utf-8",
  };
  let weight = Object.keys(headers).length + 1;
  const ranges = protocols.map(
    (protocol) => `${headers[protocol] ?? protocol};q=0.${String(weight--)}`,
  );
  return [...ranges, `*/*;q=0.${String(weight)}`].join(",");
}

test("the Accept Prometheus sends by default, and proto first, are answered in OpenMetrics", () => {
  const byDefault = prometheusAccept([
    "OpenMetricsText1.0.0",
    "OpenMetricsText0.0.1",
    "PrometheusText1.0.0",
    "PrometheusText0.0.4",
  ]);
  assert.equal(
    byDefault,
    "application/openmetrics-text;version=1.0.0;escaping=allow-utf-8;q=0.6,application/openmetrics-text;version=0.0.1;q=0.5,text/plain;version=1.0.0;escaping=allow-utf-8;q=0.4,text/plain;version=0.0.4;q=0.3,*/*;q=0.2",
  );
  assert.equal(metricsExpositionNegotiated(byDefault), "OpenMetrics");
  assert.equal(
    metricsExpositionNegotiated(
      prometheusAccept([
        "PrometheusProto",
        "OpenMetricsText1.0.0",
        "OpenMetricsText0.0.1",
        "PrometheusText1.0.0",
        "PrometheusText0.0.4",
      ]),
    ),
    "OpenMetrics",
  );
  assert.equal(
    metricsExpositionNegotiated(
      "application/openmetrics-text;version=1.0.0,application/openmetrics-text;version=0.0.1;q=0.75,text/plain;version=0.0.4;q=0.5,*/*;q=0.1",
    ),
    "OpenMetrics",
    "the Accept Prometheus 2 sent",
  );
  assert.equal(
    metricsExpositionNegotiated("Application/OpenMetrics-Text; Version=1.0.0"),
    "OpenMetrics",
  );
});

test("an Accept that asks for the text format first, names no format, or names none, is answered in the text format", () => {
  for (const accept of [
    undefined,
    "",
    "*/*",
    prometheusAccept(["PrometheusText0.0.4"]),
    prometheusAccept(["PrometheusText0.0.4", "OpenMetricsText1.0.0"]),
    prometheusAccept(["PrometheusText1.0.0", "OpenMetricsText0.0.1"]),
    "application/openmetrics-text;version=1.0.0;q=0,text/plain",
    "application/openmetrics-text;version=1.0.0;q=2",
    "application/openmetrics-text;version=2.0.0",
    "application/json",
    "text/plain;q=0.5,application/openmetrics-text;q=0.5",
  ])
    assert.equal(metricsExpositionNegotiated(accept), "Text", String(accept));
});
