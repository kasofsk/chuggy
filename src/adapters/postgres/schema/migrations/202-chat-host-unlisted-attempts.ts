/**
 * A chat host's poll ends every attempt its registration holds that the poll
 * does not list.
 *
 * A HOST'S POLL NAMES EVERY SESSION IT HOLDS, so an attempt it holds and does
 * not name is one it no longer runs: a restarted host holds none. Each is
 * ended as the lease reaper ends a lapsed one, `Lost` with its claimed turns
 * released, under `Vanished`, so its thread is claimable again once its
 * backoff runs rather than once its lease does. What it holds is what
 * `chat_host_session_attempt_holding` answers, so a pool's and a personal
 * runner's attempts are never read here, and the most it ends is the bound
 * its caller names.
 */

import {
  boundaryOwnerRole,
  chatHostSessionHoldingFunction,
  chatHostSessionUnlistedEndFunction,
  poolPlaneRole,
  sessionTurnReleaseFunction,
  type Migration,
} from "../shared.ts";

const unlisted = `public.${chatHostSessionUnlistedEndFunction}(in_tenant text, in_owner text, in_principal text, in_listed text[], in_max bigint)`;

export const migration202: Migration = {
  version: 202,
  name: "a chat host's poll ends the attempts it no longer lists",
  statements: [
    `CREATE FUNCTION ${unlisted} RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; ended bigint;
     BEGIN
       IF in_listed IS NULL OR array_position(in_listed, NULL) IS NOT NULL THEN
         RAISE EXCEPTION 'a chat host''s listed attempts must name each one'
           USING ERRCODE = 'null_value_not_allowed';
       END IF;
       ended:=0;
       FOR held IN SELECT h.project,h.session,h.attempt,h.generation
             FROM ${chatHostSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
            WHERE NOT h.assignment=ANY(in_listed)
            ORDER BY h.project,h.session,h.attempt
            LIMIT in_max LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence='Vanished',ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=held.attempt AND a.generation=held.generation
            AND a.state IN ('Placing','Running');
         IF FOUND THEN
           PERFORM ${sessionTurnReleaseFunction}(in_tenant,held.project,held.session,held.attempt);
           ended:=ended+1;
         END IF;
       END LOOP;
       RETURN ended;
     END $$`,
    `ALTER FUNCTION ${unlisted} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${unlisted} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${unlisted} TO ${poolPlaneRole}`,
  ],
};
