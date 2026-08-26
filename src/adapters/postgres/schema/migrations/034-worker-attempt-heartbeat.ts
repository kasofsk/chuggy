import {
  boundaryOwnerRole,
  workerAttemptHeartbeatFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** Fenced renewal for a live worker attempt's short liveness lease. */
export const migration034: Migration = {
  version: 34,
  name: "worker attempt heartbeat",
  statements: [
    `CREATE FUNCTION ${workerAttemptHeartbeatFunction}(
       in_secret_digest text,in_generation bigint,in_lease_secs bigint)
       RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
       SET search_path=pg_catalog,public,pg_temp AS $$
       BEGIN
         IF in_lease_secs <= 0 THEN RETURN false; END IF;
         UPDATE execution_attempt a
            SET lease_expires_at=now()+make_interval(secs=>in_lease_secs::double precision)
           FROM execution e
          WHERE a.capability_secret_digest=in_secret_digest
            AND a.generation=in_generation
            AND a.state='Running'
            AND a.lease_expires_at>now()
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
            AND e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
            AND e.status='Running';
         RETURN FOUND;
       END $$`,
    `ALTER FUNCTION ${workerAttemptHeartbeatFunction}(text,bigint,bigint)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerAttemptHeartbeatFunction}(text,bigint,bigint) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerAttemptHeartbeatFunction}(text,bigint,bigint)
       TO ${workerPlaneRole}`,
  ],
};
