/**
 * The PostgreSQL schema, expressed as the ordered migrations that create it.
 *
 * Migration statements live in cohesive modules under `./schema`; this facade
 * preserves the adapter's existing public API.
 */
import { accessMigrations } from "./schema/access.ts";
import { finalizerMigrations } from "./schema/finalizer.ts";
import { foundationMigrations } from "./schema/foundation.ts";
import { mailboxMigrations } from "./schema/mailbox.ts";
import { nativeMigrations } from "./schema/native.ts";
import {
  executionUpgradeMigrations,
  schedulerMigrations,
} from "./schema/scheduler.ts";
import { selectorMigrations } from "./schema/selector.ts";
import type { Migration } from "./schema/shared.ts";

export * from "./schema/shared.ts";
export {
  retrofitBundleDigest,
  retrofitBundleIdentity,
} from "./schema/finalizer.ts";

/** The ledger of applied migrations, which the runner creates before it reads anything. */
export const migrationLedger = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version    integer PRIMARY KEY,
    name       text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [
  ...foundationMigrations,
  ...mailboxMigrations,
  ...nativeMigrations,
  ...selectorMigrations,
  ...schedulerMigrations,
  ...finalizerMigrations,
  ...accessMigrations,
  ...executionUpgradeMigrations,
];
