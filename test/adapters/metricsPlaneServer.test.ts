/** The metrics plane's routes: a page in the text format, a refusal or a failed read answered 503 with no series, and its probes. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createMetricsPlaneApp } from "../../src/adapters/http/metricsPlaneServer.ts";
import type { MetricsPlaneScrape } from "../../src/interpreter/metricsPlane.ts";

async function scraped(
  scrape: () => Promise<MetricsPlaneScrape>,
  url = "/metrics",
  ready = true,
) {
  const app = createMetricsPlaneApp({
    scrape,
    ready: () => Promise.resolve(ready),
  });
  try {
    return await app.inject({ method: "GET", url });
  } finally {
    await app.close();
  }
}

test("a scrape is answered with its page in the text format", async () => {
  const answered = await scraped(() =>
    Promise.resolve({
      scraped: "Page",
      families: [
        {
          type: "gauge",
          name: "chuggy_tickets",
          help: "Tickets.",
          samples: [{ labels: { phase: "Done" }, value: 1 }],
        },
      ],
    }),
  );
  assert.equal(answered.statusCode, 200);
  assert.equal(
    answered.headers["content-type"],
    "text/plain; version=0.0.4; charset=utf-8",
  );
  assert.match(answered.body, /^chuggy_tickets\{phase="Done"\} 1$/mu);
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
