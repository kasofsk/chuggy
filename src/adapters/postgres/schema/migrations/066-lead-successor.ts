/**
 * A closed lead is history, and the project takes a successor.
 *
 * 058 declared `agent_session_one_lead_per_project` over `(tenant, project)
 * WHERE kind='Lead'` with no state predicate, and `open_agent_session` refuses
 * a second `Lead` on the same test. Together they mean a project whose lead
 * ever closes can never hold another — and 062's identity trigger refuses to
 * move a session out of `Closed`, so the standing row cannot be reopened
 * either. Release 18 measured the consequence on a live installation: the
 * inquiry door answered `LeadClosed`, provisioning answered `Conflict`, and
 * every selector pass ended `TerminationUnconfirmed` having spent nothing
 * (kasofsk/chuggy#543). The record says the opposite — the decision log, the
 * North Star and the standing refusals are a sufficient rebuild, which is what
 * `LeadSeeding` already carries to a session with no bound runtime reference.
 * So the uniqueness is over the OPEN leads, here and in the definer's own
 * conflict arm: the index decides which of two concurrent opens wins and the
 * arm is what answers a caller, exactly as 062 arranges for a thread.
 *
 * THE RUNTIME OPENS ONE AND THE PROVISIONING ROOT STILL MAY. `open_project_lead`
 * is the selector service's own door, and it is narrow in the way
 * `open_member_thread` is narrow: the kind is the function's, the roster is this
 * migration's array literal generated from `leadSessionCapabilities`, and the
 * account and cluster are drawn from the project rather than named by the
 * caller. What the caller supplies is who the lead acts as, what it speaks
 * through and what it is told to be — the three facts a deployment holds.
 * Nothing here closes a lead; closing stays `close_agent_session`'s, which no
 * runtime role may execute.
 *
 * EVERY DOOR THAT RESOLVED A LEAD BY ITS KIND WAS USING THE UNIQUENESS AS A KEY.
 * `lead_session`, `enqueue_lead_turn`, `read_lead_standing` (059),
 * `set_session_system_prompt` (061) and `open_lead_inquiry` (063) each select on
 * `kind='Lead'` alone, and each would take an arbitrary row of several. They are
 * replaced here rather than left to a later migration, because a door reading
 * one lead while the door beside it reads another is the defect the relaxed
 * index would otherwise introduce.
 *
 * THERE ARE TWO RESOLUTIONS AND THE DIFFERENCE IS WHAT A DOOR DOES. A door that
 * SHOWS a lead shows the open one, or the last one there was, so a project
 * between leads still has a transcript and a state to read and the arms that
 * name a closed lead — `Closed`, `LeadClosed` — still reach a caller. A door
 * that WRITES a lead's objectives means the one that will take a turn, and
 * where none is open it answers `NoLead`: the next session to open composes its
 * objectives afresh, so writing them onto a closed row would reach nobody and
 * report `Set`.
 *
 * THE SESSION MIGRATIONS ARE NOT IN THE MODEL. `model/` is the ticket machine;
 * sessions, leads and threads are outside it, and this migration proves nothing
 * the model states.
 */

import {
  inquiriesOpenPerMemberMax,
  leadTurnsAnsweredMax,
} from "../../../../contract/http.ts";
import { leadSessionCapabilities } from "../../../../interpreter/leadTools.ts";
import {
  appendedObjectives,
  inquiryRosterLiteral,
  settledHead,
} from "./063-lead-inquiries.ts";
import {
  boundaryOwnerRole,
  leadInquiryOpenFunction,
  leadOpenFunction,
  leadSessionFunction,
  leadStandingReadFunction,
  leadTurnEnqueueFunction,
  schemaTextSet,
  selectorServiceRole,
  sessionOpenFunction,
  sessionSystemPromptSetFunction,
  sessionTurnEnqueueFunction,
  type Migration,
} from "../shared.ts";

/** The roster a lead is opened with, rendered as the literal the definer writes. */
const leadRosterLiteral = `ARRAY[${schemaTextSet([
  ...leadSessionCapabilities,
])}]::text[]`;

/** The argument types `open_project_lead` is named by, shared by its grant and its callers. */
export const leadOpenSignature = "text,text,text,text,text,text";

/**
 * The lead a door WRITES: the project's open one, and no other. It needs no
 * `LIMIT`, and that is the point — the partial unique index below is what makes
 * this subquery single-valued, so a door reading it is reading the control
 * rather than a second opinion about it.
 */
const leadOpenOfProject = `(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead' AND candidate.state='Open')`;

/**
 * The lead a door SHOWS: the open one, or the most recently opened where none
 * is open. The identity breaks a tie on the instant, because two rows opened in
 * one transaction share `opened_at` and a door that answered either of them
 * would answer a different one on the next read.
 */
const leadStandingOfProject = `(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)`;

/**
 * The uniqueness, narrowed to the leads that still take turns, and the
 * provisioning door's own arm narrowed with it. The body is 061's, with the one
 * predicate this migration exists to add; it is written out rather than shared,
 * because a migration whose statements changed when a later one was edited
 * would not be history.
 */
const oneOpenLead = [
  `DROP INDEX agent_session_one_lead_per_project`,
  `CREATE UNIQUE INDEX agent_session_one_lead_per_project
     ON agent_session (tenant, project) WHERE kind = 'Lead' AND state = 'Open'`,
  `CREATE OR REPLACE FUNCTION ${sessionOpenFunction}(
     in_tenant text,in_project text,in_session text,in_kind text,in_principal text,
     in_parent text,in_capabilities text[],in_credential_slot text,
     in_system_prompt text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record; drawn record;
     BEGIN
       SELECT s.kind,s.principal,s.parent_session,s.capabilities,s.credential_slot,
              s.system_prompt,s.state
         INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        FOR UPDATE;
       IF FOUND THEN
         RETURN CASE WHEN held.state='Open' AND held.kind=in_kind
                      AND held.principal=in_principal
                      AND held.parent_session IS NOT DISTINCT FROM in_parent
                      AND held.capabilities IS NOT DISTINCT FROM in_capabilities
                      AND held.credential_slot=in_credential_slot
                      AND held.system_prompt IS NOT DISTINCT FROM in_system_prompt
                     THEN 'AlreadyOpen' ELSE 'Conflict' END;
       END IF;
       IF in_kind='Lead' AND EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead'
              AND s.state='Open') THEN
         RETURN 'Conflict';
       END IF;
       IF in_kind='Thread' AND EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open') THEN
         RETURN 'Conflict';
       END IF;
       IF in_kind='Inquiry' AND NOT EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_parent) THEN
         RETURN 'Conflict';
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,parent_session,capabilities,
          credential_slot,account,cluster,system_prompt)
       VALUES(in_tenant,in_project,in_session,in_kind,in_principal,in_parent,
              in_capabilities,in_credential_slot,drawn.account,drawn.cluster,
              in_system_prompt);
       RETURN 'Opened';
     END $$`,
];

/**
 * The successor door, shaped as `open_member_thread` is: a pre-check that
 * answers what the exception arm answers, an insert the partial unique index
 * arbitrates, and a re-read turning a race lost against that index into the
 * session that won — so a caller retrying with a new identity finds the lead
 * that exists rather than minting a second.
 */
const successorDoor = [
  `CREATE FUNCTION ${leadOpenFunction}(
     in_tenant text,in_project text,in_session text,in_principal text,
     in_credential_slot text,in_system_prompt text)
     RETURNS TABLE(opened text,session text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text; drawn record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Lead' AND s.state='Open'
        FOR UPDATE;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       BEGIN
         INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt)
         VALUES(in_tenant,in_project,in_session,'Lead',in_principal,
                ${leadRosterLiteral},in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt);
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Lead' AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`,
  `ALTER FUNCTION ${leadOpenFunction}(${leadOpenSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${leadOpenFunction}(${leadOpenSignature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${leadOpenFunction}(${leadOpenSignature})
     TO ${selectorServiceRole}`,
];

/** The three doors 059 keyed on the kind alone, each now saying which lead it means. */
const resolvedSelectorDoors = [
  `CREATE OR REPLACE FUNCTION ${leadSessionFunction}(in_tenant text,in_project text)
     RETURNS TABLE(session text,state text,agent_reference text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.session,s.state,s.agent_reference FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=${leadStandingOfProject}
     $$`,
  `CREATE OR REPLACE FUNCTION ${leadTurnEnqueueFunction}(
     in_tenant text,in_project text,in_turn text,in_input text)
     RETURNS TABLE(enqueued text,ordinal bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text; answered record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=${leadStandingOfProject};
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint; RETURN;
       END IF;
       SELECT * INTO answered FROM ${sessionTurnEnqueueFunction}(
         in_tenant,in_project,held,in_turn,'Observation',in_input);
       RETURN QUERY SELECT answered.enqueued,answered.ordinal;
     END $$`,
  `CREATE OR REPLACE FUNCTION ${leadStandingReadFunction}(
     in_tenant text,in_project text,in_turns_max bigint)
     RETURNS TABLE(session text,session_state text,agent_reference text,
                   attention text,notification_cursor bigint,handoff_note text,
                   turn text,turn_ordinal bigint,input_kind text,turn_state text,
                   failure text,model text,tokens bigint,cost_micros bigint,
                   duration_ms bigint,tools text[],
                   batch_first bigint,batch_last bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.session,s.state,s.agent_reference,
              coalesce(p.attention,'Monitoring'),
              coalesce(p.notification_cursor,0),
              coalesce(p.handoff_note,'{}'),
              tail.turn,tail.ordinal,tail.input_kind,tail.state,tail.failure,
              tail.model,tail.tokens,tail.cost_micros,tail.duration_ms,tail.tools,
              tail.batch_first,tail.batch_last
         FROM agent_session s
         LEFT JOIN selector_project_state p
                ON p.tenant=s.tenant AND p.project=s.project
         LEFT JOIN LATERAL (
           SELECT t.turn,t.ordinal,t.input_kind,t.state,t.failure,t.model,
                  t.tokens,t.cost_micros,t.duration_ms,t.tools,
                  t.batch_first,t.batch_last
             FROM session_turn t
            WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
            ORDER BY t.ordinal DESC
            LIMIT least(coalesce(in_turns_max,${leadTurnsAnsweredMax}),
                        ${leadTurnsAnsweredMax})) tail ON true
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=${leadStandingOfProject}
        ORDER BY tail.ordinal
     $$`,
];

/**
 * The objectives door, which means the lead that will take a turn. A project
 * between leads answers `NoLead` rather than writing objectives onto a closed
 * row: the successor composes its own from the settings it is opened under, so
 * a write there would reach nobody and still report `Set`.
 */
const resolvedObjectivesDoor = [
  `CREATE OR REPLACE FUNCTION ${sessionSystemPromptSetFunction}(
     in_tenant text,in_project text,in_prompt text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record;
     BEGIN
       SELECT s.session,s.system_prompt INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=${leadOpenOfProject}
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoLead'; END IF;
       IF held.system_prompt IS NOT DISTINCT FROM in_prompt THEN
         RETURN 'Unchanged';
       END IF;
       UPDATE agent_session s SET system_prompt=in_prompt
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=held.session;
       RETURN 'Set';
     END $$`,
];

/**
 * The ask door, forking the lead a member was shown. Its `LeadClosed` arm is
 * what a project between leads now answers, which is the honest one: the lead
 * that stands is closed, and the successor a selector pass opens is not this
 * member's to conjure.
 */
const resolvedAskDoor = [
  `CREATE OR REPLACE FUNCTION ${leadInquiryOpenFunction}(
     in_tenant text,in_project text,in_principal text,in_session text,
     in_turn text,in_question text)
     RETURNS TABLE(opened text,ordinal bigint,session text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
          AND s.session=${leadStandingOfProject}
        FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF parent.state<>'Open' THEN
         RETURN QUERY SELECT 'LeadClosed'::text,NULL::bigint,parent.session; RETURN;
       END IF;
       SELECT ${settledHead(
         "t.tenant=in_tenant AND t.project=in_project",
         "parent.session",
       )} INTO head;
       IF parent.agent_reference IS NULL OR head=0 THEN
         RETURN QUERY SELECT 'LeadNotStarted'::text,NULL::bigint,parent.session;
         RETURN;
       END IF;
       SELECT count(*) INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Inquiry' AND s.principal=in_principal AND s.state='Open';
       IF held>=${inquiriesOpenPerMemberMax} THEN
         RETURN QUERY SELECT 'InFlight'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,parent_session,capabilities,
          credential_slot,account,cluster,system_prompt)
       VALUES(in_tenant,in_project,in_session,'Inquiry',in_principal,parent.session,
              ${inquiryRosterLiteral},parent.credential_slot,parent.account,parent.cluster,
              parent.system_prompt || ${appendedObjectives});
       SELECT * INTO answered FROM ${sessionTurnEnqueueFunction}(
         in_tenant,in_project,in_session,in_turn,'Inquiry',in_question);
       RETURN QUERY SELECT 'Opened'::text,answered.ordinal,in_session;
     END $$`,
];

/** A closed lead is history, and the project's next decision opens a successor. */
export const migration066: Migration = {
  version: 66,
  name: "a closed lead is history and the project takes a successor",
  statements: [
    ...oneOpenLead,
    ...successorDoor,
    ...resolvedSelectorDoors,
    ...resolvedObjectivesDoor,
    ...resolvedAskDoor,
  ],
};
