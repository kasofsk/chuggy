import {
  apiRole,
  poolPlaneRole,
  roleStatement,
  schedulerRole,
  type Migration,
} from "../shared.ts";

/**
 * The registry a machine presents itself to a project through, the role of the
 * plane that serves it, and the three columns an attempt a pool holds carries.
 *
 * A POOL'S SECRET IS NOT STORED HERE AT ALL. A pool is a confidential OAuth2
 * client of the issuer this installation already runs, so what the row keeps is
 * the principal that client's subject resolves to — the same value every other
 * caller of this tree is recorded under — and the authority that decides what
 * the pool may do is the one already answering for every project. `client_id`
 * is kept beside it and read by the owner's command alone, because taking a
 * pool off a project has to take its client off the issuer and deriving a
 * subject back out of a principal would be a second decoder beside the one
 * encoder `oidcPrincipal` is meant to be.
 *
 * `pool` NAMES THE REGISTRY WITHOUT REFERENCING IT. Deregistering a pool that
 * still holds work must not be refused by a foreign key: the leases expire, the
 * scheduler's own reaper ends what they held, and that is the whole of pool
 * liveness.
 *
 * AN ASSIGNMENT IS OPAQUE BECAUSE AN EXECUTION IDENTITY IS NOT. A pool that
 * could read one would learn the tenant's ticket structure, so the handle is
 * drawn per claim and unique across the table, and every call a pool makes is
 * resolved through it alone.
 *
 * A REFUSAL IS NOT AN OUTCOME AND IS NOT WRITTEN AS ONE. It has its own column
 * so that the credential a pool polls with never needs the privilege a harness
 * reports a result under, and the scheduler turns it into the attempt's
 * terminal where every other terminal is decided — which is the slice that
 * routes work to a pool, and is why the scheduler is granted nothing on these
 * columns here beyond the `placement` its launch read now names.
 *
 * `placement` IS WHAT ROUTES ONE EXECUTION AND NOTHING SETS IT YET. Every row
 * is `InCluster`, which is what the scheduler's own launch already does, so a
 * pool is offered nothing until the slice that marks an execution for one
 * arrives. The column exists now because the claim predicate below has to name
 * it, and a predicate that named no column would offer pools the work the
 * scheduler is about to place itself.
 */
export const migration002: Migration = {
  version: 2,
  name: "worker-pool",
  statements: [
    roleStatement(poolPlaneRole),
    `GRANT USAGE ON SCHEMA public TO ${poolPlaneRole}`,
    `GRANT SELECT ON TABLE public.schema_migration TO ${poolPlaneRole}`,
    `ALTER TABLE public.execution ADD COLUMN placement text NOT NULL DEFAULT 'InCluster'
       CONSTRAINT execution_placement_is_known CHECK (placement IN ('InCluster','Pool'))`,
    `ALTER TABLE public.execution_attempt ADD COLUMN pool text
       CONSTRAINT execution_attempt_pool_is_bounded
       CHECK (pool IS NULL OR length(pool) BETWEEN 1 AND 256)`,
    `ALTER TABLE public.execution_attempt ADD COLUMN assignment text UNIQUE
       CONSTRAINT execution_attempt_assignment_is_bounded
       CHECK (assignment IS NULL OR length(assignment) BETWEEN 1 AND 256)`,
    `ALTER TABLE public.execution_attempt ADD COLUMN pool_refusal text
       CONSTRAINT execution_attempt_pool_refusal_is_bounded
       CHECK (pool_refusal IS NULL OR length(pool_refusal) BETWEEN 1 AND 4096)`,
    `ALTER TABLE public.execution_attempt ADD CONSTRAINT execution_attempt_assignment_is_a_pool_s
       CHECK ((pool IS NULL) = (assignment IS NULL))`,
    `CREATE TABLE public.worker_pool (
       tenant text NOT NULL, project text NOT NULL,
       pool text NOT NULL CHECK(length(pool) BETWEEN 1 AND 256),
       capabilities text[] NOT NULL DEFAULT '{}',
       principal text NOT NULL UNIQUE CHECK(length(principal) BETWEEN 1 AND 256),
       client_id text NOT NULL UNIQUE CHECK(length(client_id) BETWEEN 1 AND 256),
       registered_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,pool),
       FOREIGN KEY(tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TABLE public.worker_pool_registration_token (
       token_digest text PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
       tenant text NOT NULL, project text NOT NULL,
       capabilities text[] NOT NULL DEFAULT '{}',
       expires_at timestamptz NOT NULL,
       redeemed_at timestamptz,
       minted_at timestamptz NOT NULL DEFAULT now(),
       FOREIGN KEY(tenant,project) REFERENCES public.project(tenant,project))`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.worker_pool TO ${apiRole}`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.worker_pool_registration_token TO ${apiRole}`,
    `GRANT UPDATE(redeemed_at) ON TABLE public.worker_pool_registration_token TO ${apiRole}`,
    `GRANT SELECT(tenant,project,pool,capabilities,principal) ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,project,execution,status,placement,placement_backoff_from,requirement_value)
       ON TABLE public.execution TO ${poolPlaneRole}`,
    `GRANT UPDATE(placement_backoff_from) ON TABLE public.execution TO ${poolPlaneRole}`,
    `GRANT EXECUTE ON FUNCTION public.execution_status_move_is_legal(before text, after text) TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,project,execution,attempt,generation,recovery_epoch,state,
       lease_owner,lease_expires_at,opened_at,pool,assignment,pool_refusal)
       ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `GRANT UPDATE(lease_owner,lease_expires_at,capability_secret_digest,pool,assignment,pool_refusal)
       ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,project,lifecycle) ON TABLE public.project TO ${poolPlaneRole}`,
    `GRANT SELECT ON TABLE public.recovery_epoch TO ${poolPlaneRole}`,
    `GRANT SELECT(placement) ON TABLE public.execution TO ${schedulerRole}`,
  ],
};
