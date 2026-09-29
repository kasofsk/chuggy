import { workerAttemptHeartbeatFunction, type Migration } from "../shared.ts";

/**
 * A harness a pool launched is answered live by its heartbeat, and the
 * heartbeat renews nothing of its attempt. A claim leaves the attempt placing
 * under a launching execution and leases it to the pool, whose polls renew it,
 * so the heartbeat that renews only a running attempt refused every pool's
 * harness a minute in, and the harness ended work it was still doing.
 *
 * THE POOL'S LEASE STAYS THE POOL'S. A harness that renewed it would keep an
 * attempt alive under a pool that stopped polling, so its heartbeat answers
 * only whether that lease still holds it, and `model/runner.qnt` lets
 * heartbeat freshness hold placement but never conclude work.
 */
export const migration025: Migration = {
  version: 25,
  name: "a pool's harness heartbeats without renewing the pool's lease",
  statements: [
    `CREATE OR REPLACE FUNCTION public.${workerAttemptHeartbeatFunction}(in_secret_digest text, in_generation bigint, in_lease_secs bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
         IF FOUND THEN RETURN true; END IF;
         RETURN EXISTS(
           SELECT 1 FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest
              AND a.generation=in_generation
              AND a.pool IS NOT NULL AND a.pool_refusal IS NULL
              AND a.lease_expires_at>now()
              AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1));
       END $$`,
  ],
};
