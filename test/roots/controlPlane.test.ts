import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);

test("a process database role must match its responsibility", async () => {
  const program = `
    const roots = await import('./src/roots/controlPlane.ts');
    const matching = roots.postgresRolePrecondition(
      { query: async () => ({ rows: [{ current_role: 'chuggy_selector_service' }] }) },
      'chuggy_selector_service',
    );
    const rival = roots.postgresRolePrecondition(
      { query: async () => ({ rows: [{ current_role: 'chuggy_api' }] }) },
      'chuggy_selector_service',
    );
    const signal = new AbortController().signal;
    process.stdout.write(
      JSON.stringify([
        (await matching.check(signal)).met === "Met",
        (await rival.check(signal)).met === "Met",
      ]),
    );
  `;
  const result = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd() },
  );
  assert.deepEqual(JSON.parse(result.stdout), [true, false]);
});

test("the finalizer process reports an absent schema as could-not-run", async () => {
  const program = `
    const roots = await import('./src/roots/controlPlane.ts');
    const schema = await import('./src/adapters/postgres/runtimeSchema.ts');
    const pool = { query: async () => ({ rows: [] }) };
    const requirements = {
      pool,
    };
    const config = { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 };
    const identity = { owner: 'owner', recoveryEpoch: 'epoch', cluster: 'cluster' };
    const wakes = {
      store: {
        cursor: async () => { throw new Error('a process that could not run took a wake pass'); },
        candidates: async () => [],
        wake: async () => ({ woken: 'NoThread' }),
        advance: async (sequence) => sequence,
      },
      clock: { nowIso: () => '2026-09-02T00:00:00.000Z' },
      wakesPerPassMax: 1,
    };
    const runtimes = [
      roots.finalizerProcess({}, 1, requirements, config),
    ];
    const outcomes = [];
    for (const runtime of runtimes) {
      outcomes.push(await runtime.start());
      await runtime.stop();
    }
    process.stdout.write(JSON.stringify(outcomes));
  `;
  const result = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd() },
  );
  assert.deepEqual(
    (
      JSON.parse(result.stdout) as readonly {
        started: string;
        precondition: string;
        verdict: string;
      }[]
    ).map((outcome) => [
      outcome.started,
      outcome.precondition,
      outcome.verdict,
    ]),
    Array.from({ length: 1 }, () => [
      "CouldNotRun",
      "schema-compatible",
      "Refused",
    ]),
  );
});
