/** The metrics plane's routes: a page in the format the scraper's `Accept` asks for, a refusal, a failed read or a page the format refuses answered 503 with no series, and its probes. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createMetricsPlaneApp } from "../../src/adapters/http/metricsPlaneServer.ts";
import type { MetricsPlaneScrape } from "../../src/interpreter/metricsPlane.ts";

async function scraped(
  scrape: () => Promise<MetricsPlaneScrape>,
  url = "/metrics",
  ready = true,
  accept?: string,
) {
  const app = createMetricsPlaneApp({
    scrape,
    ready: () => Promise.resolve(ready),
  });
  try {
    return await app.inject({
      method: "GET",
      url,
      headers: accept === undefined ? {} : { accept },
    });
  } finally {
    await app.close();
  }
}

const page = (): Promise<MetricsPlaneScrape> =>
  Promise.resolve({
    scraped: "Page",
    families: [
      {
        type: "gauge",
        name: "chuggy_tickets",
        help: "Tickets.",
        samples: [{ labels: { phase: "Done" }, value: 1 }],
      },
      {
        type: "counter",
        name: "chuggy_runs_total",
        help: "Runs.",
        samples: [{ labels: {}, value: 2, createdSecs: 1_767_225_600 }],
      },
    ],
  });

test("a scrape asking for no format is answered with its page in the text format", async () => {
  const answered = await scraped(page);
  assert.equal(answered.statusCode, 200);
  assert.equal(
    answered.headers["content-type"],
    "text/plain; version=0.0.4; charset=utf-8",
  );
  assert.equal(answered.headers["vary"], "Accept");
  assert.match(answered.body, /^chuggy_tickets\{phase="Done"\} 1$/mu);
  assert.doesNotMatch(answered.body, /_created|# EOF/u);
});

test("a scrape asking for OpenMetrics, as Prometheus does, is answered in it", async () => {
  const answered = await scraped(
    page,
    "/metrics",
    true,
    "application/openmetrics-text;version=1.0.0;escaping=allow-utf-8;q=0.6,application/openmetrics-text;version=0.0.1;q=0.5,text/plain;version=1.0.0;escaping=allow-utf-8;q=0.4,text/plain;version=0.0.4;q=0.3,*/*;q=0.2",
  );
  assert.equal(answered.statusCode, 200);
  assert.equal(
    answered.headers["content-type"],
    "application/openmetrics-text; version=1.0.0; charset=utf-8",
  );
  assert.equal(answered.headers["vary"], "Accept");
  assert.match(answered.body, /^chuggy_runs_created 1767225600$/mu);
  assert.match(answered.body, /^# EOF\n$/mu);
});

test("a scrape asking for the text format first is answered in it", async () => {
  const answered = await scraped(
    page,
    "/metrics",
    true,
    "text/plain;version=0.0.4;q=0.6,application/openmetrics-text;version=1.0.0;q=0.5,*/*;q=0.4",
  );
  assert.equal(
    answered.headers["content-type"],
    "text/plain; version=0.0.4; charset=utf-8",
  );
});

test("families OpenMetrics refuses to write are 503 and carry no series", async () => {
  const answered = await scraped(
    () =>
      Promise.resolve({
        scraped: "Page",
        families: [
          {
            type: "counter",
            name: "chuggy_runs",
            help: "Runs.",
            samples: [{ labels: {}, value: 1 }],
          },
        ],
      }),
    "/metrics",
    true,
    "application/openmetrics-text;version=1.0.0",
  );
  assert.equal(answered.statusCode, 503);
  assert.doesNotMatch(answered.body, /chuggy_/u);
});

test("a refused scrape and a failed read are each 503 and carry no series", async () => {
  for (const scrape of [
    () =>
      Promise.resolve<MetricsPlaneScrape>({
        scraped: "Refused",
        why: "past the cap",
      }),
    () =>
      Promise.reject(new Error("canceling statement due to statement timeout")),
  ]) {
    const answered = await scraped(scrape);
    assert.equal(answered.statusCode, 503);
    assert.doesNotMatch(answered.body, /chuggy_|cap|statement/u);
  }
});

test("the plane's probes answer beside the page", async () => {
  const never = () => Promise.reject(new Error("not scraped"));
  assert.equal((await scraped(never, "/health/live")).statusCode, 200);
  assert.equal((await scraped(never, "/health/ready")).statusCode, 200);
  assert.equal((await scraped(never, "/health/ready", false)).statusCode, 503);
});
