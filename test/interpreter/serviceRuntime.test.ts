import assert from "node:assert/strict";
import { test } from "node:test";

import {
  journalLegalityPrecondition,
  runtimeMigrationPlan,
  schemaCompatibilityPrecondition,
  serviceRuntime,
} from "../../src/interpreter/serviceRuntime.ts";

const pacing = {
  wait: (milliseconds: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    }),
};
const runtimeConfig = {
  idleIntervalMilliseconds: 1,
  shutdownDrainMilliseconds: 10,
};

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("runtime did not make progress");
}

test("a service starts, reports readiness, runs bounded quanta and stops", async () => {
  let passes = 0;
  const runtime = serviceRuntime(
    { run: () => Promise.resolve(void (passes += 1)) },
    pacing,
    [
      {
        name: "schema-compatible",
        check: () => Promise.resolve({ met: "Met" as const }),
      },
    ],
    runtimeConfig,
  );

  assert.deepEqual(runtime.health(), { live: true, ready: false });
  assert.deepEqual(await runtime.start(), { started: "Started" });
  assert.deepEqual(runtime.health(), { live: true, ready: true });
  await until(() => passes > 0);
  await runtime.stop();
  assert.deepEqual(runtime.health(), { live: true, ready: false });
});

test("a missing precondition is could-not-run and never becomes ready", async () => {
  let passes = 0;
  const runtime = serviceRuntime(
    { run: () => Promise.resolve(void (passes += 1)) },
    pacing,
    [
      {
        name: "schema-compatible",
        check: () =>
          Promise.resolve({
            met: "Refused" as const,
            why: "the applied prefix is not one this image accepts",
          }),
      },
    ],
    runtimeConfig,
  );

  assert.deepEqual(await runtime.start(), {
    started: "CouldNotRun",
    precondition: "schema-compatible",
    verdict: "Refused",
    why: "the applied prefix is not one this image accepts",
  });
  assert.deepEqual(runtime.health(), { live: true, ready: false });
  assert.equal(passes, 0);
});

test("a failed quantum withdraws readiness and fails liveness", async () => {
  const runtime = serviceRuntime(
    { run: () => Promise.reject(new Error("lost authority")) },
    pacing,
    [],
    runtimeConfig,
  );

  await runtime.start();
  await until(() => !runtime.health().live);
  assert.deepEqual(runtime.health(), {
    live: false,
    ready: false,
    failure: "lost authority",
  });
  await runtime.stop();
});

test("a settlement carries the failure that ended the loop", async () => {
  const runtime = serviceRuntime(
    { run: () => Promise.reject(new Error("lost authority")) },
    pacing,
    [],
    runtimeConfig,
  );

  await runtime.start();
  assert.deepEqual(await runtime.settled(), {
    live: false,
    ready: false,
    failure: "lost authority",
  });
  await runtime.stop();
});

test("an orderly stop settles the run without a failure", async () => {
  const runtime = serviceRuntime(
    { run: () => Promise.resolve() },
    pacing,
    [],
    runtimeConfig,
  );

  await runtime.start();
  const settled = runtime.settled();
  await runtime.stop();
  assert.deepEqual(await settled, { live: true, ready: false });
});

test("configuration refuses an unbounded busy loop", () => {
  assert.throws(
    () =>
      serviceRuntime({ run: () => Promise.resolve() }, pacing, [], {
        idleIntervalMilliseconds: 0,
        shutdownDrainMilliseconds: 1,
      }),
    /positive integer/u,
  );
});

const migrationOne = { version: 1, name: "foundation" };
const migrationTwo = { version: 2, name: "expand" };

test("a staged compatible migration keeps the retained image runnable", () => {
  assert.deepEqual(
    runtimeMigrationPlan([migrationOne], [migrationOne, migrationTwo], {
      current: {
        required: [migrationOne, migrationTwo],
        compatible: [migrationOne, migrationTwo],
      },
      retainedPrevious: {
        required: [migrationOne],
        compatible: [migrationOne, migrationTwo],
      },
    }),
    { planned: "Compatible", pending: [migrationTwo] },
  );
});

test("a migration the retained image did not admit refuses rollout", () => {
  assert.deepEqual(
    runtimeMigrationPlan([migrationOne], [migrationOne, migrationTwo], {
      current: {
        required: [migrationOne, migrationTwo],
        compatible: [migrationOne, migrationTwo],
      },
      retainedPrevious: {
        required: [migrationOne],
        compatible: [migrationOne],
      },
    }),
    { planned: "Incompatible" },
  );
});

test("a migration ledger with a gap is incompatible", async () => {
  const precondition = schemaCompatibilityPrecondition(
    { applied: () => Promise.resolve([migrationTwo]) },
    {
      required: [migrationOne, migrationTwo],
      compatible: [migrationOne, migrationTwo],
    },
  );
  assert.equal(
    (await precondition.check(new AbortController().signal)).met,
    "Refused",
  );
});

test("a stored journal this image could not have taken refuses the start, naming it", async () => {
  let passes = 0;
  const runtime = serviceRuntime(
    { run: () => Promise.resolve(void (passes += 1)) },
    pacing,
    [
      journalLegalityPrecondition({
        scan: () =>
          Promise.resolve({
            scanned: "Scanned",
            illegal: ["acme/rig", "acme/spare"],
          }),
      }),
    ],
    runtimeConfig,
  );

  assert.deepEqual(await runtime.start(), {
    started: "CouldNotRun",
    precondition: "journal-legal",
    verdict: "Refused",
    why: "stored histories this image could not have decided: acme/rig, acme/spare",
  });
  assert.deepEqual(runtime.health(), { live: true, ready: false });
  assert.equal(passes, 0);
  await runtime.stop();
});

test("a legality scan that could not finish is undecided, not a finding", async () => {
  const runtime = serviceRuntime(
    { run: () => Promise.resolve() },
    pacing,
    [
      journalLegalityPrecondition({
        scan: () =>
          Promise.resolve({
            scanned: "Incomplete",
            why: "more journaled partitions than one legality scan reads",
          }),
      }),
    ],
    runtimeConfig,
  );

  assert.deepEqual(await runtime.start(), {
    started: "CouldNotRun",
    precondition: "journal-legal",
    verdict: "Undecided",
    why: "more journaled partitions than one legality scan reads",
  });
  await runtime.stop();
});

test("a scan that raises is undecided rather than a journal this image refuses", async () => {
  const runtime = serviceRuntime(
    { run: () => Promise.resolve() },
    pacing,
    [
      journalLegalityPrecondition({
        scan: () => Promise.reject(new Error("the database is unreachable")),
      }),
    ],
    runtimeConfig,
  );

  assert.deepEqual(await runtime.start(), {
    started: "CouldNotRun",
    precondition: "journal-legal",
    verdict: "Undecided",
    why: "the database is unreachable",
  });
  await runtime.stop();
});

test("a legality scan that names nothing lets the start proceed", async () => {
  const runtime = serviceRuntime(
    { run: () => Promise.resolve() },
    pacing,
    [
      journalLegalityPrecondition({
        scan: () => Promise.resolve({ scanned: "Scanned", illegal: [] }),
      }),
    ],
    runtimeConfig,
  );

  assert.deepEqual(await runtime.start(), { started: "Started" });
  await runtime.stop();
});

test("stop cancels and awaits startup preconditions", async () => {
  let checking!: () => void;
  const entered = new Promise<void>((resolve) => {
    checking = () => {
      resolve();
    };
  });
  const runtime = serviceRuntime(
    { run: () => Promise.resolve() },
    pacing,
    [
      {
        name: "slow-precondition",
        check: (signal) =>
          new Promise((resolve) => {
            checking();
            signal.addEventListener(
              "abort",
              () => {
                resolve({ met: "Refused", why: "the start was cancelled" });
              },
              { once: true },
            );
          }),
      },
    ],
    runtimeConfig,
  );

  const starting = runtime.start();
  await entered;
  await runtime.stop();
  assert.deepEqual(await starting, { started: "Stopped" });
  assert.deepEqual(runtime.health(), { live: true, ready: false });
});

test("stop is bounded when a startup precondition ignores cancellation", async () => {
  let entered!: () => void;
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const runtime = serviceRuntime(
    { run: () => Promise.resolve() },
    pacing,
    [
      {
        name: "stuck-precondition",
        check: () =>
          new Promise(() => {
            entered();
          }),
      },
    ],
    runtimeConfig,
  );
  void runtime.start();
  await checking;
  assert.deepEqual(await runtime.stop(), { stopped: "DrainExpired" });
});

test("stop returns when an in-flight quantum exceeds its drain", async () => {
  let entered!: () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const runtime = serviceRuntime(
    {
      run: () =>
        new Promise(() => {
          entered();
        }),
    },
    pacing,
    [],
    runtimeConfig,
  );
  await runtime.start();
  await running;
  assert.deepEqual(await runtime.stop(), { stopped: "DrainExpired" });
  assert.deepEqual(runtime.health(), {
    live: false,
    ready: false,
    failure: "shutdown drain expired",
  });
});
