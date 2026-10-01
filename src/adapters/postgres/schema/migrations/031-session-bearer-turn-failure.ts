import {
  boundaryOwnerRole,
  sessionAttemptTurnFailureFunction,
  sessionBearerTurnFailureFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const signature = `public.${sessionBearerTurnFailureFunction}(in_secret_digest text, in_generation bigint)`;

/**
 * The worker plane reads how the last turn to end since a live session bearer's
 * attempt opened failed, if it did, which is what a runner's report of its
 * container's end is recorded under. It answers through the scheduler's own
 * read of the same attempt, so a reported end and an observed one cannot read
 * two different failures.
 */
export const migration031: Migration = {
  version: 31,
  name: "the worker plane reads a live session bearer's last turn failure",
  statements: [
    `CREATE FUNCTION ${signature} RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT ${sessionAttemptTurnFailureFunction}(a.attempt) FROM session_attempt a
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.generation=in_generation
          AND a.state IN ('Placing','Running')
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1)
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${workerPlaneRole}`,
  ],
};
