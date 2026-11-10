/**
 * An inquiry admitted on the lead's subsidy forks only a lead on the profile's
 * credential slot.
 *
 * `open_lead_inquiry` TAKES WHETHER THE TURN WAS ADMITTED ON THE SUBSIDY, and
 * still no slot. A member's inquiry of a subsidized lead asks no hosted grant,
 * but the fork runs on the slot of whichever lead is standing, and a lead opened
 * before its project chose the subsidy stands on the selector's own slot until
 * its next decision replaces it. So such an inquiry answers `LeadNotSubsidized`
 * unless the parent's slot is the one `session_lead_profile` answers. The door
 * reads the profile itself, so an offering changed since the API admitted the
 * turn is the one the fork is held to.
 */

import {
  apiRole,
  boundaryOwnerRole,
  leadInquiryOpenFunction,
  sessionLeadProfileFunction,
  type Migration,
} from "../shared.ts";

const before = `public.${leadInquiryOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text, in_route text)`;

const inquiryOpen = `public.${leadInquiryOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text, in_route text, in_subsidized boolean)`;

export const migration147: Migration = {
  version: 147,
  name: "an inquiry admitted on the lead's subsidy forks only a lead on the profile's slot",
  statements: [
    `DROP FUNCTION ${before}`,
    `CREATE FUNCTION ${inquiryOpen} RETURNS TABLE(opened text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE standing bigint; parent record; head bigint; held bigint; answered record;
     BEGIN
       SELECT t.ordinal INTO standing FROM session_turn t
         JOIN agent_session s ON s.tenant=t.tenant AND s.project=t.project
                             AND s.session=t.session
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Inquiry' AND s.principal=in_principal AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,standing,in_session; RETURN;
       END IF;
       SELECT s.session,s.state,s.agent_reference,s.credential_slot,
              s.account,s.cluster,s.system_prompt
         INTO parent FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
        FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF parent.state<>'Open' THEN
         RETURN QUERY SELECT 'LeadClosed'::text,NULL::bigint,parent.session; RETURN;
       END IF;
       IF in_subsidized AND parent.credential_slot IS DISTINCT FROM
            (SELECT p.credential_slot FROM ${sessionLeadProfileFunction}(in_tenant,in_project) p) THEN
         RETURN QUERY SELECT 'LeadNotSubsidized'::text,NULL::bigint,parent.session; RETURN;
       END IF;
       SELECT (SELECT coalesce(max(t.batch_last),0) FROM session_turn t
                WHERE t.tenant=in_tenant AND t.project=in_project AND t.session=parent.session
                  AND t.state IN ('Answered','Failed')) INTO head;
       IF parent.agent_reference IS NULL OR head=0 THEN
         RETURN QUERY SELECT 'LeadNotStarted'::text,NULL::bigint,parent.session;
         RETURN;
       END IF;
       SELECT count(*) INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Inquiry' AND s.principal=in_principal AND s.state='Open';
       IF held>=2 THEN
         RETURN QUERY SELECT 'InFlight'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,parent_session,capabilities,
          credential_slot,account,cluster,system_prompt)
       VALUES(in_tenant,in_project,in_session,'Inquiry',in_principal,parent.session,
              ARRAY['ProjectRead']::text[],parent.credential_slot,parent.account,parent.cluster,
              parent.system_prompt || $inquiry_objectives$

# Why this session exists

You are a fork of this project's lead, opened to answer one question a member
asked aside. Answer it from what the lead already holds, and stop.

This is a question asked aside: nothing you say here reaches the lead's record, and no tool you hold writes.$inquiry_objectives$);
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,in_session,in_turn,'Inquiry',in_question,in_route);
       RETURN QUERY SELECT 'Opened'::text,answered.ordinal,in_session;
     END $_$`,
    `ALTER FUNCTION ${inquiryOpen} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${inquiryOpen} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${inquiryOpen} TO ${apiRole}`,
  ],
};
