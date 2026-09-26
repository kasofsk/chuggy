import {
  apiRole,
  boundaryOwnerRole,
  poolPlaneRole,
  workerPoolFenceFunction,
  type Migration,
} from "../shared.ts";

/**
 * An attempt a pool holds records the registration that claimed it, and
 * registering the pool's name again fences what an older registration holds.
 * This is `model/runner.qnt`'s `takeOver` and `reportIsCurrent`, with the
 * principal as the session generation: every registration mints a new client,
 * and so a new principal.
 *
 * `pool_principal` IS SET EXACTLY WHEN `pool` IS. A claim writes both and a
 * release clears both, and the pool plane's calls on an assignment are refused
 * where the principal they ask under is not the one recorded. No deployment has
 * routed an execution to a pool, so no row holds one and the CHECK validates
 * without a backfill; a database that did hold one refuses this migration
 * rather than being handed a principal guessed for it.
 *
 * A FENCED ATTEMPT HAS NO BEARER. Every function the harness reaches finds its
 * attempt by `capability_secret_digest` equal to the digest of the bearer
 * offered, and NULL equals nothing, so the column may now be NULL and the old
 * harness is refused at once. Its attempt stays placing or running until its
 * lease lapses into `Lost`.
 *
 * THE API IS GRANTED THE FENCE AND NOT THE COLUMN. Registration runs as the
 * API, and `UPDATE(capability_secret_digest)` would let that role write any
 * digest into any attempt, which is minting a bearer for work it does not run.
 * The function writes NULL alone, on the live attempts of one pool name that
 * the registry row of that name did not claim. It takes the claim's lock
 * first, so a claim that read the older registration and has not committed is
 * waited for and then fenced rather than missed. It locks those attempts in
 * key order, as the reaper does, so a registration and a reap cannot deadlock.
 */
export const migration022: Migration = {
  version: 22,
  name: "a pool's attempt records the registration that claimed it",
  statements: [
    `ALTER TABLE public.execution_attempt ADD COLUMN pool_principal text
       CONSTRAINT execution_attempt_pool_principal_is_bounded
       CHECK (pool_principal IS NULL OR length(pool_principal) BETWEEN 1 AND 256)`,
    `ALTER TABLE public.execution_attempt ADD CONSTRAINT execution_attempt_pool_principal_is_a_pool_s
       CHECK ((pool IS NULL) = (pool_principal IS NULL))`,
    `ALTER TABLE public.execution_attempt ALTER COLUMN capability_secret_digest DROP NOT NULL`,
    `GRANT SELECT(pool_principal),UPDATE(pool_principal) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `GRANT UPDATE(capability_secret_digest) ON TABLE public.execution_attempt TO ${boundaryOwnerRole}`,
    `GRANT SELECT(tenant,project,pool,principal) ON TABLE public.worker_pool TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'worker-pool-claim:' || in_tenant || '/' || in_project || '/' || in_pool, 0));
       UPDATE execution_attempt a SET capability_secret_digest=NULL
        WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
          SELECT q.tenant,q.project,q.execution,q.attempt
            FROM execution_attempt q
            JOIN worker_pool w
              ON w.tenant=q.tenant AND w.project=q.project AND w.pool=q.pool
           WHERE w.tenant=in_tenant AND w.project=in_project AND w.pool=in_pool
             AND q.pool_principal<>w.principal
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
     END $$`,
    `ALTER FUNCTION public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text) TO ${apiRole}`,
  ],
};
