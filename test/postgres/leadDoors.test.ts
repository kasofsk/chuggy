/**
 * The startup privilege check, against a real migrated database: every door a
 * decision opens answers for the selector's own role, and nothing it names is
 * a signature no function has.
 *
 * IT IS DRIVEN ON THE SELECTOR'S POOL AND NOT THE OWNER'S. The migration owner
 * holds EXECUTE on everything, so a case run as the owner would be green over
 * any grant at all and would say nothing about the control.
 *
 * A SIGNATURE NO FUNCTION HAS IS A RAISE, NOT A REFUSAL.
 * `has_function_privilege` resolves a signature exactly, so a hand-copied
 * argument type does not answer false — it throws, and the precondition that
 * calls it answers Undecided at every start.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  leadDoorRefused,
  leadDoorSignatures,
  postgresLeadDoorsRefused,
} from "../../src/adapters/postgres/leadMailbox.ts";
import {
  agenticRefusalRecordFunction,
  agenticRefusalStandingFunction,
  leadSessionFunction,
  leadTurnEnqueueFunction,
  leadTurnReadFunction,
  leadTurnWithdrawFunction,
  selectorInteractionsReadFunction,
  sessionSystemPromptSetFunction,
} from "../../src/adapters/postgres/schema/shared.ts";
import {
  apiRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { systemPromptSetSignature } from "../../src/adapters/postgres/schema/migrations/061-lead-tools.ts";
import { postgresHarnessRolePool, postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";

const execute = promisify(execFile);

let selectorPool: pg.Pool;
let apiPool: pg.Pool;

before(() => {
  selectorPool = postgresHarnessRolePool(selectorServiceRole);
  apiPool = postgresHarnessRolePool(apiRole);
});

after(async () => {
  await selectorPool.end();
  await apiPool.end();
});

test("every door a decision opens is one the selector's own role may execute", async () => {
  assert.deepEqual(
    await postgresLeadDoorsRefused(selectorPool),
    [],
    "a door this role cannot execute is a selector that never starts",
  );
});

test("every door names a signature the migrated schema actually has", async () => {
  for (const door of leadDoorSignatures) {
    const found = await selectorPool.query<{ resolved: string | null }>(
      `SELECT $1::regprocedure::text AS resolved`,
      [door],
    );
    assert.equal(
      found.rows[0]?.resolved?.replace(/\s/gu, ""),
      door.replace(/\s/gu, ""),
      `${door} must resolve to itself, or the privilege read raises rather than refusing`,
    );
  }
});

test("a door the role was never granted is reported as refused", async () => {
  const refused = await postgresLeadDoorsRefused(apiPool);
  assert.notDeepEqual(
    refused,
    [],
    "the API role holds none of the selector's write doors, so it must be refused",
  );
  for (const door of refused) assert.ok(leadDoorSignatures.includes(door));
});

test("an answer the server did not give is refused rather than permitted", () => {
  assert.equal(leadDoorRefused({ permitted: true }), false);
  assert.equal(leadDoorRefused({ permitted: false }), true);
  assert.equal(
    leadDoorRefused({ permitted: null }),
    true,
    "a control that reads a null as consent is worse than no control",
  );
});

test("the list names every door the selector's own role is granted", () => {
  const named = leadDoorSignatures.map((door) =>
    door.slice(0, door.indexOf("(")),
  );
  for (const door of [
    agenticRefusalRecordFunction,
    agenticRefusalStandingFunction,
    leadSessionFunction,
    leadTurnEnqueueFunction,
    leadTurnReadFunction,
    leadTurnWithdrawFunction,
    selectorInteractionsReadFunction,
    sessionSystemPromptSetFunction,
  ])
    assert.ok(
      named.includes(door),
      `${door} is granted to the selector, so a check that omits it passes a role that cannot start`,
    );
});

/** The connection string the selector process itself would be given. */
function selectorDatabaseUrl(): string {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${selectorServiceRole}`);
  return url.toString();
}

/**
 * The root is composed in a child process because nothing in this tree may
 * import a process root, which `check-boundaries` holds; the existing root
 * suite spawns one for the same reason.
 */
const composedRootProgram = `
  const roots = await import('./src/roots/controlPlane.ts');
  const reject = () => Promise.reject(new Error('no pass was expected'));
  const runtime = roots.selectorProcessRoot(
    {
      database: { url: process.env.CHUG_SELECTOR_URL },
      runtime: { idleIntervalMilliseconds: 60000, shutdownDrainMilliseconds: 1000 },
      wakes: { wakesPerPassMax: 1 },
    },
    {
      projects: reject, moved: reject, notifications: reject,
      dispatchView: reject, operationalContext: reject,
      currentTimeEpochMs: async () => 0,
      currentInstant: async () => '2026-09-03T12:00:00.000Z',
      decisionDeadline: () => new Promise(() => undefined),
      submit: reject, operation: reject,
    },
    {
      clock: {
        now: async () => ({ instant: '2026-09-03T12:00:00.000Z', epochMs: 0 }),
        wait: async () => undefined,
      },
      deadline: { after: () => new Promise(() => undefined) },
      policy: { pollIntervalMs: 1, implementationRevision: 'test' },
      controlDeadlineMs: 1000,
    },
    { next: () => ({ operation: 'unused', selectorDecisionReference: 'unused' }) },
  );
  const started = await runtime.start();
  await runtime.stop();
  process.stdout.write(JSON.stringify(started));
`;

test("the composed selector process refuses to start when one door is not granted", async () => {
  const owner = postgresPool(postgresHarnessUrl());
  const door = `${sessionSystemPromptSetFunction}(${systemPromptSetSignature})`;
  let stdout: string;
  await owner.query(
    `REVOKE EXECUTE ON FUNCTION ${door} FROM ${selectorServiceRole}`,
  );
  try {
    ({ stdout } = await execute(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        composedRootProgram,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CHUG_SELECTOR_URL: selectorDatabaseUrl() },
      },
    ));
  } finally {
    await owner.query(
      `GRANT EXECUTE ON FUNCTION ${door} TO ${selectorServiceRole}`,
    );
    await owner.end();
  }
  const started = JSON.parse(stdout) as {
    readonly started: string;
    readonly precondition?: string;
  };
  assert.equal(
    started.started,
    "CouldNotRun",
    "a half-granted migration must stop the process, not let it run blind",
  );
  assert.equal(
    started.precondition,
    "selector-lead-doors",
    "and it must say which control refused",
  );
});
