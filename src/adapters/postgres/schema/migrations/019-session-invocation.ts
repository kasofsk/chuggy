import {
  boundaryOwnerRole,
  schedulerRole,
  sessionAttemptOpenFunction,
  sessionTaskReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The longest invocation the column admits, in bytes of its text: the carrier a pod's task travels in. */
export const sessionAttemptInvocationBytesMax = 131_072;

/** The opening signature before this migration, which the one taking an invocation replaces. */
const openedWithout = `public.${sessionAttemptOpenFunction}(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint)`;

const openedWith = `public.${sessionAttemptOpenFunction}(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint, in_invocation jsonb)`;

const readTask = `public.${sessionTaskReadFunction}(in_secret_digest text)`;

/**
 * A session attempt records what its pod is handed, written only by the
 * function that opens it and read only through `read_session_task`, whose
 * liveness is `read_session_attempt`'s. Nothing is granted an update of it, so
 * `session_attempt_is_fenced` needs no change.
 */
export const migration019: Migration = {
  version: 19,
  name: "a session attempt records its invocation",
  statements: [
    `ALTER TABLE public.session_attempt
       ADD COLUMN invocation jsonb
         CONSTRAINT session_attempt_invocation_is_bounded
         CHECK (invocation IS NULL OR octet_length(invocation::text) <= ${String(sessionAttemptInvocationBytesMax)})`,
    `DROP FUNCTION ${openedWithout}`,
    `CREATE FUNCTION ${openedWith} RETURNS TABLE(opened text, attempt text, generation bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; numbered bigint;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object' THEN
         RAISE EXCEPTION 'session attempt % is opened without an invocation, and its pod fetches the one recorded here',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       SELECT s.state,s.account,s.cluster INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND OR held.state<>'Open'
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND project=in_project AND session=in_session AND a.state IN ('Placing','Running'))
          OR NOT EXISTS(SELECT 1 FROM session_turn t
                     WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.state='Queued') THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=in_tenant AND project=in_project AND session=in_session
                    AND a.ended_at > now() - make_interval(
                          secs => in_backoff_secs::double precision)) THEN
         RETURN QUERY SELECT 'BackingOff'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.account=held.account AND a.state IN ('Placing','Running'))>=in_account_max THEN
         RETURN QUERY SELECT 'AccountAtMaximum'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.cluster=held.cluster AND a.state IN ('Placing','Running'))>=in_cluster_max THEN
         RETURN QUERY SELECT 'ClusterFull'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest,invocation)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,in_epoch,'Placing',
              in_attempt,now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation);
       RETURN QUERY SELECT 'Opened'::text,in_attempt,1::bigint;
     END $$`,
    `ALTER FUNCTION ${openedWith} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${openedWith} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${openedWith} TO ${schedulerRole}`,
    `CREATE FUNCTION ${readTask}
       RETURNS TABLE(tenant text, project text, session text, attempt text,
         generation bigint, kind text, credential_slot text, live boolean,
         invocation jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT a.tenant,a.project,a.session,a.attempt,a.generation,
                s.kind,s.credential_slot,
                (a.state IN ('Placing','Running') AND s.state='Open'
                 AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                        ORDER BY ordinal DESC LIMIT 1)),
                a.invocation
           FROM session_attempt a
           JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                               AND s.session=a.session
          WHERE a.bearer_secret_digest=in_secret_digest
       $$`,
    `ALTER FUNCTION ${readTask} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${readTask} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${readTask} TO ${workerPlaneRole}`,
  ],
};
