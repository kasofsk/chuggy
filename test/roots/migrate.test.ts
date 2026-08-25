/**
 * The migration command's configuration and its reporting, both of which are
 * total functions from data and neither of which needs a server.
 *
 * THE MODULE IS REACHED THROUGH A CHILD PROCESS, as every suite over
 * `src/roots/` is: nothing may import a process root, because a root something
 * depends on is a module and the layers below could reach an adapter through
 * it. `.dependency-cruiser.cjs` states that rule as `nothing-imports-a-process-
 * root`.
 *
 * WHAT A SERVER IS STILL NEEDED FOR is whether the planned target is applied
 * and whether a refused ledger is left untouched; `test/postgres/
 * migration.test.ts` owns those, and drives this same file as a command.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const password = "the-password-no-diagnostic-may-carry";

/** Evaluates one program against the command's module and returns what it wrote. */
async function migrateEvaluated(
  program: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<string> {
  const found = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd(), env: environment },
  );
  return found.stdout;
}

/** What `migrateMain` leaves with for one environment, as the exit it returns. */
async function migrateMainExit(
  environment: NodeJS.ProcessEnv,
): Promise<unknown> {
  return JSON.parse(
    await migrateEvaluated(`
      const { migrateMain } = await import('./src/roots/migrate.ts');
      process.stdout.write(JSON.stringify(await migrateMain(${JSON.stringify(environment)})));
    `),
  );
}

test("the database URL is the one value the command refuses to default", async () => {
  for (const environment of [{}, { CHUG_MIGRATE_DATABASE_URL: "" }]) {
    assert.deepEqual(await migrateMainExit(environment), {
      code: 1,
      report: "CHUG_MIGRATE_DATABASE_URL is required",
    });
  }
});

test("a statement bound that is not a positive count is refused by name", async () => {
  for (const named of ["0", "-1", "3.5", "ten", " 10"]) {
    assert.deepEqual(
      await migrateMainExit({
        CHUG_MIGRATE_DATABASE_URL: "postgres://host/chuggy",
        CHUG_MIGRATE_STATEMENT_TIMEOUT_MS: named,
      }),
      {
        code: 1,
        report: "CHUG_MIGRATE_STATEMENT_TIMEOUT_MS must be a positive integer",
      },
    );
  }
});

test("an adoption identity must be a canonical UUID", async () => {
  assert.deepEqual(
    await migrateMainExit({
      CHUG_MIGRATE_DATABASE_URL: "postgres://host/chuggy",
      CHUG_MIGRATE_ADOPT_INSTALLATION_ID: "not-an-installation-id",
    }),
    {
      code: 1,
      report: "installation id: not-an-installation-id is not a canonical UUID",
    },
  );
});

test("the command opens one connection and plans against its own contract", async () => {
  const found = JSON.parse(
    await migrateEvaluated(`
      const { migrateSettingsOf } = await import('./src/roots/migrate.ts');
      const settings = migrateSettingsOf({ CHUG_MIGRATE_DATABASE_URL: 'postgres://host/chuggy' });
      process.stdout.write(JSON.stringify({
        connectionsMax: settings.limits.connectionsMax,
        plansAgainstItself: settings.deployment.current === settings.deployment.retainedPrevious,
      }));
    `),
  ) as { connectionsMax: number; plansAgainstItself: boolean };
  assert.deepEqual(found, { connectionsMax: 1, plansAgainstItself: true });
});

test("a named statement bound replaces the default rather than joining it", async () => {
  const found = JSON.parse(
    await migrateEvaluated(`
      const { migrateSettingsOf } = await import('./src/roots/migrate.ts');
      const named = migrateSettingsOf({
        CHUG_MIGRATE_DATABASE_URL: 'postgres://host/chuggy',
        CHUG_MIGRATE_STATEMENT_TIMEOUT_MS: '1000',
      });
      const unnamed = migrateSettingsOf({ CHUG_MIGRATE_DATABASE_URL: 'postgres://host/chuggy' });
      process.stdout.write(JSON.stringify([
        named.limits.statementTimeoutMs,
        unnamed.limits.statementTimeoutMs,
      ]));
    `),
  ) as [number, number];
  assert.equal(found[0], 1000);
  assert.notEqual(found[1], 1000);
});

test("every outcome maps to the line and the status an operator reads", async () => {
  const found: unknown = JSON.parse(
    await migrateEvaluated(`
      const { migrateExitOf } = await import('./src/roots/migrate.ts');
      process.stdout.write(JSON.stringify([
        migrateExitOf({ migrated: 'Applied', versions: [] }),
        migrateExitOf({ migrated: 'Applied', versions: [16, 17] }),
        migrateExitOf({ migrated: 'CouldNotRun' }),
      ]));
    `),
  );
  assert.deepEqual(found, [
    { code: 0, report: "the schema was already current" },
    { code: 0, report: "applied 16,17" },
    {
      code: 2,
      report:
        "the applied ledger is not a prefix of the schema this image declares, so nothing was applied",
    },
  ]);
});

test("a server that never answered is a could-not-run, and its report carries no credential", async () => {
  const exit = (await migrateMainExit({
    CHUG_MIGRATE_DATABASE_URL: `postgres://chuggy_owner:${password}@127.0.0.1:1/chuggy`,
    CHUG_MIGRATE_STATEMENT_TIMEOUT_MS: "1000",
  })) as { code: number; report: string };
  assert.equal(exit.code, 2);
  assert.ok(!exit.report.includes(password), exit.report);
});

test("importing the module runs no migration; only invoking the file does", async () => {
  assert.equal(
    await migrateEvaluated(`
      const migrate = await import('./src/roots/migrate.ts');
      process.stdout.write(typeof migrate.migrateMain);
    `),
    "function",
  );
});
