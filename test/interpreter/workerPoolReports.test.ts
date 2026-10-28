/** What the pool plane holds of its runners and serves: a runner's series only beside its report, each gone past its age, and no more runners than the bound. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { metricsExposition } from "../../src/adapters/http/metricsExposition.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  workerPoolReportAgeMsMax,
  workerPoolReports,
  type WorkerPoolReporter,
} from "../../src/interpreter/workerPoolReports.ts";
import { workerRunnerReportLeast } from "../contract/workerRunnerReportFixture.ts";

const issuer = "https://issuer.test";

const pool: WorkerPoolReporter = {
  kind: "Dedicated",
  partition: { tenant: "acme", project: "web" } as Partition,
  pool: "pool-one",
  principal: oidcPrincipal(issuer, "chuggy-pool-one"),
};

const personal: WorkerPoolReporter = {
  kind: "Personal",
  tenant: pool.partition.tenant,
  owner: oidcPrincipal(issuer, "alice-id"),
  principal: oidcPrincipal(issuer, "chuggy-personal-one"),
};

/** A holder under a clock the case moves. */
function holding(runnersMax = 4) {
  const clock = { nowMs: 1_000_000 };
  return {
    clock,
    reports: workerPoolReports({
      issuer,
      runnersMax,
      ageMsMax: workerPoolReportAgeMsMax,
      now: () => clock.nowMs,
    }),
  };
}

/** The page's sample lines of the family `name`. */
function samples(
  reports: ReturnType<typeof holding>["reports"],
  name: string,
): readonly string[] {
  return metricsExposition(reports.families())
    .split("\n")
    .filter((line) => line.startsWith(`${name}{`));
}

const poolLabels =
  'tenant="acme",project="web",pool="pool-one",owner="",personal_runner="",host="build-box.local"';

test("a pool's report is served under its tenant, project and pool, and a personal runner's under its owner's bare subject and its client", () => {
  const { reports } = holding();
  reports.reported(pool, workerRunnerReportLeast);
  reports.reported(personal, workerRunnerReportLeast);
  assert.deepEqual(samples(reports, "chuggy_runner_jobs_running"), [
    `chuggy_runner_jobs_running{${poolLabels}} 1`,
    'chuggy_runner_jobs_running{tenant="acme",project="",pool="",owner="alice-id",personal_runner="chuggy-personal-one",host="build-box.local"} 1',
  ]);
});

test("a personal runner under another issuer is served with no owner and no client", () => {
  const { reports } = holding();
  reports.reported(
    {
      ...personal,
      owner: oidcPrincipal("https://elsewhere.test", "alice-id"),
      principal: oidcPrincipal("https://elsewhere.test", "chuggy-personal-one"),
    },
    workerRunnerReportLeast,
  );
  assert.deepEqual(samples(reports, "chuggy_runner_jobs_running"), [
    'chuggy_runner_jobs_running{tenant="acme",project="",pool="",owner="",personal_runner="",host="build-box.local"} 1',
  ]);
});

test("a report's counts are served under every label of their roster, and a field it left out is no series", () => {
  const { reports } = holding();
  reports.reported(pool, workerRunnerReportLeast);
  assert.deepEqual(samples(reports, "chuggy_runner_settlements_total"), [
    `chuggy_runner_settlements_total{${poolLabels},outcome="Accepted"} 3`,
    `chuggy_runner_settlements_total{${poolLabels},outcome="Refused"} 0`,
    `chuggy_runner_settlements_total{${poolLabels},outcome="Unavailable"} 0`,
  ]);
  assert.deepEqual(samples(reports, "chuggy_runner_disk_free_bytes"), []);
  assert.deepEqual(
    samples(reports, "chuggy_runner_image_pull_seconds_bucket").slice(-1),
    [`chuggy_runner_image_pull_seconds_bucket{${poolLabels},le="+Inf"} 1`],
  );
  assert.deepEqual(samples(reports, "chuggy_runner_run_seconds_count"), [
    `chuggy_runner_run_seconds_count{${poolLabels},kind="Job"} 0`,
    `chuggy_runner_run_seconds_count{${poolLabels},kind="Session"} 0`,
  ]);
});

test("a report older than the age bound is no series, and the next one is served again", () => {
  const { clock, reports } = holding();
  reports.reported(pool, workerRunnerReportLeast);
  clock.nowMs += workerPoolReportAgeMsMax;
  assert.equal(samples(reports, "chuggy_runner_uptime_seconds").length, 1);
  clock.nowMs += 1;
  assert.deepEqual(
    reports.families().flatMap((family): readonly unknown[] => family.samples),
    [],
  );
  reports.reported(pool, workerRunnerReportLeast);
  assert.equal(samples(reports, "chuggy_runner_uptime_seconds").length, 1);
});

test("a runner that polls and never reports has no series; once it reports its poll's are served beside the report's, and both go when the report expires", () => {
  const { clock, reports } = holding();
  reports.polled(pool, {
    runner: { package: "chuggy-linux", version: "0.14.1" },
    memoryRoomMib: 512,
    memoryCeilingMib: 1_024,
  });
  assert.deepEqual(
    reports.families().flatMap((family): readonly unknown[] => family.samples),
    [],
  );
  clock.nowMs += 1_000;
  reports.reported(pool, workerRunnerReportLeast);
  assert.deepEqual(samples(reports, "chuggy_runner_info"), [
    `chuggy_runner_info{${poolLabels},package="chuggy-linux",version="0.14.1"} 1`,
  ]);
  assert.deepEqual(
    samples(reports, "chuggy_runner_last_poll_timestamp_seconds"),
    [`chuggy_runner_last_poll_timestamp_seconds{${poolLabels}} 1000`],
  );
  assert.deepEqual(
    samples(reports, "chuggy_runner_last_report_timestamp_seconds"),
    [`chuggy_runner_last_report_timestamp_seconds{${poolLabels}} 1001`],
  );
  assert.deepEqual(samples(reports, "chuggy_runner_memory_room_bytes"), [
    `chuggy_runner_memory_room_bytes{${poolLabels}} 536870912`,
  ]);
  assert.deepEqual(samples(reports, "chuggy_runner_memory_ceiling_bytes"), [
    `chuggy_runner_memory_ceiling_bytes{${poolLabels}} 1073741824`,
  ]);
  clock.nowMs += workerPoolReportAgeMsMax - 1;
  reports.polled(pool, {});
  clock.nowMs += 2;
  assert.deepEqual(
    reports.families().flatMap((family): readonly unknown[] => family.samples),
    [],
  );
  reports.reported(pool, workerRunnerReportLeast);
  assert.equal(
    samples(reports, "chuggy_runner_last_poll_timestamp_seconds").length,
    1,
  );
  assert.deepEqual(samples(reports, "chuggy_runner_info"), []);
});

test("past the runners bound the runner heard from least recently is dropped whole", () => {
  const { clock, reports } = holding(2);
  const runner = (client: string): WorkerPoolReporter => ({
    ...personal,
    principal: oidcPrincipal(issuer, client),
  });
  reports.reported(runner("one"), workerRunnerReportLeast);
  reports.polled(runner("two"), {});
  clock.nowMs += 1;
  reports.reported(runner("one"), workerRunnerReportLeast);
  reports.reported(runner("three"), workerRunnerReportLeast);
  reports.reported(runner("two"), workerRunnerReportLeast);
  assert.deepEqual(
    samples(reports, "chuggy_runner_last_poll_timestamp_seconds"),
    [],
  );
  assert.deepEqual(
    samples(reports, "chuggy_runner_jobs_running").map(
      (line) => /personal_runner="([^"]*)"/u.exec(line)?.[1],
    ),
    ["three", "two"],
  );
});
