/**
 * The PostgreSQL schema, expressed as the ordered migrations that create it.
 *
 * Each migration lives in its own module under `./schema/migrations`; this
 * facade preserves the adapter's existing public API.
 */
export { migrations } from "./schema/migrations/index.ts";

export * from "./schema/shared.ts";
export {
  retrofitBundleDigest,
  retrofitBundleIdentity,
} from "./schema/migrations/013-durable-finalizer.ts";

/** The ledger of applied migrations, which the runner creates before it reads anything. */
export const migrationLedger = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version    integer PRIMARY KEY,
    name       text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;
