/** The pool plane's second listener: none where no port is named, and the held reports served as a page where one is, in the format the scraper asks for. */

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";

import {
  metricsExpositionContentType,
  metricsExpositionOpenMetricsContentType,
} from "../../src/adapters/http/metricsExposition.ts";
import {
  poolPlaneMetricsAddressRead,
  poolPlaneMetricsListening,
} from "../../src/adapters/http/poolPlaneMetrics.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  workerPoolReportAgeMsMax,
  workerPoolReports,
} from "../../src/interpreter/workerPoolReports.ts";
import { workerRunnerReportLeast } from "../contract/workerRunnerReportFixture.ts";

function reports() {
  return workerPoolReports({
    issuer: "https://issuer.test",
    runnersMax: 1,
    ageMsMax: workerPoolReportAgeMsMax,
    now: Date.now,
  });
}

/** A port nothing listens on as this case starts. */
async function portFree(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  if (address === null || typeof address === "string")
    throw new Error("no port was bound");
  return address.port;
}

test("a plane naming no metrics port names no address, and one naming no port number refuses its start", () => {
  for (const port of [undefined, ""])
    assert.deepEqual(poolPlaneMetricsAddressRead("0.0.0.0", port), {
      read: "None",
    });
  for (const port of ["0", "03002", "65536", "metrics", "-1"])
    assert.equal(
      poolPlaneMetricsAddressRead(undefined, port).read,
      "Refused",
      port,
    );
  assert.deepEqual(poolPlaneMetricsAddressRead(undefined, "9464"), {
    read: "Address",
    host: "127.0.0.1",
    port: 9464,
  });
});

test("with no metrics port there is no listener", async () => {
  assert.equal(
    await poolPlaneMetricsListening(reports(), { read: "None" }),
    undefined,
  );
});

test("with a metrics port the held reports are served there as a page", async () => {
  const held = reports();
  held.reported(
    {
      kind: "Dedicated",
      partition: { tenant: "acme", project: "web" } as Partition,
      pool: "pool-one",
      principal: oidcPrincipal("https://issuer.test", "chuggy-pool-one"),
    },
    workerRunnerReportLeast,
  );
  const port = await portFree();
  const app = await poolPlaneMetricsListening(held, {
    read: "Address",
    host: "127.0.0.1",
    port,
  });
  assert.ok(app !== undefined);
  try {
    const answered = await fetch(`http://127.0.0.1:${String(port)}/metrics`);
    assert.equal(answered.status, 200);
    assert.equal(
      answered.headers.get("content-type"),
      metricsExpositionContentType,
    );
    assert.match(
      await answered.text(),
      /^chuggy_runner_jobs_running\{tenant="acme",project="web",pool="pool-one",owner="",personal_runner="",host="build-box\.local"\} 1$/mu,
    );
    const open = await fetch(`http://127.0.0.1:${String(port)}/metrics`, {
      headers: { accept: "application/openmetrics-text;version=1.0.0" },
    });
    assert.equal(open.status, 200);
    assert.equal(
      open.headers.get("content-type"),
      metricsExpositionOpenMetricsContentType,
    );
    const page = await open.text();
    assert.match(page, /^# TYPE chuggy_runner_polls counter$/mu);
    assert.match(page, /^chuggy_runner_polls_total\{/mu);
    assert.match(page, /\n# EOF\n$/u);
  } finally {
    await app.close();
  }
});
