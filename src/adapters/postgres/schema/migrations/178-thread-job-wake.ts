/**
 * A thread's live attempt on its member's chat host wakes its own thread, for a
 * job, a watch or a timer it set, through the door the wake pass wakes through.
 *
 * `thread_job_wake_view` IS THE PASS'S CANDIDATE, READ OFF THE ATTEMPT. Under
 * the attempt's bearer it answers the thread, its principal, the route its
 * turns run on, the member's chat host standing and the project's standing
 * rules, which are what `thread_wake_candidates` and the read beside it answer
 * for a change row. A bearer no live attempt holds is `Fenced`, and a lead, an
 * inquiry and a thread held anywhere but a chat host are `NotChatHostThread`,
 * as `report_session_standing` refuses them.
 *
 * `wake_thread_job` IS `wake_member_thread` UNDER A BEARER. It resolves the
 * bearer again, so an attempt fenced since its view wakes nothing, and calls
 * that door for the attempt's own thread, so the mailbox, the replay of a turn
 * already there and the backlog are the pass's.
 */

import {
  boundaryOwnerRole,
  threadJobWakeFunction,
  threadJobWakeViewFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const view = `public.${threadJobWakeViewFunction}(in_secret_digest text, in_generation bigint, in_polled_secs_max bigint)`;

const wake = `public.${threadJobWakeFunction}(in_secret_digest text, in_generation bigint, in_turn text, in_input text, in_route text)`;

/** The definer boilerplate every function this adds ends with. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${workerPlaneRole}`,
  ];
}

/** The attempt a bearer holds where it is a thread's on a chat host, or the verdict it is refused with, returned from the function it is written in. */
const chatHostThreadBound = `SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN verdict := 'Fenced'; RETURN NEXT; RETURN; END IF;
       IF bound.kind<>'Thread' OR NOT EXISTS(SELECT 1 FROM session_attempt a
            WHERE a.attempt=bound.attempt AND a.holder_kind='ChatHost') THEN
         verdict := 'NotChatHostThread'; RETURN NEXT; RETURN;
       END IF;`;

export const migration178: Migration = {
  version: 178,
  name: "a thread's attempt on a chat host wakes its own thread through the wake door",
  statements: [
    `CREATE FUNCTION ${view}
       RETURNS TABLE(verdict text, tenant text, project text, session text,
                     principal text, route text, runner text,
                     standing_rules text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       ${chatHostThreadBound}
       RETURN QUERY
         SELECT 'Viewed'::text,bound.tenant,bound.project,bound.session,
                bound.principal,routed.route,runners.member_standing,
                settings.thread_standing_rules
           FROM session_route(bound.tenant,bound.project,'Thread') routed
          CROSS JOIN session_runner_standing(bound.tenant,bound.project,
                       bound.principal,in_polled_secs_max) runners
           LEFT JOIN selector_project_settings settings
             ON settings.tenant=bound.tenant AND settings.project=bound.project;
     END $$`,
    ...owned(view),
    `CREATE FUNCTION ${wake}
       RETURNS TABLE(verdict text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       ${chatHostThreadBound}
       RETURN QUERY
         SELECT woken.enqueued,woken.ordinal
           FROM wake_member_thread(bound.tenant,bound.project,bound.session,
                                   in_turn,in_input,in_route) woken;
     END $$`,
    ...owned(wake),
  ],
};
