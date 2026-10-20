/**
 * A member holds many personal runners in a tenant, each a registration of its
 * own with its own room.
 *
 * A RUNNER IS KEYED BY ITS CLIENT BESIDE ITS MEMBER. `(tenant, owner)` names a
 * member rather than one runner, so the key takes `client_id`, which its
 * registration minted and nothing changes, and a member's runners are read by
 * the key's prefix. Its principal and client id stay unique, so a poll still
 * resolves to one row.
 *
 * THE ALLOWLIST IS THE MEMBER'S, NOT ONE RUNNER'S. It keeps its key and its
 * foreign key to `project`, and loses the one to a runner row, which no longer
 * names one. Every runner of the member serves it, and the API deletes it with
 * the member's last runner.
 *
 * A FENCE ENDS WHAT NONE OF THE MEMBER'S RUNNERS HOLDS. An attempt is fenced
 * where its principal is no current runner's of its owner, so removing one
 * runner ends what it held and leaves what the others hold standing.
 *
 * A RUNNER'S ROOM IS ITS OWN. A personal session is opened against what the
 * claiming registration holds, not what its member's runners hold together.
 *
 * NOTHING REPLACES A RUNNER IN PLACE, so the API keeps no column write on it.
 *
 * The bodies are written out rather than built from the helpers `049` and `050`
 * use, so this file goes on saying what it installed when those change.
 */

import {
  apiRole,
  personalRunnerFenceFunction,
  personalSessionOpenFunction,
  sessionTurnReleaseFunction,
  sessionWaitingRouteFunction,
  type Migration,
} from "../shared.ts";

const opened = `public.${personalSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const fenced = `public.${personalRunnerFenceFunction}(in_tenant text, in_owner text)`;

/** An attempt `q` claimed by a registration that is none of its owner's current runners. */
const unregistered = `NOT EXISTS(SELECT 1 FROM personal_runner r
                         WHERE r.tenant=in_tenant AND r.owner=in_owner
                           AND r.principal=q.pool_principal)`;

export const migration070: Migration = {
  version: 70,
  name: "a member holds many personal runners in a tenant",
  statements: [
    `ALTER TABLE public.personal_runner_project
       DROP CONSTRAINT personal_runner_project_tenant_owner_fkey`,
    `ALTER TABLE public.personal_runner
       DROP CONSTRAINT personal_runner_pkey,
       ADD PRIMARY KEY (tenant, owner, client_id)`,
    `REVOKE UPDATE(capabilities,principal,client_id,registered_at,last_polled_at,
                   executions_polled_at,runner_package,runner_version)
       ON TABLE public.personal_runner FROM ${apiRole}`,
    `CREATE OR REPLACE FUNCTION ${fenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0));
       UPDATE execution_attempt a SET capability_secret_digest=NULL
        WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
          SELECT q.tenant,q.project,q.execution,q.attempt
            FROM execution_attempt q
           WHERE q.tenant=in_tenant AND q.personal AND q.pool=in_owner
             AND ${unregistered}
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
       FOR stale IN SELECT q.project,q.session,q.attempt FROM session_attempt q
           WHERE q.tenant=in_tenant AND q.personal AND q.pool=in_owner
             AND ${unregistered}
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.session,q.attempt
             FOR UPDATE OF q LOOP
         UPDATE session_attempt a
            SET state='Superseded',generation=a.generation+1,evidence='Fenced',
                ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=stale.attempt;
         PERFORM ${sessionTurnReleaseFunction}(in_tenant,stale.project,stale.session,stale.attempt);
       END LOOP;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${opened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing record; numbered bigint; current text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'personal session attempt % is opened without the invocation and launch its runner fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0));
       PERFORM 1 FROM personal_runner r
         JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
        WHERE r.tenant=in_tenant AND r.owner=in_owner AND r.principal=in_principal
          AND l.project=in_project
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=l.tenant AND p.project=l.project
                        AND p.lifecycle='Active');
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.personal AND h.pool=in_owner
              AND h.pool_principal=in_principal
              AND h.state IN ('Placing','Running'))>=in_held_max THEN
         RETURN 'PoolFull';
       END IF;
       SELECT s.state,s.kind,s.principal,s.capabilities,s.agent_reference
         INTO standing FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          FOR UPDATE;
       IF NOT FOUND OR standing.state<>'Open'
          OR standing.kind<>'Thread'
          OR standing.principal IS DISTINCT FROM in_owner
          OR standing.capabilities IS DISTINCT FROM in_capabilities
          OR standing.agent_reference IS DISTINCT FROM in_agent_reference
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND a.project=in_project
                       AND a.session=in_session
                       AND (a.state IN ('Placing','Running')
                            OR a.ended_at > now() - make_interval(
                                 secs => in_backoff_secs::double precision)))
          OR ${sessionWaitingRouteFunction}(in_tenant,in_project,in_session)
               IS DISTINCT FROM 'Pool' THEN
         RETURN 'NotClaimable';
       END IF;
       SELECT r.epoch INTO current FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest,invocation,
          idle_since,pool,pool_principal,personal,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,true,in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
  ],
};
