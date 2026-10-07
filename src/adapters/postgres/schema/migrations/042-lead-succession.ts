/**
 * The selector may replace its project's lead: it reads what the lead was told
 * and what its newest decision turn spent, and it may close that lead and no
 * other session.
 *
 * `lead_session` IS DROPPED AND RECREATED, because a result type cannot change
 * in place. It answers the lead's stored system prompt and the `tokens` the pod
 * measured of its newest `Answered` turn of kind `Observation`, beside what it
 * answered before. An inquiry's turns are another session's and are not read.
 *
 * `close_project_lead` IS THE NARROW DOOR, AND `close_agent_session` STAYS
 * UNGRANTED. It closes the named session only where it is the project's open
 * lead, so a caller that read a stale lead closes nothing. It refuses while
 * the lead holds a `Queued` or `Claimed` turn, because closing would abandon a
 * decision in flight, and while an inquiry forked from it is still open, so a
 * member's question is never answered by a lead the selector is ending. Both
 * refusals are read under the lead's row lock, which `enqueue_session_turn` and
 * `open_lead_inquiry` take too. It decides nothing about why: that is the
 * selector's.
 */

import {
  boundaryOwnerRole,
  leadCloseFunction,
  leadSessionFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

const read = `public.${leadSessionFunction}(in_tenant text, in_project text)`;

const close = `public.${leadCloseFunction}(in_tenant text, in_project text, in_session text)`;

/** The definer boilerplate each function here ends with. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${selectorServiceRole}`,
  ];
}

export const migration042: Migration = {
  version: 42,
  name: "the selector reads its lead's spend and objectives, and may close it",
  statements: [
    `DROP FUNCTION ${read}`,
    `CREATE FUNCTION ${read} RETURNS TABLE(session text, state text, agent_reference text, system_prompt text, tokens bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.state,s.agent_reference,s.system_prompt,
              (SELECT t.tokens FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session AND t.state='Answered'
                  AND t.input_kind='Observation'
                ORDER BY t.ordinal DESC LIMIT 1)
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
     $$`,
    ...owned(read),
    `CREATE FUNCTION ${close} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text;
     BEGIN
       SELECT s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Lead'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NotLead'; END IF;
       IF held<>'Open' THEN RETURN 'AlreadyClosed'; END IF;
       IF EXISTS(SELECT 1 FROM session_turn t
                  WHERE t.tenant=in_tenant AND t.project=in_project
                    AND t.session=in_session
                    AND t.state IN ('Queued','Claimed')) THEN
         RETURN 'TurnInFlight';
       END IF;
       IF EXISTS(SELECT 1 FROM agent_session i
                  WHERE i.tenant=in_tenant AND i.project=in_project
                    AND i.parent_session=in_session AND i.kind='Inquiry'
                    AND i.state='Open') THEN
         RETURN 'InquiryOpen';
       END IF;
       UPDATE agent_session s SET state='Closed',closed_at=now()
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session;
       RETURN 'Closed';
     END $$`,
    ...owned(close),
  ],
};
