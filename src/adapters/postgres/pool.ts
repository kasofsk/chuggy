/**
 * The connection pool, the migration runner and the shared query plumbing:
 * everything the other modules in this adapter need that is not a statement
 * about a relation.
 *
 * THE POOL IS BOUNDED AND SO IS EVERY WAIT. House rule 9 asks for an explicit
 * limit on anything that can grow, and a database client has three: how many
 * connections it will open, how long a caller will queue for one of them, and
 * how long it will wait for one answer. The middle one is not optional
 * either — an unbounded queue for a connection is how pool pressure stops
 * limiting activation and starts hiding it.
 * 006 adds the reason the first matters here — ticket-service replicas borrow
 * connections only for short replay reads and decision transactions, and pool
 * pressure is meant to limit actor activation rather than queue behind an
 * unbounded pool.
 *
 * AN IDLE CLIENT CAN STILL FAIL, AND THAT FAILURE HAS TO GO SOMEWHERE. A
 * pooled connection sits attached to a live backend, so a server restart, an
 * administrative termination or a partition raises an error on a client
 * nobody is currently using. `pg` emits it on the pool, and an emitted error
 * with no listener is an uncaught exception that ends the process — a crash
 * through a path this adapter never designed, rather than the fail-closed stop
 * 006 asks for. So a handler is always attached, and a deployment that wants
 * to stop accepting on it supplies its own.
 *
 * A CHECKED-OUT CLIENT NEEDS THAT HANDLER JUST AS MUCH. `pg` moves its own
 * listener aside for as long as a caller holds a client, so the same
 * termination arriving mid-transaction reaches a client nobody is listening to
 * and ends the process for the same reason. The transaction below therefore
 * listens for as long as it holds one; the in-flight statement rejects with
 * that failure and the transaction rolls back, so the caller still learns what
 * happened and only learns it once.
 *
 * OWNERSHIP IS NEVER A CONNECTION-SCOPED LOCK. A session advisory lock would
 * be the shorter way to make one writer per project, and it is wrong: 006
 * requires the lease to live in a durable row so a project survives the
 * process that held it, and a connection-scoped lock disappears with the
 * socket. The one advisory lock this file does take is the migration lock,
 * which guards a schema change rather than an authority and is released before
 * anything decides anything.
 *
 * MIGRATIONS ARE APPLIED UNDER THAT LOCK AND RECORDED IN THE SAME
 * TRANSACTION, so two replicas starting together apply each version once. A
 * version whose statements fail rolls back with its ledger row, which is what
 * makes a half-applied schema impossible rather than merely unlikely.
 */

import { sql } from "@ts-safeql/sql-tag";
import pg from "pg";

import { migrationLedger, migrations, type Migration } from "./schema.ts";
import {
  runtimeMigrationPlan,
  type RuntimeDeploymentSchema,
  type RuntimeSchemaMigration,
} from "../../interpreter/serviceRuntime.ts";

/** How many connections one pool opens, how long a caller waits for one, and how long any one statement may run. */
export interface PostgresLimits {
  readonly connectionsMax: number;
  readonly connectionWaitMs: number;
  readonly statementTimeoutMs: number;
}

/** The limits a ticket-service process uses when a deployment names none. */
export const postgresLimitsDefault: PostgresLimits = {
  connectionsMax: 8,
  connectionWaitMs: 5_000,
  statementTimeoutMs: 10_000,
};

/**
 * The lock the migration runner takes. It is an arbitrary constant whose only
 * requirement is that nothing else in this database uses it.
 */
const migrationLockKey = 0x63687567;

/** What an idle client's failure is reported to; `pg` has already discarded the client by then. */
export type PostgresIdleFailure = (failure: Error) => void;

/** Says the failure happened rather than swallowing it, which is what a deployment overrides. */
export const postgresIdleFailureDefault: PostgresIdleFailure = (failure) => {
  process.stderr.write(`postgres: an idle client failed: ${failure.message}\n`);
};

/** Opens a bounded pool against the URL, applying the statement cap to every session it hands out. */
export function postgresPool(
  url: string,
  limits: PostgresLimits = postgresLimitsDefault,
  onIdleFailure: PostgresIdleFailure = postgresIdleFailureDefault,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: limits.connectionsMax,
    connectionTimeoutMillis: limits.connectionWaitMs,
    statement_timeout: limits.statementTimeoutMs,
  });
  pool.on("error", onIdleFailure);
  return pool;
}

/**
 * An identity on a string whose declared type is narrower than string: the
 * query checker rewrites a union-typed parameter comparison into a form
 * whose parse depends on the whitespace around the operator, and a plain
 * string never takes that path. Every union-typed comparison wraps, because
 * a site today's parser happens to survive is one reformat away from a red
 * check-queries.
 */
export function postgresTextParameter(value: string): string {
  return value;
}

/**
 * Runs `work` inside one transaction, committing when it returns and rolling
 * back when it throws. The client is always released and listened to
 * throughout, including when the rollback itself fails.
 */
export async function postgresTransaction<Result>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  const held = (): void => undefined;
  client.on("error", held);
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (failure) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw failure;
  } finally {
    client.removeListener("error", held);
    client.release();
  }
}

/** Applies one version and records it, so a failure takes the ledger row with it. */
async function postgresMigrateOne(
  client: pg.PoolClient,
  migration: Migration,
): Promise<void> {
  for (const statement of migration.statements) {
    await client.query(statement);
  }
  await client.query(
    sql`INSERT INTO schema_migration (version, name) VALUES (${migration.version}, ${migration.name})`,
  );
}

/** The versions this database has already applied, as a set the runner subtracts from. */
async function postgresMigrateApplied(
  client: pg.PoolClient,
): Promise<ReadonlySet<number>> {
  const applied = await client.query<{ version: number }>(
    sql`SELECT version FROM schema_migration`,
  );
  return new Set(applied.rows.map((row) => row.version));
}

async function postgresAppliedMigrations(
  client: pg.PoolClient,
): Promise<readonly RuntimeSchemaMigration[]> {
  const applied = await client.query<{ version: number; name: string }>(
    sql`SELECT version,name FROM schema_migration ORDER BY version`,
  );
  return applied.rows;
}

/**
 * Brings the database up to the declared schema, returning the versions this
 * call applied. Concurrent callers serialize on the migration lock and the
 * loser applies nothing.
 */
export async function postgresMigrate(
  pool: pg.Pool,
): Promise<readonly number[]> {
  return postgresTransaction(pool, async (client) => {
    await client.query<{ locked: string | null }>(
      sql`SELECT pg_advisory_xact_lock(${migrationLockKey})::text AS locked`,
    );
    await client.query(migrationLedger);
    const applied = await postgresMigrateApplied(client);
    const ran: number[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await postgresMigrateOne(client, migration);
      ran.push(migration.version);
    }
    return ran;
  });
}

export type PostgresCompatibleMigration =
  | { readonly migrated: "Applied"; readonly versions: readonly number[] }
  | { readonly migrated: "CouldNotRun" };

class IncompatibleMigration extends Error {}

function postgresCompatibleTarget(
  deployment: RuntimeDeploymentSchema,
): readonly RuntimeSchemaMigration[] {
  const length = Math.min(
    deployment.current.compatible.length,
    deployment.retainedPrevious.compatible.length,
  );
  return migrations
    .slice(0, length)
    .map(({ version, name }) => ({ version, name }));
}

/** Plans and applies one rollback-compatible target under the migration lock. */
export async function postgresMigrateCompatible(
  pool: pg.Pool,
  deployment: RuntimeDeploymentSchema,
): Promise<PostgresCompatibleMigration> {
  try {
    return await postgresTransaction(pool, async (client) => {
      await client.query<{ locked: string | null }>(
        sql`SELECT pg_advisory_xact_lock(${migrationLockKey})::text AS locked`,
      );
      await client.query(migrationLedger);
      const applied = await postgresAppliedMigrations(client);
      const target = postgresCompatibleTarget(deployment);
      const plan = runtimeMigrationPlan(applied, target, deployment);
      if (plan.planned === "Incompatible") throw new IncompatibleMigration();
      const pending = new Set(plan.pending.map(({ version }) => version));
      const versions: number[] = [];
      for (const migration of migrations) {
        if (!pending.has(migration.version)) continue;
        await postgresMigrateOne(client, migration);
        versions.push(migration.version);
      }
      return { migrated: "Applied", versions };
    });
  } catch (failure) {
    if (failure instanceof IncompatibleMigration)
      return { migrated: "CouldNotRun" };
    throw failure;
  }
}
