import { poolPlaneRole, type Migration } from "../shared.ts";

/**
 * The pool's secret leaves this database for the issuer that already holds
 * every other one.
 *
 * A DIGEST COLUMN WAS A SECOND SECRET STORE, and this installation runs an
 * issuer. A pool is a confidential OAuth2 client of it, so what the row keeps
 * is the principal that client's subject resolves to — the same value every
 * other caller of this tree is recorded under — and the authority that decides
 * what the pool may do is the one already answering for every project.
 *
 * `client_id` IS KEPT BESIDE THE PRINCIPAL AND READ BY THE OWNER ALONE. Taking
 * a pool off a project has to take its client off the issuer, and deriving the
 * subject back out of a principal would be a second decoder beside the one
 * encoder `oidcPrincipal` is meant to be. The plane pools poll is granted no
 * column of it, because verifying a token needs the principal and nothing more.
 *
 * NO REGISTRATION SURVIVES THE COLUMN. A digest cannot be turned into a client
 * and a row kept without one would name a pool nothing can authenticate as, so
 * the registry is emptied rather than migrated and every pool is registered
 * again.
 */
export const migration009: Migration = {
  version: 9,
  name: "worker-pool-principal",
  statements: [
    `DELETE FROM worker_pool`,
    `ALTER TABLE worker_pool DROP COLUMN credential_digest`,
    `ALTER TABLE worker_pool ADD COLUMN principal text NOT NULL UNIQUE
       CHECK(length(principal) BETWEEN 1 AND 256)`,
    `ALTER TABLE worker_pool ADD COLUMN client_id text NOT NULL UNIQUE
       CHECK(length(client_id) BETWEEN 1 AND 256)`,
    `GRANT SELECT(principal) ON worker_pool TO ${poolPlaneRole}`,
  ],
};
