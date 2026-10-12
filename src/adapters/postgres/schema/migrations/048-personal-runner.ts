import {
  apiRole,
  boundaryOwnerRole,
  poolPlaneRole,
  type Migration,
} from "../shared.ts";

/**
 * The registry a member's own runner is known by, the projects it may serve,
 * and the tokens it is registered with.
 *
 * A PERSONAL RUNNER IS A TENANT'S ROW, NOT A POOL'S. It is keyed by its tenant
 * and its owner, so a member holds at most one in a tenant and none outside
 * it, and it names no project. `worker_pool` is keyed by project and its class
 * CHECK admits `Dedicated` alone, which this table leaves as it is: nothing a
 * pool is changes because a member registers a runner.
 *
 * ITS PRINCIPAL IS A CLIENT OF THE SAME ISSUER, AND OF NO RELATION. As a pool's
 * is, the principal is what that client's subject resolves to and the client id
 * is kept to remove it by. No tuple names it, so it holds no permit of any
 * project. A Hydra client id is unique at the issuer, so a principal here is
 * never one `worker_pool` records, and that table's `identify` never resolves
 * one.
 *
 * THE ALLOWLIST IS THE OWNER'S AND STARTS EMPTY. A row names one project of the
 * runner's own tenant, which both foreign keys hold by sharing `tenant`, and
 * goes with the runner it belongs to. Replacing a runner keeps its row, so the
 * allowlist is the owner's choice across machines; taking the runner off takes
 * the allowlist with it.
 *
 * A TOKEN IS MINTED FOR A TENANT BY ITS OWNER-TO-BE. It is the pool token's
 * shape — a digest, single use, an expiry, a capability bound — keyed by the
 * tenant and the member minting it rather than by a project, so it is a table
 * of its own rather than a nullable project on the pool's.
 *
 * THE API WRITES ALL THREE AND READS NO TENANT. A runner or a token naming a
 * tenant that is not a row is refused by its foreign key, which is how the API
 * learns the tenant is absent; `tenant` stays behind the creation doors.
 *
 * THE POOL PLANE AND THE BOUNDARY OWNER READ. The pool plane reads who a
 * runner is and what it may serve, and stamps its poll; the boundary owner,
 * whose functions answer for sessions, reads who a runner is, when it last
 * polled and what it may serve. Neither reads a token or a client, and neither
 * may change what a runner is or serves.
 */
export const migration048: Migration = {
  version: 48,
  name: "a member registers a personal runner in a tenant",
  statements: [
    `CREATE TABLE public.personal_runner (
       tenant text NOT NULL
         CONSTRAINT personal_runner_names_a_tenant
         REFERENCES public.tenant(tenant),
       owner text NOT NULL
         CONSTRAINT personal_runner_owner_is_bounded
         CHECK (length(owner) BETWEEN 1 AND 256),
       capabilities text[] NOT NULL,
       principal text NOT NULL UNIQUE
         CONSTRAINT personal_runner_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       client_id text NOT NULL UNIQUE
         CONSTRAINT personal_runner_client_id_is_bounded
         CHECK (length(client_id) BETWEEN 1 AND 256),
       registered_at timestamptz NOT NULL DEFAULT now(),
       last_polled_at timestamptz,
       PRIMARY KEY (tenant, owner))`,
    `CREATE TABLE public.personal_runner_project (
       tenant text NOT NULL,
       owner text NOT NULL,
       project text NOT NULL,
       allowed_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant, owner, project),
       FOREIGN KEY (tenant, owner)
         REFERENCES public.personal_runner(tenant, owner) ON DELETE CASCADE,
       FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project))`,
    `CREATE TABLE public.personal_runner_registration_token (
       token_digest text PRIMARY KEY
         CONSTRAINT personal_runner_registration_token_digest_is_hex
         CHECK (token_digest ~ '^[0-9a-f]{64}$'),
       tenant text NOT NULL
         CONSTRAINT personal_runner_registration_token_names_a_tenant
         REFERENCES public.tenant(tenant),
       minted_by text NOT NULL
         CONSTRAINT personal_runner_registration_token_minted_by_is_bounded
         CHECK (length(minted_by) BETWEEN 1 AND 256),
       capabilities text[] NOT NULL DEFAULT '{}',
       expires_at timestamptz NOT NULL,
       redeemed_at timestamptz,
       minted_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX personal_runner_registration_token_by_minter
       ON public.personal_runner_registration_token(tenant, minted_by)`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.personal_runner TO ${apiRole}`,
    `GRANT UPDATE(capabilities,principal,client_id,registered_at,last_polled_at)
       ON TABLE public.personal_runner TO ${apiRole}`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.personal_runner_project TO ${apiRole}`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.personal_runner_registration_token TO ${apiRole}`,
    `GRANT UPDATE(redeemed_at) ON TABLE public.personal_runner_registration_token TO ${apiRole}`,
    `GRANT SELECT(tenant,owner,capabilities,principal) ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `GRANT UPDATE(last_polled_at) ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,owner,project) ON TABLE public.personal_runner_project TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,owner,principal,last_polled_at) ON TABLE public.personal_runner TO ${boundaryOwnerRole}`,
    `GRANT SELECT(tenant,owner,project) ON TABLE public.personal_runner_project TO ${boundaryOwnerRole}`,
  ],
};
