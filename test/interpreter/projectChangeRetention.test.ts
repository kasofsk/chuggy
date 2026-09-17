import assert from "node:assert/strict";
import { test } from "node:test";

import { projectChangeRetentionMaintenance } from "../../src/interpreter/projectChangeRetention.ts";

test("maintenance sweeps one bounded batch and stop cancels its timer", async () => {
  const swept: number[] = [];
  let waiting: ((value: void) => void) | undefined;
  let signal: AbortSignal | undefined;
  const maintenance = projectChangeRetentionMaintenance(
    {
      sweep: (rowsMax) => {
        swept.push(rowsMax);
        return Promise.resolve(7);
      },
    },
    {
      wait: (_milliseconds, held) => {
        signal = held;
        return new Promise<void>((resolve) => {
          waiting = resolve;
          held.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
      },
    },
    { intervalMs: 50, rowsMax: 23 },
  );

  maintenance.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(swept, [23]);
  assert.equal(signal?.aborted, false);
  await maintenance.stop();
  assert.equal(signal?.aborted, true);
  assert.ok(waiting !== undefined);
});

test("a failed sweep is reported and the next interval remains live", async () => {
  const failures: unknown[] = [];
  let release: (() => void) | undefined;
  let calls = 0;
  const maintenance = projectChangeRetentionMaintenance(
    {
      sweep: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("database unavailable"))
          : Promise.resolve(0);
      },
    },
    {
      wait: (_milliseconds, signal) =>
        new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        }),
    },
    { intervalMs: 50, rowsMax: 23 },
    (failure) => failures.push(failure),
  );

  maintenance.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.match(String(failures[0]), /database unavailable/u);
  release?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  await maintenance.stop();
});
