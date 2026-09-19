import {
  poolPlaneRole,
  roleStatement,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * The registry a machine presents itself to a project through, and the role of
 * the plane that serves it.
 *
 * A POOL'S CREDENTIAL IS STORED AS A DIGEST AND NOWHERE ELSE, which is what
 * `capability_digest` already does for one attempt's bearer. The two live in
 * different relations on purpose: the plane a harness reaches looks a bearer up
 * in `ticket_execution` and holds no privilege here at all, so a pool's
 * credential cannot report a terminal however it is presented.
 *
 * `pool` NAMES THE REGISTRY WITHOUT REFERENCING IT. Deregistering a pool that
 * still holds work must not be refused by a foreign key: the leases expire, the
 * claim predicate reclaims what they held, and that is the whole of pool
 * liveness.
 */
export const migration008: Migration = {
  version: 8,
  name: "worker-pool",
  statements: [
    roleStatement(poolPlaneRole),
    `CREATE TABLE worker_pool (
       tenant text NOT NULL, project text NOT NULL,
       pool text NOT NULL CHECK(length(pool) BETWEEN 1 AND 256),
       capabilities text[] NOT NULL DEFAULT '{}',
       credential_digest text NOT NULL UNIQUE CHECK(credential_digest ~ '^[0-9a-f]{64}$'),
       registered_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,pool),
       FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
    `GRANT SELECT,INSERT,DELETE ON worker_pool TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,pool,capabilities,credential_digest) ON worker_pool TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,project,task_key,state,attempt,claim_owner,claim_expires_at,
       recovery_epoch,available_at,required_capabilities,worker_view,pool,assignment,pool_refusal)
       ON ticket_execution TO ${poolPlaneRole}`,
    `GRANT UPDATE(state,attempt,claim_owner,claim_expires_at,recovery_epoch,available_at,
       capability_digest,pool,assignment,pool_refusal) ON ticket_execution TO ${poolPlaneRole}`,
    `GRANT SELECT ON recovery_epoch TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,project,lifecycle,ticket_model) ON project TO ${poolPlaneRole}`,
  ],
};
