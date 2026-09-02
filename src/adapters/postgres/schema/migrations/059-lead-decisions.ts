/**
 * What the lead decided, what it declined to decide, and what the turn behind
 * either one spent. The selector's mailbox door onto its project's lead, the
 * append-only refusal ledger the decision writes beside its interaction, and
 * the reads the API answers a lead page from.
 *
 * THE REFUSAL LEDGER IS APPEND-ONLY AND STANDING IS DERIVED. A lift written as
 * an update of a standing column would not be append-only, and it would lose
 * the thing an owner most wants to see — that the lead refused this ticket
 * twice and lifted it once. So a lift is its own row carrying the version and
 * the reason of the refusal it lifts, standing is "the latest row for the
 * ticket is a refusal", and supersession by a new authoring version is not
 * stored at all: it is a comparison the reader already holds both sides of.
 *
 * THE SELECTOR DOES NOT GET `enqueue_session_turn`. It gets a door that
 * resolves the project's own `Lead` session and writes one input kind, because
 * a role that may name any session may put a turn in a member's thread.
 *
 * THE API GETS DEFINER FUNCTIONS AND NOT TABLE GRANTS. Seven bodies, each
 * bounded and partitioned by its arguments, so the API cannot read another
 * project's session by writing its own predicate — the arrangement
 * `authenticate_session_bearer` is in. A selector-service pool inside the API
 * would be a second credential in a deployment that already has one.
 *
 * BOTH GENERATED CHECKS ARE REPLACED, NOT ONE. `project_change_kind_is_known`
 * and `session_turn_failure_is_known` are each generated from an interpreter
 * roster at the migration that last wrote them, so a fresh installation
 * already holds the wider constraint and one that ran 043 or 058 before these
 * members existed holds the narrower one for ever. Replacing both here is what
 * makes a migrated database and a fresh one end with the same constraint.
 *
 * A MEASUREMENT IS PROVENANCE AND NOT IDENTITY. `answer_session_turn` compares
 * a repeated answer on its result and its batches, exactly as it did, and not
 * on what the pod measured: a retry that re-derived a duration is the same
 * answer, and refusing it would strand a turn the runtime has already taken.
 */

import {
  agenticRefusalLedgerAnsweredMax,
  agenticRefusalReasonCharsMax,
  agenticRefusalsAnsweredMax,
  leadTurnsAnsweredMax,
  selectorHistoryLimitMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamsAnswered,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "../../../../contract/http.ts";
import { allAgentReportedTurnFailures } from "../../../../interpreter/agentSession.ts";
import { allSessionTurnFailures } from "../../../../interpreter/agentSession.ts";
import { allAgenticRefusalEvents } from "../../../../interpreter/agenticRefusal.ts";
import { allProjectChangeKinds } from "../../../../interpreter/projectChange.ts";
import {
  agenticRefusalImmutableFunction,
  agenticRefusalLedgerReadFunction,
  agenticRefusalRecordFunction,
  agenticRefusalStandingFunction,
  agenticRefusalStandingReadFunction,
  apiRole,
  boundaryOwnerRole,
  leadSessionFunction,
  leadStandingReadFunction,
  leadStoreReadFunction,
  leadStreamListFunction,
  leadTurnEnqueueFunction,
  leadTurnReadFunction,
  leadTurnWithdrawFunction,
  projectChangeAgenticRefusalFunction,
  projectChangeAppendFunction,
  schemaTextSet,
  selectorInteractionsReadFunction,
  selectorPlanningIntentReadFunction,
  selectorServiceRole,
  sessionTurnAnswerFunction,
  sessionTurnEnqueueFunction,
  sessionTurnFailFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/**
 * What a refusal read may answer at most: one past the page its response
 * carries, so a reader asking for one more learns there is another page rather
 * than reading twice to find out.
 */
const standingRefusalsCeiling = agenticRefusalsAnsweredMax + 1;
const refusalLedgerCeiling = agenticRefusalLedgerAnsweredMax + 1;

/** The bound one project's identity columns are held to wherever this file writes them. */
const partitionCharsMax = 256;

/** The states a turn may still be withdrawn out of, which is the mailbox's live set. */
const liveTurnStates = "('Queued','Claimed')";

/**
 * The whole text a turn's tool names may weigh, which is every name it may
 * report at the longest each may be. The elements are bounded one by one by
 * the response schema; a `CHECK` may hold no subquery, so what the column
 * bounds is its weight.
 */
const sessionTurnToolsCharsMax =
  sessionTurnToolsMax * (sessionTurnToolNameCharsMax + 1);

/**
 * What one lead turn may spend, where the seeded row was written for a policy
 * that answered in one completion. It is a floor rather than a value: an owner
 * who has already raised either keeps what they set.
 */
export const leadTokensPerDecision = 200_000;
export const leadMillisecondsPerDecision = 900_000;

const refusalRelation = [
  `CREATE TABLE selector_agentic_refusal (
     ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     tenant text NOT NULL, project text NOT NULL,
     ticket bigint NOT NULL,
     event text NOT NULL,
     ticket_version bigint NOT NULL,
     reason text NOT NULL,
     selector_decision text NOT NULL,
     recorded_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT selector_refusal_is_one_per_decision
       UNIQUE (selector_decision, ticket),
     CONSTRAINT selector_refusal_has_its_decision
       FOREIGN KEY (selector_decision, tenant, project)
         REFERENCES selector_interaction (selector_decision, tenant, project),
     CONSTRAINT selector_refusal_event_is_known CHECK (
       event IN (${schemaTextSet([...allAgenticRefusalEvents])})),
     CONSTRAINT selector_refusal_counters_are_positive CHECK (
       ticket >= 1 AND ticket_version >= 1),
     CONSTRAINT selector_refusal_reason_is_bounded CHECK (
       length(reason) BETWEEN 1 AND ${agenticRefusalReasonCharsMax}),
     CONSTRAINT selector_refusal_identity_is_bounded CHECK (
       length(tenant) BETWEEN 1 AND ${partitionCharsMax}
       AND length(project) BETWEEN 1 AND ${partitionCharsMax}))`,
  `CREATE INDEX selector_refusal_by_ticket
     ON selector_agentic_refusal (tenant, project, ticket, ordinal)`,
  `CREATE FUNCTION ${agenticRefusalImmutableFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION
         'refusal % of ticket % is written once, and a ledger that could be edited is not a record',
         OLD.ordinal, OLD.ticket USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `ALTER FUNCTION ${agenticRefusalImmutableFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${agenticRefusalImmutableFunction}() FROM PUBLIC`,
  `CREATE TRIGGER selector_refusal_is_written_once
     BEFORE UPDATE OR DELETE ON selector_agentic_refusal
     FOR EACH ROW EXECUTE FUNCTION ${agenticRefusalImmutableFunction}()`,
  `CREATE FUNCTION ${projectChangeAgenticRefusalFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(
         NEW.tenant,NEW.project,'AgenticRefusal',NEW.ticket::text);
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION ${projectChangeAgenticRefusalFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectChangeAgenticRefusalFunction}() FROM PUBLIC`,
  `CREATE TRIGGER selector_refusal_appends_a_change
     AFTER INSERT ON selector_agentic_refusal
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeAgenticRefusalFunction}()`,
  `GRANT SELECT,INSERT ON selector_agentic_refusal TO ${boundaryOwnerRole}`,
];

/**
 * What the definer bodies below read of the selector's own relations. Read and
 * nothing else: the boundary owner appends a refusal and answers a page, and
 * every relation the selector writes stays the selector's to write.
 */
const boundaryOwnerReads = [
  `GRANT SELECT ON selector_project_state,selector_interaction,
     selector_interaction_resource,selector_planning_intent
     TO ${boundaryOwnerRole}`,
];

/** The kind roster and the failure roster, each replaced where it was last written. */
const replacedRosters = [
  `ALTER TABLE project_change
     DROP CONSTRAINT project_change_kind_is_known,
     ADD CONSTRAINT project_change_kind_is_known CHECK
       (kind IN (${schemaTextSet([...allProjectChangeKinds])}))`,
  `ALTER TABLE session_turn
     DROP CONSTRAINT session_turn_failure_is_known,
     ADD CONSTRAINT session_turn_failure_is_known CHECK
       (failure IS NULL OR failure IN (${schemaTextSet([
         ...allSessionTurnFailures,
       ])}))`,
];

/** The note a lead leaves a successor, under the name the record gives it. */
const renamedHandoffNote = [
  `ALTER TABLE selector_project_state RENAME COLUMN working_memory TO handoff_note`,
];

const measureColumns = [
  `ALTER TABLE session_turn ADD COLUMN model text`,
  `ALTER TABLE session_turn ADD COLUMN tokens bigint`,
  `ALTER TABLE session_turn ADD COLUMN cost_micros bigint`,
  `ALTER TABLE session_turn ADD COLUMN duration_ms bigint`,
  `ALTER TABLE session_turn ADD COLUMN tools text[]`,
  `ALTER TABLE session_turn ADD CONSTRAINT session_turn_measure_is_whole CHECK (
     (model IS NULL) = (tokens IS NULL) AND (model IS NULL) = (cost_micros IS NULL)
     AND (model IS NULL) = (duration_ms IS NULL) AND (model IS NULL) = (tools IS NULL))`,
  `ALTER TABLE session_turn ADD CONSTRAINT session_turn_measure_is_bounded CHECK (
     coalesce(tokens, 0) >= 0 AND coalesce(cost_micros, 0) >= 0
     AND coalesce(duration_ms, 0) >= 0
     AND coalesce(length(model), 1) BETWEEN 1 AND ${sessionTurnModelCharsMax}
     AND coalesce(cardinality(tools), 0) <= ${sessionTurnToolsMax}
     AND coalesce(length(array_to_string(tools, ',')), 0)
         <= ${sessionTurnToolsCharsMax})`,
  `GRANT UPDATE (state,attempt,claim_generation,attempts_spent,result,failure,
                 batch_first,batch_last,claimed_at,ended_at,
                 model,tokens,cost_micros,duration_ms,tools)
     ON session_turn TO ${boundaryOwnerRole}`,
];

const answerSignature = "text,bigint,text,text,bigint,bigint";
const measuredAnswerSignature = `${answerSignature},text,bigint,bigint,bigint,text[]`;
const failSignature = "text,bigint,text,text";

/**
 * The answer door retyped rather than widened, which a signature change is.
 * The measurement is written on the `Answered` arm and nowhere else, so a
 * failed or withdrawn turn holds no record of a spend it never made.
 */
const measuredAnswer = [
  `DROP FUNCTION ${sessionTurnAnswerFunction}(${answerSignature})`,
  `CREATE FUNCTION ${sessionTurnAnswerFunction}(
     in_secret_digest text,in_generation bigint,in_turn text,in_result text,
     in_batch_first bigint,in_batch_last bigint,
     in_model text,in_tokens bigint,in_cost_micros bigint,
     in_duration_ms bigint,in_tools text[]) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_result IS NULL OR length(in_result)>${sessionTurnResultCharsMax}
          OR (in_batch_first IS NULL)<>(in_batch_last IS NULL)
          OR coalesce(in_batch_first,1)>coalesce(in_batch_last,1)
          OR coalesce(in_batch_first,1) NOT BETWEEN 1 AND ${sessionStoreBatchesMax}
          OR coalesce(in_batch_last,1) NOT BETWEEN 1 AND ${sessionStoreBatchesMax} THEN
         RETURN 'Conflict';
       END IF;
       SELECT t.state,t.attempt,t.claim_generation,t.result,t.batch_first,t.batch_last
         INTO stored FROM session_turn t
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn FOR UPDATE;
       IF NOT FOUND THEN RETURN 'Conflict'; END IF;
       IF stored.state='Answered' THEN
         RETURN CASE WHEN stored.result=in_result
                      AND stored.batch_first IS NOT DISTINCT FROM in_batch_first
                      AND stored.batch_last IS NOT DISTINCT FROM in_batch_last
                     THEN 'AlreadyAnswered' ELSE 'Conflict' END;
       END IF;
       IF stored.state<>'Claimed' OR stored.attempt<>bound.attempt
          OR stored.claim_generation<>in_generation THEN
         RETURN 'Conflict';
       END IF;
       UPDATE session_turn t
          SET state='Answered',result=in_result,batch_first=in_batch_first,
              batch_last=in_batch_last,attempt=NULL,claim_generation=NULL,
              claimed_at=NULL,ended_at=now(),
              model=in_model,tokens=in_tokens,cost_micros=in_cost_micros,
              duration_ms=in_duration_ms,tools=in_tools
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn;
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Answered';
     END $$`,
  `ALTER FUNCTION ${sessionTurnAnswerFunction}(${measuredAnswerSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionTurnAnswerFunction}(${measuredAnswerSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionTurnAnswerFunction}(${measuredAnswerSignature})
     TO ${workerPlaneRole}`,
];

/**
 * The failure door retyped so the widened roster does not widen what a pod may
 * say about itself: it admits the agent-reported roster and not the platform's.
 * Nothing else about it moves.
 */
const podNamedFailure = [
  `DROP FUNCTION ${sessionTurnFailFunction}(${failSignature})`,
  `CREATE FUNCTION ${sessionTurnFailFunction}(
     in_secret_digest text,in_generation bigint,in_turn text,in_failure text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_failure IS NULL
          OR in_failure NOT IN (${schemaTextSet([...allAgentReportedTurnFailures])}) THEN
         RETURN 'Conflict';
       END IF;
       SELECT t.state,t.attempt,t.claim_generation,t.failure INTO stored
         FROM session_turn t
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn FOR UPDATE;
       IF NOT FOUND THEN RETURN 'Conflict'; END IF;
       IF stored.state='Failed' THEN
         RETURN CASE WHEN stored.failure=in_failure THEN 'AlreadyFailed'
                     ELSE 'Conflict' END;
       END IF;
       IF stored.state<>'Claimed' OR stored.attempt<>bound.attempt
          OR stored.claim_generation<>in_generation THEN
         RETURN 'Conflict';
       END IF;
       UPDATE session_turn t
          SET state='Failed',failure=in_failure,attempt=NULL,claim_generation=NULL,
              claimed_at=NULL,ended_at=now()
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn;
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Failed';
     END $$`,
  `ALTER FUNCTION ${sessionTurnFailFunction}(${failSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionTurnFailFunction}(${failSignature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionTurnFailFunction}(${failSignature})
     TO ${workerPlaneRole}`,
];

const refusalRecordSignature = "text,text,text,jsonb,jsonb";
const refusalStandingSignature = "text,text,bigint";
const leadSessionSignature = "text,text";
const leadEnqueueSignature = "text,text,text,text";
const leadTurnSignature = "text,text,text";

/**
 * The mailbox and the ledger as the selector's own role reaches them, each
 * resolving the project's `Lead` session itself so the role names a project
 * and never a session. A retry that has already landed is `AlreadyRecorded`
 * and one that raced past that read is stopped by
 * `selector_refusal_is_one_per_decision`, so nothing here locks a relation it
 * may only read.
 */
const selectorDoors = [
  `CREATE FUNCTION ${agenticRefusalRecordFunction}(
     in_tenant text,in_project text,in_decision text,
     in_refusals jsonb,in_lifts jsonb) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE entry jsonb; standing record;
     BEGIN
       PERFORM 1 FROM selector_interaction i
        WHERE i.selector_decision=in_decision
          AND i.tenant=in_tenant AND i.project=in_project;
       IF NOT FOUND THEN
         RAISE EXCEPTION 'decision % has no interaction to record a refusal against',
           in_decision USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF EXISTS(SELECT 1 FROM selector_agentic_refusal r
                  WHERE r.selector_decision=in_decision) THEN
         RETURN 'AlreadyRecorded';
       END IF;
       FOR entry IN
         SELECT * FROM jsonb_array_elements(coalesce(in_refusals,'[]'::jsonb)) LOOP
         INSERT INTO selector_agentic_refusal
           (tenant,project,ticket,event,ticket_version,reason,selector_decision)
         VALUES(in_tenant,in_project,(entry->>'ticket')::bigint,'Refused',
                (entry->>'ticketVersion')::bigint,entry->>'reason',in_decision);
       END LOOP;
       FOR entry IN
         SELECT * FROM jsonb_array_elements(coalesce(in_lifts,'[]'::jsonb)) LOOP
         SELECT r.event,r.ticket_version,r.reason INTO standing
           FROM selector_agentic_refusal r
          WHERE r.tenant=in_tenant AND r.project=in_project
            AND r.ticket=(entry->>'ticket')::bigint
          ORDER BY r.ordinal DESC LIMIT 1;
         IF NOT FOUND OR standing.event<>'Refused' THEN
           RAISE EXCEPTION 'ticket % has no standing refusal to lift',
             entry->>'ticket' USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         INSERT INTO selector_agentic_refusal
           (tenant,project,ticket,event,ticket_version,reason,selector_decision)
         VALUES(in_tenant,in_project,(entry->>'ticket')::bigint,'Lifted',
                standing.ticket_version,standing.reason,in_decision);
       END LOOP;
       RETURN 'Recorded';
     END $$`,
  `CREATE FUNCTION ${agenticRefusalStandingFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(ticket bigint,ticket_version bigint,reason text,
                   selector_decision text,recorded_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT latest.ticket,latest.ticket_version,latest.reason,
              latest.selector_decision,latest.recorded_at
         FROM (SELECT DISTINCT ON (r.ticket)
                      r.ticket,r.event,r.ticket_version,r.reason,
                      r.selector_decision,r.recorded_at
                 FROM selector_agentic_refusal r
                WHERE r.tenant=in_tenant AND r.project=in_project
                ORDER BY r.ticket,r.ordinal DESC) latest
        WHERE latest.event='Refused'
        ORDER BY latest.ticket
        LIMIT least(coalesce(in_max,${standingRefusalsCeiling}),
                    ${standingRefusalsCeiling})
     $$`,
  `CREATE FUNCTION ${leadSessionFunction}(in_tenant text,in_project text)
     RETURNS TABLE(session text,state text,agent_reference text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.session,s.state,s.agent_reference FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead'
     $$`,
  `CREATE FUNCTION ${leadTurnEnqueueFunction}(
     in_tenant text,in_project text,in_turn text,in_input text)
     RETURNS TABLE(enqueued text,ordinal bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text; answered record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead';
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint; RETURN;
       END IF;
       SELECT * INTO answered FROM ${sessionTurnEnqueueFunction}(
         in_tenant,in_project,held,in_turn,'Observation',in_input);
       RETURN QUERY SELECT answered.enqueued,answered.ordinal;
     END $$`,
  `CREATE FUNCTION ${leadTurnReadFunction}(
     in_tenant text,in_project text,in_turn text)
     RETURNS TABLE(state text,result text,failure text,model text,tokens bigint,
                   cost_micros bigint,duration_ms bigint,tools text[])
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT t.state,t.result,t.failure,t.model,t.tokens,
              t.cost_micros,t.duration_ms,t.tools
         FROM session_turn t
         JOIN agent_session s ON s.tenant=t.tenant AND s.project=t.project
                             AND s.session=t.session
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND s.kind='Lead' AND t.turn=in_turn
     $$`,
  `CREATE FUNCTION ${leadTurnWithdrawFunction}(
     in_tenant text,in_project text,in_turn text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record;
     BEGIN
       SELECT t.state INTO held FROM session_turn t
         JOIN agent_session s ON s.tenant=t.tenant AND s.project=t.project
                             AND s.session=t.session
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND s.kind='Lead' AND t.turn=in_turn FOR UPDATE OF t;
       IF NOT FOUND THEN RETURN 'NoTurn'; END IF;
       IF held.state NOT IN ${liveTurnStates} THEN RETURN 'AlreadyEnded'; END IF;
       UPDATE session_turn t
          SET state='Abandoned',failure='TurnWithdrawn',ended_at=now(),
              attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=in_tenant AND t.project=in_project AND t.turn=in_turn;
       RETURN 'Withdrawn';
     END $$`,
];

/** Every selector-side door named beside its argument types, once. */
const selectorSignatures: readonly (readonly [string, string])[] = [
  [agenticRefusalRecordFunction, refusalRecordSignature],
  [agenticRefusalStandingFunction, refusalStandingSignature],
  [leadSessionFunction, leadSessionSignature],
  [leadTurnEnqueueFunction, leadEnqueueSignature],
  [leadTurnReadFunction, leadTurnSignature],
  [leadTurnWithdrawFunction, leadTurnSignature],
];

const ledgerReadSignature = "text,text,bigint,bigint";
const standingReadSignature = "text,text,bigint";
const interactionsReadSignature = "text,text,bigint,bigint";
const planningIntentReadSignature = "text,text";
const leadStandingSignature = "text,text,bigint";
const leadStoreSignature = "text,text,text,bigint,bigint";
const leadStreamsSignature = "text,text,bigint";

/**
 * What the API may read of a lead and of the decisions behind it. Each is
 * bounded by the roster bound its response is bounded by, so a page the wire
 * refuses is a page no body can build.
 */
const apiReads = [
  `CREATE FUNCTION ${agenticRefusalLedgerReadFunction}(
     in_tenant text,in_project text,in_ticket bigint,in_max bigint)
     RETURNS TABLE(ordinal bigint,event text,ticket_version bigint,reason text,
                   selector_decision text,recorded_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT r.ordinal,r.event,r.ticket_version,r.reason,
              r.selector_decision,r.recorded_at
         FROM selector_agentic_refusal r
        WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
        ORDER BY r.ordinal
        LIMIT least(coalesce(in_max,${refusalLedgerCeiling}),
                    ${refusalLedgerCeiling})
     $$`,
  `CREATE FUNCTION ${agenticRefusalStandingReadFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(ticket bigint,ticket_version bigint,reason text,
                   selector_decision text,recorded_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT standing.ticket,standing.ticket_version,standing.reason,
              standing.selector_decision,standing.recorded_at
         FROM ${agenticRefusalStandingFunction}(in_tenant,in_project,in_max) standing
     $$`,
  `CREATE FUNCTION ${selectorInteractionsReadFunction}(
     in_tenant text,in_project text,in_after bigint,in_max bigint)
     RETURNS TABLE(selector_decision text,ordinal bigint,instructions_version text,
                   instructions text,observed_view text,observed_token text,
                   context text,tool_activity text,result text,
                   implementation_revision text,model_revision text,
                   policy_revision text,accounting text,
                   started_at timestamptz,completed_at timestamptz,
                   observed_view_chunks text[],context_chunks text[],
                   tool_activity_chunks text[])
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT i.selector_decision,i.ordinal,i.instructions_version,i.instructions,
              i.observed_view,i.observed_token,i.context,i.tool_activity,i.result,
              i.implementation_revision,i.model_revision,i.policy_revision,
              i.accounting,i.started_at,i.completed_at,
              coalesce(viewed.chunks,'{}'::text[]),
              coalesce(held.chunks,'{}'::text[]),
              coalesce(used.chunks,'{}'::text[])
         FROM selector_interaction i
         LEFT JOIN LATERAL (
           SELECT array_agg(r.content ORDER BY r.ordinal) AS chunks
             FROM selector_interaction_resource r
            WHERE r.selector_decision=i.selector_decision
              AND r.kind='ObservedView') viewed ON true
         LEFT JOIN LATERAL (
           SELECT array_agg(r.content ORDER BY r.ordinal) AS chunks
             FROM selector_interaction_resource r
            WHERE r.selector_decision=i.selector_decision
              AND r.kind='Context') held ON true
         LEFT JOIN LATERAL (
           SELECT array_agg(r.content ORDER BY r.ordinal) AS chunks
             FROM selector_interaction_resource r
            WHERE r.selector_decision=i.selector_decision
              AND r.kind='ToolActivity') used ON true
        WHERE i.tenant=in_tenant AND i.project=in_project
          AND i.ordinal>coalesce(in_after,0)
        ORDER BY i.ordinal
        LIMIT least(coalesce(in_max,${selectorHistoryLimitMax}),
                    ${selectorHistoryLimitMax})
     $$`,
  `CREATE FUNCTION ${selectorPlanningIntentReadFunction}(
     in_tenant text,in_project text)
     RETURNS TABLE(selector_decision text,intent text,updated_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT p.selector_decision,p.intent,p.updated_at
         FROM selector_planning_intent p
        WHERE p.tenant=in_tenant AND p.project=in_project
     $$`,
  `CREATE FUNCTION ${leadStandingReadFunction}(
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
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead'
        ORDER BY tail.ordinal
     $$`,
  `CREATE FUNCTION ${leadStoreReadFunction}(
     in_tenant text,in_project text,in_stream text,in_after bigint,in_max bigint)
     RETURNS TABLE(stream text,batch bigint,digest text,bytes bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.stream,b.batch,b.digest,b.bytes
         FROM session_store_batch b
         JOIN agent_session s ON s.tenant=b.tenant AND s.project=b.project
                             AND s.session=b.session
        WHERE b.tenant=in_tenant AND b.project=in_project AND s.kind='Lead'
          AND b.stream=in_stream AND b.batch>coalesce(in_after,0)
        ORDER BY b.batch
        LIMIT least(coalesce(in_max,${sessionStorePageBatchesMax}),
                    ${sessionStorePageBatchesMax})
     $$`,
  `CREATE FUNCTION ${leadStreamListFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(stream text,batches bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.stream,count(*)::bigint
         FROM session_store_batch b
         JOIN agent_session s ON s.tenant=b.tenant AND s.project=b.project
                             AND s.session=b.session
        WHERE b.tenant=in_tenant AND b.project=in_project AND s.kind='Lead'
        GROUP BY b.stream ORDER BY b.stream
        LIMIT least(coalesce(in_max,${sessionStoreStreamsAnswered}),
                    ${sessionStoreStreamsAnswered})
     $$`,
];

/** Every API-side read named beside its argument types, once. */
const apiSignatures: readonly (readonly [string, string])[] = [
  [agenticRefusalLedgerReadFunction, ledgerReadSignature],
  [agenticRefusalStandingReadFunction, standingReadSignature],
  [selectorInteractionsReadFunction, interactionsReadSignature],
  [selectorPlanningIntentReadFunction, planningIntentReadSignature],
  [leadStandingReadFunction, leadStandingSignature],
  [leadStoreReadFunction, leadStoreSignature],
  [leadStreamListFunction, leadStreamsSignature],
];

const doorGrants = [
  ...selectorSignatures.map(
    ([name, signature]) =>
      `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  ),
  ...selectorSignatures.map(
    ([name, signature]) =>
      `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  ),
  ...selectorSignatures.map(
    ([name, signature]) =>
      `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${selectorServiceRole}`,
  ),
  ...apiSignatures.map(
    ([name, signature]) =>
      `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  ),
  ...apiSignatures.map(
    ([name, signature]) =>
      `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  ),
  ...apiSignatures.map(
    ([name, signature]) =>
      `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${apiRole}`,
  ),
];

/**
 * The installation's decision envelope, raised to what a lead turn is. It is a
 * floor and not a value: an owner who has already raised either keeps what they
 * set, and the revision the raise mints is recorded like every other.
 */
const leadRealisticLimits = [
  `UPDATE selector_runtime_settings
      SET controls=jsonb_set(
            jsonb_set(controls::jsonb,'{limits,tokensPerDecision}',
              to_jsonb(greatest(
                (controls::jsonb->'limits'->>'tokensPerDecision')::bigint,
                ${leadTokensPerDecision}::bigint))),
            '{limits,millisecondsPerDecision}',
            to_jsonb(greatest(
              (controls::jsonb->'limits'->>'millisecondsPerDecision')::bigint,
              ${leadMillisecondsPerDecision}::bigint)))::text,
          revision=revision+1,updated_at=now()
    WHERE singleton=1
      AND ((controls::jsonb->'limits'->>'tokensPerDecision')::bigint
             < ${leadTokensPerDecision}
        OR (controls::jsonb->'limits'->>'millisecondsPerDecision')::bigint
             < ${leadMillisecondsPerDecision})`,
  `INSERT INTO selector_runtime_settings_history
     (revision,mode,dispatch_mode,base_prompt,controls,
      administrator_kind,administrator_subject)
     SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','lead turn migration'
       FROM selector_runtime_settings ON CONFLICT (revision) DO NOTHING`,
];

/** The lead's refusals, its mailbox door, and what a turn spent. */
export const migration059: Migration = {
  version: 59,
  name: "the lead's decisions, its refusals and what a turn spent",
  statements: [
    ...refusalRelation,
    ...boundaryOwnerReads,
    ...replacedRosters,
    ...renamedHandoffNote,
    ...measureColumns,
    ...measuredAnswer,
    ...podNamedFailure,
    ...selectorDoors,
    ...apiReads,
    ...doorGrants,
    ...leadRealisticLimits,
  ],
};
