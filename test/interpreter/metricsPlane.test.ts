/** The families a scrape totals rows to: the owner as a bare subject, rows a label cannot tell apart summed, and a page past its cap refused. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MetricsFamily } from "../../src/interpreter/metricsFamily.ts";
import {
  metricsPlane,
  metricsPlaneDurationBoundsSecs,
  metricsPlaneFamilies,
  metricsPlaneOwner,
  type MetricsPlaneBounds,
  type MetricsPlaneRead,
  type MetricsPlaneRows,
  type MetricsPlaneTask,
  type MetricsPlaneTurnRow,
} from "../../src/interpreter/metricsPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";

const issuer = "https://issuer.test";

const task: MetricsPlaneTask = {
  tenant: "acme",
  project: "web",
  owner: "alice-id",
  phase: "Evaluation",
  stage: "checks",
  runner: "Commands",
  workload: "tests",
  placement: "Personal",
};

const empty: MetricsPlaneRows = {
  attempts: [],
  runs: [],
  models: [],
  turns: [],
  tickets: [],
};

function family(
  families: readonly MetricsFamily[],
  name: string,
): MetricsFamily {
  const found = families.find((each) => each.name === name);
  assert.ok(found !== undefined, name);
  return found;
}

/** A bucket vector with `count` at `index` and nothing elsewhere. */
function bucketsAt(index: number, count: number): readonly number[] {
  return [...metricsPlaneDurationBoundsSecs, Infinity].map((_, at) =>
    at === index ? count : 0,
  );
}

test("the owner is the bare subject under the plane's issuer, and empty under another issuer's", () => {
  assert.equal(
    metricsPlaneOwner(issuer, oidcPrincipal(issuer, "alice-id")),
    "alice-id",
  );
  assert.equal(
    metricsPlaneOwner(issuer, oidcPrincipal("https://other.test", "carol")),
    "",
  );
});

test("rows a label cannot tell apart are one series, and a run's durations are seconds", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    runs: [
      { task, turns: 2, durationMs: 1_500, durationApiMs: 500 },
      {
        task: { ...task, owner: "" },
        turns: 3,
        durationMs: 0,
        durationApiMs: 0,
      },
      {
        task: { ...task, owner: "" },
        turns: 4,
        durationMs: 0,
        durationApiMs: 0,
      },
    ],
  });
  const turns = family(families, "chuggy_run_turns_total");
  assert.deepEqual(
    turns.type === "histogram"
      ? []
      : turns.samples.map((sample) => [sample.labels["owner"], sample.value]),
    [
      ["alice-id", 2],
      ["", 7],
    ],
  );
  const duration = family(families, "chuggy_run_duration_seconds_total");
  assert.equal(
    duration.type === "histogram" ? undefined : duration.samples[0]?.value,
    1.5,
  );
});

test("an attempt's state labels its count and not its duration, whose buckets are summed across states", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    attempts: [
      {
        task,
        state: "Reported",
        buckets: bucketsAt(1, 2),
        ended: 2,
        durationSecs: 100,
      },
      {
        task,
        state: "Lost",
        buckets: bucketsAt(12, 1),
        ended: 1,
        durationSecs: 9_000,
      },
    ],
  });
  const ended = family(families, "chuggy_attempts_ended_total");
  assert.deepEqual(
    ended.type === "histogram"
      ? []
      : ended.samples.map((sample) => [sample.labels["state"], sample.value]),
    [
      ["Reported", 2],
      ["Lost", 1],
    ],
  );
  const durations = family(families, "chuggy_attempt_duration_seconds");
  assert.equal(durations.type, "histogram");
  assert.deepEqual(durations.samples, [
    {
      labels: {
        tenant: "acme",
        project: "web",
        owner: "alice-id",
        phase: "Evaluation",
        stage: "checks",
        runner: "Commands",
        placement: "Personal",
        workload: "tests",
      },
      bucketCounts: bucketsAt(1, 2).map(
        (count, index) => count + (index === 12 ? 1 : 0),
      ),
      sum: 9_100,
    },
  ]);
  assert.throws(
    () =>
      metricsPlaneFamilies({
        ...empty,
        attempts: [
          {
            task,
            state: "Reported",
            buckets: bucketsAt(1, 1).slice(1),
            ended: 1,
            durationSecs: 1,
          },
        ],
      }),
    RangeError,
  );
});

test("a run's tokens are one series per kind, and its cost is dollars", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    models: [
      {
        task,
        model: "model-large",
        tokensInput: 1,
        tokensOutput: 2,
        tokensCacheCreation: 3,
        tokensCacheRead: 4,
        costUsdMicros: 1_250_000,
      },
    ],
  });
  const tokens = family(families, "chuggy_run_tokens_total");
  assert.deepEqual(
    tokens.type === "histogram"
      ? []
      : tokens.samples.map((sample) => [sample.labels["type"], sample.value]),
    [
      ["input", 1],
      ["output", 2],
      ["cache_creation", 3],
      ["cache_read", 4],
    ],
  );
  const cost = family(families, "chuggy_run_cost_usd_total");
  assert.equal(
    cost.type === "histogram" ? undefined : cost.samples[0]?.value,
    1.25,
  );
});

/** One ended turn of the lead's session, measured where it names a model. */
function leadTurn(
  state: string,
  model: string | undefined,
  ended: number,
): MetricsPlaneTurnRow {
  return {
    tenant: "acme",
    project: "web",
    owner: "selector",
    session: "Lead",
    state,
    model,
    buckets: model === undefined ? undefined : bucketsAt(0, ended),
    ended,
    tokens: model === undefined ? 0 : 10,
    costMicros: model === undefined ? 0 : 500,
    durationMs: model === undefined ? 0 : 2_000,
  };
}

test("every ended session turn is counted, and only a measured one spends or is timed", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    turns: [
      leadTurn("Answered", "model-large", 1),
      leadTurn("Failed", undefined, 4),
    ],
  });
  const turnCost = family(families, "chuggy_session_turn_cost_usd_total");
  assert.deepEqual(
    turnCost.type === "histogram" ? undefined : turnCost.samples,
    [
      {
        labels: {
          tenant: "acme",
          project: "web",
          owner: "selector",
          session: "Lead",
          model: "model-large",
        },
        value: 0.0005,
      },
    ],
    "an unmeasured turn spends nothing",
  );
  const ended = family(families, "chuggy_session_turns_ended_total");
  assert.equal(ended.samples.length, 2, "an unmeasured turn has still ended");
  const durations = family(families, "chuggy_session_turn_duration_seconds");
  assert.deepEqual(
    durations.type === "histogram"
      ? durations.samples.map((sample) => [sample.bucketCounts, sample.sum])
      : [],
    [[bucketsAt(0, 1), 2]],
  );
});

test("a read's refusal is the scrape's, and a page past its series is refused rather than cut", async () => {
  const reading = (read: MetricsPlaneRead) => ({
    read: (bounds: MetricsPlaneBounds) => {
      assert.equal(
        bounds.seriesMax,
        4,
        "the read is bounded by the series cap",
      );
      assert.equal(
        bounds.owner(oidcPrincipal(issuer, "alice-id")),
        "alice-id",
        "the read names owners under the plane's issuer",
      );
      return Promise.resolve(read);
    },
  });
  assert.deepEqual(
    await metricsPlane(reading({ read: "Refused", why: "too many" }), {
      issuer,
      seriesMax: 4,
    }).scrape(),
    { scraped: "Refused", why: "too many" },
  );
  const tickets: MetricsPlaneRows = {
    ...empty,
    tickets: ["Pending", "Work", "Evaluation", "Done", "Revoked"].map(
      (phase) => ({ tenant: "acme", project: "web", phase, tickets: 1 }),
    ),
  };
  assert.deepEqual(
    await metricsPlane(reading({ read: "Read", rows: tickets }), {
      issuer,
      seriesMax: 4,
    }).scrape(),
    {
      scraped: "Refused",
      why: "the page would carry 5 series, past the cap of 4",
    },
  );
  const page = await metricsPlane(
    reading({
      read: "Read",
      rows: { ...tickets, tickets: tickets.tickets.slice(1) },
    }),
    { issuer, seriesMax: 4 },
  ).scrape();
  assert.equal(page.scraped, "Page");
});
