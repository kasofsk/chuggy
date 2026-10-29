/**
 * A personal runner holds no session: what one still held is ended, and the
 * functions it claimed and held sessions through are dropped.
 *
 * WHAT ONE STILL HELD IS ENDED AS REMOVING ITS RUNNER WOULD END IT. Every live
 * attempt whose holder is `Personal` is superseded with evidence `Fenced`, its
 * generation moved past what its runner holds, and the turn it held goes back
 * to its session's queue, charged one attempt, for its owner's chat host to
 * take.
 *
 * NONE CAN BE LIVE AGAIN. `session_attempt_personal_is_finished` refuses a live
 * attempt held `Personal`; one that ended keeps its kind. So the personal
 * runner's fence ends its executions alone, and the reads, the open and the
 * holding, renewal, settlement and image calls a personal runner made for a
 * session are dropped.
 *
 * IT RUNS ONLY UNDER A POOL PLANE THAT CALLS NONE OF THEM. One on an earlier
 * image asks some of them of a personal runner's poll that names what it
 * holds, and would be refused, so the pool plane that stopped asking is rolled
 * out everywhere first.
 *
 * The bodies are written out rather than built from the helpers earlier
 * migrations use, so this file goes on saying what it installed when those
 * change.
 */

import {
  personalRunnerFenceFunction,
  personalSessionAssignmentsFunction,
  personalSessionHeldFunction,
  personalSessionHoldingFunction,
  personalSessionImagesFunction,
  personalSessionOpenFunction,
  personalSessionRefuseFunction,
  personalSessionReleaseFunction,
  personalSessionRenewFunction,
  personalSessionsAwaitingFunction,
  sessionTurnReleaseFunction,
  type Migration,
} from "../shared.ts";

const dropped = [
  `${personalSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_polled_secs_max bigint)`,
  `${personalSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_polled_secs_max bigint)`,
  `${personalSessionAssignmentsFunction}(in_tenant text, in_owner text, in_principal text, in_assignments text[])`,
  `${personalSessionRenewFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text, in_lease_secs bigint)`,
  `${personalSessionHeldFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`,
  `${personalSessionRefuseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text, in_evidence text)`,
  `${personalSessionReleaseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`,
  `${personalSessionImagesFunction}(in_tenant text, in_owner text, in_principal text, in_max bigint)`,
  `${personalSessionHoldingFunction}(in_tenant text, in_owner text, in_principal text)`,
] as const;

const fenced = `public.${personalRunnerFenceFunction}(in_tenant text, in_owner text)`;

export const migration098: Migration = {
  version: 98,
  name: "a personal runner holds no session",
  statements: [
    `WITH ended AS (
       UPDATE public.session_attempt a
          SET state='Superseded',generation=a.generation+1,evidence='Fenced',
              ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.holder_kind='Personal' AND a.state IN ('Placing','Running')
        RETURNING a.tenant,a.project,a.session,a.attempt)
     SELECT public.${sessionTurnReleaseFunction}(e.tenant,e.project,e.session,e.attempt)
       FROM ended e`,
    `ALTER TABLE public.session_attempt
       ADD CONSTRAINT session_attempt_personal_is_finished
         CHECK (holder_kind IS DISTINCT FROM 'Personal'
                OR state NOT IN ('Placing','Running'))`,
    `CREATE OR REPLACE FUNCTION ${fenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0));
       UPDATE execution_attempt a SET capability_secret_digest=NULL
        WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
          SELECT q.tenant,q.project,q.execution,q.attempt
            FROM execution_attempt q
           WHERE q.tenant=in_tenant AND q.personal AND q.pool=in_owner
             AND NOT EXISTS(SELECT 1 FROM personal_runner r
                             WHERE r.tenant=in_tenant AND r.owner=in_owner
                               AND r.principal=q.pool_principal)
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
     END $$`,
    ...dropped.map((signature) => `DROP FUNCTION public.${signature}`),
  ],
};
