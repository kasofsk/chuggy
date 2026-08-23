/**
 * The migration as a process: the one command that applies the schema this
 * image declares, and the only place in this tree that reads an environment to
 * decide which database it applies it to.
 *
 * A LEDGER THAT IS NOT A PREFIX OF THIS IMAGE'S OWN IS A COULD-NOT-RUN. A
 * database carrying a version this image does not declare, or declaring one
 * under another name, is refused with nothing applied — which is why the
 * planning runner is the one called here and `postgresMigrate` is not. That
 * one subtracts the applied set and applies the difference, so against a
 * database ahead of this image it fills the gaps it recognises and reports the
 * success of a schema nobody has.
 *
 * IT IS SAFE TO RUN TWICE AND SAYS WHICH RUN DID THE WORK. Applying nothing is
 * the ordinary outcome of a second run and is reported as such, so an operator
 * reading the line learns whether this invocation moved the database.
 *
 * IT PLANS AGAINST ITSELF ON BOTH SIDES, which is the rollout that retains no
 * earlier image. A rollout that retains one whose contract is shorter needs
 * that image's own `runtimeSchemaContract` on the other side of the plan, and
 * this command has no way to be told it — see kasofsk/chuggy#240.
 *
 * NO CREDENTIAL REACHES A DIAGNOSTIC. The database URL carries a password, so
 * every refusal below names the variable it read and never the value.
 */

import { pathToFileURL } from "node:url";

import {
  postgresLimitsDefault,
  postgresMigrateCompatible,
  postgresPool,
  type PostgresCompatibleMigration,
  type PostgresLimits,
} from "../adapters/postgres/pool.ts";
import { currentRuntimeSchemaContract } from "../adapters/postgres/runtimeSchema.ts";
import type { RuntimeDeploymentSchema } from "../interpreter/serviceRuntime.ts";

/** An environment as this command takes it: names to values, and never a global. */
export type MigrateEnvironment = Readonly<Record<string, string | undefined>>;

const databaseUrlVariable = "CHUG_MIGRATE_DATABASE_URL";
const statementTimeoutVariable = "CHUG_MIGRATE_STATEMENT_TIMEOUT_MS";

/**
 * How long one migration statement may run before the server ends it. A schema
 * change rewrites tables and takes longer than the request-shaped default the
 * pool carries for everything else.
 */
const migrateStatementTimeoutMsDefault = 300_000;

/** What a run leaves with, and the line an operator reads to learn which it was. */
export interface MigrateExit {
  readonly code: 0 | 1 | 2;
  readonly report: string;
}

/** Everything one migration run is configured with, all of it plain data. */
export interface MigrateSettings {
  readonly databaseUrl: string;
  readonly limits: PostgresLimits;
  readonly deployment: RuntimeDeploymentSchema;
}

/** The one value a deployment may not leave to a default. */
function migrateSettingsRequired(
  environment: MigrateEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** A bound a deployment may name, refusing anything that is not a positive count. */
function migrateSettingsBoundOr(
  environment: MigrateEnvironment,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined || value.length === 0) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new RangeError(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`${name} is too big`);
  return parsed;
}

/**
 * The whole configuration, parsed out of one environment record. One
 * connection, because a migration is one transaction and a second would only
 * queue behind the lock it holds.
 */
export function migrateSettingsOf(
  environment: MigrateEnvironment,
): MigrateSettings {
  return {
    databaseUrl: migrateSettingsRequired(environment, databaseUrlVariable),
    limits: {
      connectionsMax: 1,
      connectionWaitMs: postgresLimitsDefault.connectionWaitMs,
      statementTimeoutMs: migrateSettingsBoundOr(
        environment,
        statementTimeoutVariable,
        migrateStatementTimeoutMsDefault,
      ),
    },
    deployment: {
      current: currentRuntimeSchemaContract,
      retainedPrevious: currentRuntimeSchemaContract,
    },
  };
}

/** Applies the planned target, ending the pool whatever the outcome was. */
export async function migrateRun(
  settings: MigrateSettings,
): Promise<PostgresCompatibleMigration> {
  const pool = postgresPool(settings.databaseUrl, settings.limits);
  try {
    return await postgresMigrateCompatible(pool, settings.deployment);
  } finally {
    await pool.end();
  }
}

/** What one outcome leaves with, an applied nothing being the ordinary second run. */
export function migrateExitOf(
  outcome: PostgresCompatibleMigration,
): MigrateExit {
  if (outcome.migrated === "CouldNotRun")
    return {
      code: 2,
      report:
        "the applied ledger is not a prefix of the schema this image declares, so nothing was applied",
    };
  if (outcome.versions.length === 0)
    return { code: 0, report: "the schema was already current" };
  return { code: 0, report: `applied ${outcome.versions.join(",")}` };
}

/** Runs one migration and reports it, a configuration this cannot parse being a failure. */
export async function migrateMain(
  environment: MigrateEnvironment,
  run: (
    settings: MigrateSettings,
  ) => Promise<PostgresCompatibleMigration> = migrateRun,
): Promise<MigrateExit> {
  let settings: MigrateSettings;
  try {
    settings = migrateSettingsOf(environment);
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "invalid configuration";
    return { code: 1, report: message };
  }
  try {
    return migrateExitOf(await run(settings));
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "unknown migration failure";
    return { code: 1, report: message };
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await migrateMain(process.env).then((exit) => {
    const stream = exit.code === 0 ? process.stdout : process.stderr;
    stream.write(`migrate: ${exit.report}\n`);
    process.exitCode = exit.code;
  });
