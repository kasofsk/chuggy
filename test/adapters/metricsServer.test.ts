import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMetricsApp,
  metricsExpositionMediaType,
} from "../../src/adapters/http/metricsServer.ts";
import {
  executionMetricHelp,
  executionMetricsDocument,
} from "../../src/interpreter/executionMetrics.ts";

test("every exported name is declared, so a zero is not read as an absence", () => {
  const document = executionMetricsDocument([]);
  for (const name of Object.keys(executionMetricHelp)) {
    assert.match(document, new RegExp(`# HELP ${name} `, "u"));
    assert.match(document, new RegExp(`# TYPE ${name} `, "u"));
  }
});

test("a label value that would end a label is escaped rather than trusted", () => {
  const document = executionMetricsDocument([
    {
      name: "chug_ticket_executions",
      labels: { tenant: 'ac"me', project: "at\\las", state: "Running" },
      value: 3,
    },
  ]);
  assert.match(
    document,
    /chug_ticket_executions\{project="at\\\\las",state="Running",tenant="ac\\"me"\} 3/u,
  );
});

test("a label nothing named is left off the series rather than exported empty", () => {
  const document = executionMetricsDocument([
    {
      name: "chug_ticket_execution_run_turns",
      labels: { tenant: "acme", project: "atlas", kind: "" },
      value: 7,
    },
  ]);
  assert.match(
    document,
    /chug_ticket_execution_run_turns\{project="atlas",tenant="acme"\} 7/u,
  );
});

test("a scrape reads the exposition it asked for", async () => {
  const app = createMetricsApp({
    samples: (silenceSecs) =>
      Promise.resolve([
        {
          name: "chug_ticket_execution_workloads_silent",
          labels: { tenant: "acme", project: "atlas" },
          value: silenceSecs === 300 ? 1 : 0,
        },
      ]),
    silenceSecs: 300,
  });
  const response = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["content-type"], metricsExpositionMediaType);
  assert.match(
    response.body,
    /chug_ticket_execution_workloads_silent\{project="atlas",tenant="acme"\} 1/u,
  );
});

test("a scrape that could not read reports failure rather than an empty exposition", async () => {
  const app = createMetricsApp({
    samples: () => Promise.reject(new Error("the database would not answer")),
    silenceSecs: 300,
  });
  const response = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.headers["retry-after"], "5");
});
