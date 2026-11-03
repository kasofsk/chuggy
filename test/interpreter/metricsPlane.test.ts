/** The families a scrape totals rows to: the owner as a bare subject, rows a label cannot tell apart summed and begun at the earliest, and a page past its cap refused. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MetricsFamily } from "../../src/interpreter/metricsFamily.ts";
import {
  metricsPlane,
  metricsPlaneDurationBoundsSecs,
  metricsPlaneEscalationBoundsSecs,
  metricsPlaneFamilies,
  metricsPlaneOwner,
  metricsPlaneTicketCostBoundsUsd,
  metricsPlaneTicketReworkBounds,
  metricsPlaneTicketTimeBoundsSecs,
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
  ticketEvents: [],
  leadTimes: [],
  runTimes: [],
  reworks: [],
  costs: [],
  escalations: [],
  agentPauses: [],
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
      { task, turns: 2, durationMs: 1_500, durationApiMs: 500, createdSecs: 1 },
      {
        task: { ...task, owner: "" },
        turns: 3,
        durationMs: 0,
        durationApiMs: 0,
        createdSecs: 1,
      },
      {
        task: { ...task, owner: "" },
        turns: 4,
        durationMs: 0,
        durationApiMs: 0,
        createdSecs: 1,
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

test("an attempt's state labels its count and not its duration, whose buckets and milliseconds are summed across states before scaling", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    attempts: [
      {
        task,
        state: "Reported",
        buckets: bucketsAt(1, 2),
        ended: 2,
        durationMs: 100_100,
        createdSecs: 20,
      },
      {
        task,
        state: "Lost",
        buckets: bucketsAt(12, 1),
        ended: 1,
        durationMs: 9_000_200,
        createdSecs: 10,
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
      sum: 9_100.3,
      createdSecs: 10,
    },
  ]);
});

test("an attempt row of the wrong buckets is refused", () => {
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
            durationMs: 1_000,
            createdSecs: 1,
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
        createdSecs: 1,
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
    createdSecs: ended,
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
        createdSecs: 1,
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

test("each counter and histogram series began at the earliest row it sums, and the tickets gauge at no time", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    runs: [300, 100, 200].map((createdSecs) => ({
      task,
      turns: 1,
      durationMs: 0,
      durationApiMs: 0,
      createdSecs,
    })),
    turns: [
      leadTurn("Answered", "model-large", 7),
      leadTurn("Answered", "model-large", 3),
    ],
    tickets: [
      {
        tenant: "acme",
        project: "web",
        owner: "alice-id",
        phase: "Escalated",
        escalation: "WorkFailureEscalated",
        tickets: 2,
      },
    ],
  });
  for (const name of [
    "chuggy_run_turns_total",
    "chuggy_run_duration_seconds_total",
    "chuggy_run_api_duration_seconds_total",
  ])
    assert.deepEqual(
      family(families, name).samples.map((sample) => sample.createdSecs),
      [100],
      name,
    );
  for (const name of [
    "chuggy_session_turns_ended_total",
    "chuggy_session_turn_tokens_total",
    "chuggy_session_turn_cost_usd_total",
    "chuggy_session_turn_duration_seconds",
  ])
    assert.deepEqual(
      family(families, name).samples.map((sample) => sample.createdSecs),
      [3],
      name,
    );
  assert.deepEqual(family(families, "chuggy_tickets").samples, [
    {
      labels: {
        tenant: "acme",
        project: "web",
        owner: "alice-id",
        phase: "Escalated",
        escalation: "WorkFailureEscalated",
      },
      value: 2,
    },
  ]);
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
      (phase) => ({
        tenant: "acme",
        project: "web",
        owner: "",
        phase,
        escalation: "NoEscalation" as const,
        tickets: 1,
      }),
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

test("a series' time it began is one more series against the cap", async () => {
  const run = {
    task,
    turns: 1,
    durationMs: 0,
    durationApiMs: 0,
    createdSecs: 1,
  };
  assert.deepEqual(
    await metricsPlane(
      {
        read: () =>
          Promise.resolve({ read: "Read", rows: { ...empty, runs: [run] } }),
      },
      { issuer, seriesMax: 5 },
    ).scrape(),
    {
      scraped: "Refused",
      why: "the page would carry 6 series, past the cap of 5",
    },
  );
});

/** A bucket vector over `bounds` with `count` at `index` and nothing elsewhere. */
function boundedAt(
  bounds: readonly number[],
  index: number,
  count: number,
): readonly number[] {
  return [...bounds, Infinity].map((_, at) => (at === index ? count : 0));
}

const owned = { tenant: "acme", project: "web", owner: "alice-id" };

/** The ticket histograms of one owner's rows: a lead time, two reworks rows, a cost and an escalation. */
const ticketFamilies = () =>
  metricsPlaneFamilies({
    ...empty,
    leadTimes: [
      {
        ...owned,
        buckets: boundedAt(metricsPlaneTicketTimeBoundsSecs, 2, 1),
        sum: 3_600_500,
        createdSecs: 5,
      },
    ],
    reworks: [
      {
        ...owned,
        buckets: boundedAt(metricsPlaneTicketReworkBounds, 0, 2),
        sum: 0,
        createdSecs: 9,
      },
      {
        ...owned,
        buckets: boundedAt(metricsPlaneTicketReworkBounds, 3, 1),
        sum: 3,
        createdSecs: 4,
      },
    ],
    costs: [
      {
        ...owned,
        end: "Revoked",
        buckets: boundedAt(metricsPlaneTicketCostBoundsUsd, 1, 1),
        sum: 750_001,
        createdSecs: 7,
      },
    ],
    escalations: [
      {
        ...owned,
        event: "TicketWorkProcessFailed",
        by: "ExecutionScheduler",
        buckets: boundedAt(metricsPlaneEscalationBoundsSecs, 0, 1),
        sum: 1_250,
        createdSecs: 8,
      },
    ],
  });

/** The samples of the ticket histogram `name`. */
function ticketHistogram(name: string) {
  const found = family(ticketFamilies(), name);
  assert.equal(found.type, "histogram", name);
  return found.type === "histogram" ? found.samples : undefined;
}

test("a ticket's times are seconds and its reworks counts, each bucketed by its own bounds", () => {
  assert.deepEqual(ticketHistogram("chuggy_ticket_lead_time_seconds"), [
    {
      labels: owned,
      bucketCounts: boundedAt(metricsPlaneTicketTimeBoundsSecs, 2, 1),
      sum: 3_600.5,
      createdSecs: 5,
    },
  ]);
  assert.deepEqual(ticketHistogram("chuggy_ticket_reworks"), [
    {
      labels: owned,
      bucketCounts: boundedAt(metricsPlaneTicketReworkBounds, 0, 2).map(
        (count, index) => count + (index === 3 ? 1 : 0),
      ),
      sum: 3,
      createdSecs: 4,
    },
  ]);
  assert.deepEqual(ticketHistogram("chuggy_ticket_run_time_seconds"), []);
});

test("a ticket's cost is dollars and an escalation's duration seconds, each bucketed by its own bounds", () => {
  assert.deepEqual(ticketHistogram("chuggy_ticket_cost_usd"), [
    {
      labels: { ...owned, end: "Revoked" },
      bucketCounts: boundedAt(metricsPlaneTicketCostBoundsUsd, 1, 1),
      sum: 0.750001,
      createdSecs: 7,
    },
  ]);
  assert.deepEqual(
    ticketHistogram("chuggy_ticket_escalation_duration_seconds"),
    [
      {
        labels: {
          ...owned,
          event: "TicketWorkProcessFailed",
          by: "ExecutionScheduler",
        },
        bucketCounts: boundedAt(metricsPlaneEscalationBoundsSecs, 0, 1),
        sum: 1.25,
        createdSecs: 8,
      },
    ],
  );
});

test("a ticket histogram's row bucketed by another family's bounds is refused", () => {
  assert.throws(
    () =>
      metricsPlaneFamilies({
        ...empty,
        reworks: [
          {
            ...owned,
            buckets: boundedAt(metricsPlaneTicketTimeBoundsSecs, 0, 1),
            sum: 0,
            createdSecs: 1,
          },
        ],
      }),
    RangeError,
  );
});

test("every journal entry is counted by its event and the stage its report names", () => {
  const events = family(
    metricsPlaneFamilies({
      ...empty,
      ticketEvents: [
        {
          ...owned,
          event: "TicketCreated",
          stage: "",
          entries: 2,
          createdSecs: 3,
        },
        {
          ...owned,
          event: "TicketEvaluationReworkStarted",
          stage: "checks",
          entries: 1,
          createdSecs: 6,
        },
      ],
    }),
    "chuggy_ticket_events_total",
  );
  assert.deepEqual(events.type === "histogram" ? [] : events.samples, [
    {
      labels: { ...owned, event: "TicketCreated", stage: "" },
      value: 2,
      createdSecs: 3,
    },
    {
      labels: {
        ...owned,
        event: "TicketEvaluationReworkStarted",
        stage: "checks",
      },
      value: 1,
      createdSecs: 6,
    },
  ]);
});

test("the paused gauge counts each owner's paused accounts per agent and trigger, at no time, and names no account not paused as paused", () => {
  const families = metricsPlaneFamilies({
    ...empty,
    agentPauses: [
      { owner: "alice-id", agent: "Claude", trigger: "soft", paused: 1 },
      { owner: "alice-id", agent: "Claude", trigger: "hard", paused: 0 },
      { owner: "", agent: "Codex", trigger: "hard", paused: 1 },
      { owner: "", agent: "Codex", trigger: "hard", paused: 1 },
      { owner: "", agent: "Codex", trigger: "soft", paused: 0 },
    ],
  });
  const paused = family(families, "chuggy_agent_paused");
  assert.equal(paused.type, "gauge");
  assert.deepEqual(paused.samples, [
    {
      labels: { owner: "alice-id", agent: "Claude", trigger: "soft" },
      value: 1,
    },
    {
      labels: { owner: "alice-id", agent: "Claude", trigger: "hard" },
      value: 0,
    },
    { labels: { owner: "", agent: "Codex", trigger: "hard" }, value: 2 },
    { labels: { owner: "", agent: "Codex", trigger: "soft" }, value: 0 },
  ]);
  assert.deepEqual(
    family(metricsPlaneFamilies(empty), "chuggy_agent_paused").samples,
    [],
  );
});
