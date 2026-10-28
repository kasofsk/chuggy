/** Metric families in the Prometheus text format: escaping, cumulative buckets, and a name the format cannot carry refused. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { metricsExposition } from "../../src/adapters/http/metricsExposition.ts";

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
