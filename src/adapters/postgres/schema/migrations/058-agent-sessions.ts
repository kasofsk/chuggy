/**
 * Agent sessions, the attempts that run them, the turns they take and the store
 * their transcripts point at. The session is the truth and the pod is a cache,
 * so everything a reaped pod would take with it is a row here.
 *
 * A SESSION ATTEMPT IS NOT AN EXECUTION ATTEMPT, and `session_attempt` is a
 * sibling of `execution_attempt` rather than a widening of it. Every key and
 * every worker-plane function over `execution_attempt` hangs off `execution`,
 * which is `NOT NULL` on its ticket, its task, its source request and the
 * configuration and requirement it was pinned under, and which carries
 * `execution_names_one_logical_task`. A session has none of those, so folding
 * one in would mean making those pins nullable and weakening the uniqueness the
 * proved capacity ledger rests on. A sibling costs a second set of boundaries
 * and weakens nothing.
 *
 * A STORE BATCH HOLDS NO PATH. Unlike a run's declared artifact path, a store
 * object's path is a total function of the tenant, project, session, stream and
 * batch that name it, so a stored one would be a duplicate of a derivable fact.
 * The bytes live on the artifacts volume and the row points at them.
 *
 * `via_session` IS AN AUDIT COLUMN AND NOT AN IDENTITY AXIS. `Authority` keeps
 * its shape and the idempotency scope stays the tenant, project, authority kind
 * and key digest: two threads of one member offering the same key are that
 * member retrying, and merging them is right. Both acceptance doors take the
 * column, because the dispatch door calls the other one and a dispatch that
 * dropped its session would be an audit hole exactly where a session acts.
 *
 * NO NEW ROLE. The scheduler, the worker plane, the API and the boundary owner
 * already exist and are already deployed with their own credentials, and a
 * fifth would be a fifth secret for a separation these functions already make.
 */

import {
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStoreBytesMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamCharsMax,
  sessionTurnAttemptsMax,
  sessionTurnBacklogMax,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnSeriesMax,
} from "../../../../contract/http.ts";
import {
  allSessionCapabilities,
  allSessionKinds,
  allSessionStates,
  allSessionTurnFailures,
  allSessionTurnInputKinds,
  allSessionTurnStates,
  sessionCapabilitiesMax,
  sessionIdentityCharsMax,
} from "../../../../interpreter/agentSession.ts";
import { allAttemptStates } from "../../../../interpreter/executionScheduler.ts";
import { artifactDigestChars } from "../../../../interpreter/resultManifest.ts";
import { allSessionAttemptEvidences } from "../../../../interpreter/sessionScheduler.ts";
import {
  allNativeActionResolutions,
  safetyResolution,
} from "../../../../interpreter/ticketCommand.ts";
import { acceptanceOrdinaryResolutions } from "./005-durable-prioritized-decision-mailbox.ts";
import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
  dispatchAcceptanceFunction,
  schedulerRole,
  schemaTextSet,
  sessionAttemptBindingFunction,
  sessionAttemptCleanupCompletedFunction,
  sessionAttemptCleanupFunction,
  sessionAttemptEndFunction,
  sessionAttemptFenceFunction,
  sessionAttemptFencedFunction,
  sessionAttemptHeartbeatFunction,
  sessionAttemptLoseFunction,
  sessionAttemptOpenFunction,
  sessionAttemptPlaceFunction,
  sessionAttemptReadFunction,
  sessionAttemptReapIdleFunction,
  sessionAttemptReapLapsedFunction,
  sessionBearerAuthenticateFunction,
  sessionCloseFunction,
  sessionOpenFunction,
  sessionReferenceBindFunction,
  sessionReferenceWrittenOnceFunction,
  sessionStoreBatchRecordFunction,
  sessionStoreImmutableFunction,
  sessionStoreReadFunction,
  sessionStreamListFunction,
  sessionTurnAnswerFunction,
  sessionTurnClaimFunction,
  sessionTurnEnqueueFunction,
  sessionTurnFailFunction,
  sessionTurnReleaseFunction,
  sessionsAwaitingPlacementFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The key every relation here is partitioned and joined by. */
const sessionKey = "tenant,project,session";

/** The epoch a live authority must have been issued under, as every fence reads it. */
const currentEpoch = `(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`;

const liveStates = "('Placing','Running')";

const digestPattern = `^[0-9a-f]{${artifactDigestChars}}$`;

/** The bound to which a session's key columns are matched against one function's arguments. */
const sessionArguments =
  "tenant=in_tenant AND project=in_project AND session=in_session";

/** The bound a worker-plane body writes under, which is whatever its bearer resolved to. */
const boundSession =
  "tenant=bound.tenant AND project=bound.project AND session=bound.session";

const sessionRelations = [
  `CREATE TABLE agent_session (
     tenant text NOT NULL, project text NOT NULL, session text NOT NULL,
     kind text NOT NULL,
     principal text NOT NULL,
     parent_session text,
     agent_reference text,
     capabilities text[] NOT NULL,
     credential_slot text NOT NULL,
     account text NOT NULL, cluster text NOT NULL,
     state text NOT NULL DEFAULT 'Open',
     turn_next bigint NOT NULL DEFAULT 1,
     attempt_next bigint NOT NULL DEFAULT 1,
     opened_at timestamptz NOT NULL DEFAULT now(),
     closed_at timestamptz,
     PRIMARY KEY (${sessionKey}),
     CONSTRAINT agent_session_identity_is_never_reused UNIQUE (session),
     CONSTRAINT agent_session_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT agent_session_draws_its_cluster
       FOREIGN KEY (account, cluster) REFERENCES capacity_account (account, cluster),
     CONSTRAINT agent_session_forks_a_session
       FOREIGN KEY (tenant, project, parent_session)
         REFERENCES agent_session (${sessionKey}),
     CONSTRAINT agent_session_kind_is_known CHECK (
       kind IN (${schemaTextSet([...allSessionKinds])})),
     CONSTRAINT agent_session_state_is_known CHECK (
       state IN (${schemaTextSet([...allSessionStates])})),
     CONSTRAINT agent_session_parent_is_whole CHECK (
       (kind = 'Inquiry') = (parent_session IS NOT NULL)),
     CONSTRAINT agent_session_closing_is_whole CHECK (
       (state = 'Closed') = (closed_at IS NOT NULL)),
     CONSTRAINT agent_session_capabilities_are_known CHECK (
       cardinality(capabilities) BETWEEN 0 AND ${sessionCapabilitiesMax}
       AND capabilities <@ ARRAY[${schemaTextSet([
         ...allSessionCapabilities,
       ])}]::text[]),
     CONSTRAINT agent_session_text_is_bounded CHECK (
       length(session) BETWEEN 1 AND ${sessionIdentityCharsMax}
       AND length(principal) BETWEEN 1 AND ${sessionIdentityCharsMax}
       AND length(credential_slot) BETWEEN 1 AND ${sessionIdentityCharsMax}
       AND coalesce(length(agent_reference), 1) BETWEEN 1 AND ${sessionIdentityCharsMax}),
     CONSTRAINT agent_session_counters_are_positive CHECK (
       turn_next >= 1 AND attempt_next >= 1))`,
  `CREATE UNIQUE INDEX agent_session_one_lead_per_project
     ON agent_session (tenant, project) WHERE kind = 'Lead'`,
  `CREATE UNIQUE INDEX agent_session_one_thread_per_member
     ON agent_session (tenant, project, principal)
     WHERE kind = 'Thread' AND state = 'Open'`,

  `CREATE TABLE session_attempt (
     tenant text NOT NULL, project text NOT NULL, session text NOT NULL,
     attempt text NOT NULL, attempt_number bigint NOT NULL,
     generation bigint NOT NULL DEFAULT 1,
     recovery_epoch text NOT NULL REFERENCES recovery_epoch (epoch),
     state text NOT NULL DEFAULT 'Placing',
     lease_owner text, lease_expires_at timestamptz,
     placement text, evidence text,
     bearer text NOT NULL, bearer_secret_digest text NOT NULL,
     idle_since timestamptz,
     opened_at timestamptz NOT NULL DEFAULT now(),
     ended_at timestamptz, cleanup_completed_at timestamptz,
     PRIMARY KEY (${sessionKey},attempt_number),
     CONSTRAINT session_attempt_identity_is_never_reused UNIQUE (attempt),
     CONSTRAINT session_attempt_identity_is_local UNIQUE (${sessionKey},attempt),
     CONSTRAINT session_attempt_bearer_is_unique UNIQUE (bearer),
     CONSTRAINT session_attempt_secret_is_unique UNIQUE (bearer_secret_digest),
     CONSTRAINT session_attempt_has_its_session
       FOREIGN KEY (${sessionKey}) REFERENCES agent_session (${sessionKey}),
     CONSTRAINT session_attempt_state_is_known CHECK (
       state IN (${schemaTextSet([...allAttemptStates])})),
     CONSTRAINT session_attempt_digest_is_sha256 CHECK (
       bearer_secret_digest ~ '${digestPattern}'),
     CONSTRAINT session_attempt_lease_is_whole CHECK (
       (lease_owner IS NULL) = (lease_expires_at IS NULL)),
     CONSTRAINT session_attempt_ending_is_whole CHECK (
       (state IN ${liveStates}) = (ended_at IS NULL)),
     CONSTRAINT session_attempt_evidence_is_whole CHECK (
       evidence IS NULL OR state NOT IN ${liveStates}),
     CONSTRAINT session_attempt_evidence_is_known CHECK (
       evidence IS NULL OR evidence IN (${schemaTextSet([
         ...allSessionAttemptEvidences,
       ])})),
     CONSTRAINT session_attempt_counters_are_positive CHECK (
       attempt_number >= 1 AND generation >= 1),
     CONSTRAINT session_attempt_text_is_bounded CHECK (
       length(attempt) BETWEEN 1 AND ${sessionIdentityCharsMax}
       AND length(bearer) BETWEEN 1 AND ${sessionIdentityCharsMax}
       AND coalesce(length(lease_owner), 1) BETWEEN 1 AND ${sessionIdentityCharsMax}
       AND coalesce(length(placement), 1) BETWEEN 1 AND ${sessionIdentityCharsMax}))`,
  `CREATE UNIQUE INDEX session_attempt_one_live
     ON session_attempt (${sessionKey}) WHERE state IN ${liveStates}`,
  `CREATE INDEX session_attempt_lease_expiry ON session_attempt (lease_expires_at)
     WHERE state IN ${liveStates}`,
  `CREATE INDEX session_attempt_epoch ON session_attempt (recovery_epoch)
     WHERE state IN ${liveStates}`,
  `CREATE INDEX session_attempt_active_by_account
     ON session_attempt (tenant, project) WHERE state IN ${liveStates}`,

  `CREATE TABLE session_turn (
     tenant text NOT NULL, project text NOT NULL, session text NOT NULL,
     turn text NOT NULL, ordinal bigint NOT NULL,
     input_kind text NOT NULL, input text NOT NULL,
     state text NOT NULL DEFAULT 'Queued',
     attempt text, claim_generation bigint,
     attempts_spent bigint NOT NULL DEFAULT 0,
     result text, failure text,
     batch_first bigint, batch_last bigint,
     enqueued_at timestamptz NOT NULL DEFAULT now(),
     claimed_at timestamptz, ended_at timestamptz,
     PRIMARY KEY (${sessionKey},ordinal),
     CONSTRAINT session_turn_identity_is_never_reused UNIQUE (turn),
     CONSTRAINT session_turn_has_its_session
       FOREIGN KEY (${sessionKey}) REFERENCES agent_session (${sessionKey}),
     CONSTRAINT session_turn_kind_is_known CHECK (
       input_kind IN (${schemaTextSet([...allSessionTurnInputKinds])})),
     CONSTRAINT session_turn_state_is_known CHECK (
       state IN (${schemaTextSet([...allSessionTurnStates])})),
     CONSTRAINT session_turn_failure_is_known CHECK (
       failure IS NULL OR failure IN (${schemaTextSet([
         ...allSessionTurnFailures,
       ])})),
     CONSTRAINT session_turn_claim_is_whole CHECK (
       (state = 'Claimed') = (attempt IS NOT NULL)
       AND (attempt IS NULL) = (claim_generation IS NULL)
       AND (state = 'Claimed') = (claimed_at IS NOT NULL)),
     CONSTRAINT session_turn_ending_is_whole CHECK (
       (state IN ('Answered','Failed','Abandoned')) = (ended_at IS NOT NULL)
       AND (state = 'Answered') = (result IS NOT NULL)
       AND (state IN ('Failed','Abandoned')) = (failure IS NOT NULL)),
     CONSTRAINT session_turn_batches_are_whole CHECK (
       (batch_first IS NULL) = (batch_last IS NULL)
       AND coalesce(batch_first, 1) <= coalesce(batch_last, 1)),
     CONSTRAINT session_turn_counters_are_bounded CHECK (
       ordinal BETWEEN 1 AND ${sessionTurnSeriesMax}
       AND attempts_spent BETWEEN 0 AND ${sessionTurnAttemptsMax}
       AND coalesce(batch_first, 1) BETWEEN 1 AND ${sessionStoreBatchesMax}
       AND coalesce(batch_last, 1) BETWEEN 1 AND ${sessionStoreBatchesMax}),
     CONSTRAINT session_turn_text_is_bounded CHECK (
       length(input) BETWEEN 1 AND ${sessionTurnInputCharsMax}
       AND coalesce(length(result), 0) <= ${sessionTurnResultCharsMax}))`,
  `CREATE UNIQUE INDEX session_turn_one_claimed
     ON session_turn (${sessionKey}) WHERE state = 'Claimed'`,
  `CREATE INDEX session_turn_queued
     ON session_turn (${sessionKey}, ordinal) WHERE state = 'Queued'`,

  `CREATE TABLE session_store_batch (
     tenant text NOT NULL, project text NOT NULL, session text NOT NULL,
     stream text NOT NULL, batch bigint NOT NULL,
     digest text NOT NULL, bytes bigint NOT NULL, events bigint NOT NULL,
     recorded_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (${sessionKey},stream,batch),
     CONSTRAINT session_store_has_its_session
       FOREIGN KEY (${sessionKey}) REFERENCES agent_session (${sessionKey}),
     CONSTRAINT session_store_batch_is_bounded CHECK (
       batch BETWEEN 1 AND ${sessionStoreBatchesMax}
       AND bytes BETWEEN 0 AND ${sessionStoreBatchBytesMax}
       AND events BETWEEN 0 AND ${sessionStoreBatchBytesMax}),
     CONSTRAINT session_store_object_is_bounded CHECK (
       digest ~ '${digestPattern}'
       AND length(stream) BETWEEN 1 AND ${sessionStoreStreamCharsMax}
       AND stream !~ '[[:cntrl:]]' AND stream !~ '[[:space:]]'))`,
];

/**
 * What a session row may never take back, and what a store batch may never
 * take back at all. A runtime session id arrives once, because a second one
 * would mean two transcripts under one row.
 */
const sessionImmutability = [
  `CREATE FUNCTION ${sessionStoreImmutableFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION
         'store batch % of stream % is written once, and a transcript that could be edited is not a memory',
         OLD.batch, OLD.stream USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${sessionStoreImmutableFunction}() FROM PUBLIC`,
  `CREATE TRIGGER session_store_batch_is_written_once
     BEFORE UPDATE OR DELETE ON session_store_batch
     FOR EACH ROW EXECUTE FUNCTION ${sessionStoreImmutableFunction}()`,
  `CREATE FUNCTION ${sessionReferenceWrittenOnceFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF (NEW.tenant,NEW.project,NEW.session,NEW.kind,NEW.principal,NEW.parent_session,
           NEW.capabilities,NEW.credential_slot,NEW.account,NEW.cluster,NEW.opened_at)
          IS DISTINCT FROM
          (OLD.tenant,OLD.project,OLD.session,OLD.kind,OLD.principal,OLD.parent_session,
           OLD.capabilities,OLD.credential_slot,OLD.account,OLD.cluster,OLD.opened_at) THEN
         RAISE EXCEPTION 'session % would change what it was opened as', OLD.session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.agent_reference IS NOT NULL
          AND NEW.agent_reference IS DISTINCT FROM OLD.agent_reference THEN
         RAISE EXCEPTION
           'session % already runs under a runtime session, and a second is a second transcript',
           OLD.session USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.state = 'Closed' AND NEW.state <> 'Closed' THEN
         RAISE EXCEPTION 'session % is closed, and a closed session takes no more turns',
           OLD.session USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.turn_next < OLD.turn_next OR NEW.attempt_next < OLD.attempt_next THEN
         RAISE EXCEPTION 'session % would reuse an ordinal or an attempt number', OLD.session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${sessionReferenceWrittenOnceFunction}() FROM PUBLIC`,
  `CREATE TRIGGER agent_session_is_written_once
     BEFORE UPDATE ON agent_session
     FOR EACH ROW EXECUTE FUNCTION ${sessionReferenceWrittenOnceFunction}()`,
  `CREATE FUNCTION ${sessionAttemptFencedFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state NOT IN ${liveStates} THEN
         IF OLD.cleanup_completed_at IS NULL AND NEW.cleanup_completed_at IS NOT NULL
            AND (to_jsonb(NEW) - 'cleanup_completed_at')
                IS NOT DISTINCT FROM (to_jsonb(OLD) - 'cleanup_completed_at') THEN
           RETURN NEW;
         END IF;
         RAISE EXCEPTION 'session attempt % is already %, and a finished attempt is written once',
           OLD.attempt, OLD.state USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant,NEW.project,NEW.session,NEW.attempt,NEW.attempt_number,
           NEW.recovery_epoch,NEW.bearer,NEW.bearer_secret_digest)
          IS DISTINCT FROM
          (OLD.tenant,OLD.project,OLD.session,OLD.attempt,OLD.attempt_number,
           OLD.recovery_epoch,OLD.bearer,OLD.bearer_secret_digest) THEN
         RAISE EXCEPTION 'session attempt % would change the identity or epoch it was issued under',
           OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.generation < OLD.generation THEN
         RAISE EXCEPTION 'session attempt % would move its generation backwards', OLD.attempt
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.state = 'Running' AND NEW.state = 'Placing' THEN
         RAISE EXCEPTION 'session attempt % would return to placement after running', OLD.attempt
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${sessionAttemptFencedFunction}() FROM PUBLIC`,
  `CREATE TRIGGER session_attempt_is_fenced
     BEFORE UPDATE ON session_attempt
     FOR EACH ROW EXECUTE FUNCTION ${sessionAttemptFencedFunction}()`,
];

const openSignature = "text,text,text,text,text,text,text[],text";
const closeSignature = "text,text,text";
const enqueueSignature = "text,text,text,text,text,text";

/**
 * The three doors provisioning opens a session and feeds it through, granted to
 * the boundary owner because no runtime role may open one.
 */
const sessionProvisioning = [
  `CREATE FUNCTION ${sessionOpenFunction}(
     in_tenant text,in_project text,in_session text,in_kind text,in_principal text,
     in_parent text,in_capabilities text[],in_credential_slot text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record; drawn record;
     BEGIN
       SELECT s.kind,s.principal,s.parent_session,s.capabilities,s.credential_slot,s.state
         INTO held FROM agent_session s WHERE s.${sessionArguments} FOR UPDATE;
       IF FOUND THEN
         RETURN CASE WHEN held.state='Open' AND held.kind=in_kind
                      AND held.principal=in_principal
                      AND held.parent_session IS NOT DISTINCT FROM in_parent
                      AND held.capabilities IS NOT DISTINCT FROM in_capabilities
                      AND held.credential_slot=in_credential_slot
                     THEN 'AlreadyOpen' ELSE 'Conflict' END;
       END IF;
       IF in_kind='Lead' AND EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead') THEN
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
          credential_slot,account,cluster)
       VALUES(in_tenant,in_project,in_session,in_kind,in_principal,in_parent,
              in_capabilities,in_credential_slot,drawn.account,drawn.cluster);
       RETURN 'Opened';
     END $$`,
  `CREATE FUNCTION ${sessionCloseFunction}(
     in_tenant text,in_project text,in_session text) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text;
     BEGIN
       SELECT s.state INTO held FROM agent_session s
        WHERE s.${sessionArguments} FOR UPDATE;
       IF NOT FOUND OR held<>'Open' THEN RETURN false; END IF;
       UPDATE session_turn t
          SET state='Abandoned',failure='SessionClosed',ended_at=now(),
              attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.${sessionArguments} AND t.state IN ('Queued','Claimed');
       UPDATE agent_session s SET state='Closed',closed_at=now()
        WHERE s.${sessionArguments};
       RETURN true;
     END $$`,
  `CREATE FUNCTION ${sessionTurnEnqueueFunction}(
     in_tenant text,in_project text,in_session text,in_turn text,
     in_input_kind text,in_input text)
     RETURNS TABLE(enqueued text,ordinal bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record; standing bigint; queued bigint; minted bigint;
     BEGIN
       SELECT s.state,s.turn_next INTO held FROM agent_session s
        WHERE s.${sessionArguments} FOR UPDATE;
       IF NOT FOUND THEN
         RAISE EXCEPTION 'there is no session % to enqueue a turn for', in_session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.${sessionArguments} AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyEnqueued'::text,standing; RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.${sessionArguments} AND t.state='Queued';
       IF queued>=${sessionTurnBacklogMax} THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET turn_next=s.turn_next+1
        WHERE s.${sessionArguments} RETURNING s.turn_next-1 INTO minted;
       INSERT INTO session_turn (tenant,project,session,turn,ordinal,input_kind,input)
         VALUES(in_tenant,in_project,in_session,in_turn,minted,in_input_kind,in_input);
       RETURN QUERY SELECT 'Enqueued'::text,minted;
     END $$`,
  `ALTER FUNCTION ${sessionOpenFunction}(${openSignature}) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${sessionCloseFunction}(${closeSignature}) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${sessionTurnEnqueueFunction}(${enqueueSignature}) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionOpenFunction}(${openSignature}),
     ${sessionCloseFunction}(${closeSignature}),
     ${sessionTurnEnqueueFunction}(${enqueueSignature}) FROM PUBLIC`,
];

const releaseSignature = "text,text,text,text";
const awaitingSignature = "text,bigint";
const attemptOpenSignature =
  "text,text,text,text,text,text,text,bigint,bigint,bigint,bigint";
const attemptFenceSignature = "text,bigint,text";
const reapSignature = "text,bigint";
const reapIdleSignature = "text,bigint,bigint";
const cleanupSignature = "bigint";
const cleanupCompletedSignature = "text,bigint";

/**
 * What ending an attempt does to the turns it was holding, in one body because
 * four callers end an attempt and a turn returned differently by any of them
 * would be a second mailbox rule.
 */
const sessionTurnRelease = [
  `CREATE FUNCTION ${sessionTurnReleaseFunction}(
     in_tenant text,in_project text,in_session text,in_attempt text) RETURNS void
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       UPDATE session_turn t
          SET attempts_spent=t.attempts_spent+1,
              attempt=NULL,claim_generation=NULL,claimed_at=NULL,
              state=CASE WHEN t.attempts_spent+1>=${sessionTurnAttemptsMax}
                         THEN 'Failed' ELSE 'Queued' END,
              failure=CASE WHEN t.attempts_spent+1>=${sessionTurnAttemptsMax}
                           THEN 'AttemptLost' ELSE NULL END,
              ended_at=CASE WHEN t.attempts_spent+1>=${sessionTurnAttemptsMax}
                            THEN now() ELSE NULL END
        WHERE t.${sessionArguments} AND t.attempt=in_attempt AND t.state='Claimed';
     END $$`,
  `ALTER FUNCTION ${sessionTurnReleaseFunction}(${releaseSignature}) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionTurnReleaseFunction}(${releaseSignature}) FROM PUBLIC`,
];

/**
 * The nine boundaries the session scheduler drives one pass through. A session
 * inside its placement backoff is still offered by the read and refused by
 * `open_session_attempt`, which is the only one of them the window is an
 * argument to.
 */
const sessionPlacement = [
  `CREATE FUNCTION ${sessionsAwaitingPlacementFunction}(
     in_epoch text,in_max bigint)
     RETURNS TABLE(tenant text,project text,session text,kind text,principal text,
                   parent_session text,agent_reference text,capabilities text[],
                   credential_slot text,account text,cluster text,state text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.tenant,s.project,s.session,s.kind,s.principal,s.parent_session,
              s.agent_reference,s.capabilities,s.credential_slot,s.account,s.cluster,s.state
         FROM agent_session s
        WHERE s.state='Open'
          AND in_epoch=${currentEpoch}
          AND EXISTS(SELECT 1 FROM session_turn t
                      WHERE t.tenant=s.tenant AND t.project=s.project
                        AND t.session=s.session AND t.state='Queued')
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                      WHERE a.tenant=s.tenant AND a.project=s.project
                        AND a.session=s.session AND a.state IN ${liveStates})
        ORDER BY s.tenant,s.project,s.session
        LIMIT in_max
     $$`,
  `CREATE FUNCTION ${sessionAttemptOpenFunction}(
     in_tenant text,in_project text,in_session text,in_epoch text,in_attempt text,
     in_bearer text,in_secret_digest text,in_lease_secs bigint,in_backoff_secs bigint,
     in_account_max bigint,in_cluster_max bigint)
     RETURNS TABLE(opened text,attempt text,generation bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record; numbered bigint;
     BEGIN
       IF in_epoch<>${currentEpoch} THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       SELECT s.state,s.account,s.cluster INTO held FROM agent_session s
        WHERE s.${sessionArguments} FOR UPDATE;
       IF NOT FOUND OR held.state<>'Open'
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.${sessionArguments} AND a.state IN ${liveStates})
          OR NOT EXISTS(SELECT 1 FROM session_turn t
                     WHERE t.${sessionArguments} AND t.state='Queued') THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.${sessionArguments}
                    AND a.ended_at > now() - make_interval(
                          secs => in_backoff_secs::double precision)) THEN
         RETURN QUERY SELECT 'BackingOff'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.account=held.account AND a.state IN ${liveStates})>=in_account_max THEN
         RETURN QUERY SELECT 'AccountAtMaximum'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.cluster=held.cluster AND a.state IN ${liveStates})>=in_cluster_max THEN
         RETURN QUERY SELECT 'ClusterFull'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.${sessionArguments} RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,in_epoch,'Placing',
              in_attempt,now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest);
       RETURN QUERY SELECT 'Opened'::text,in_attempt,1::bigint;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptPlaceFunction}(
     in_attempt text,in_generation bigint,in_placement text) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       UPDATE session_attempt a
          SET state='Running',placement=in_placement,idle_since=now()
        WHERE a.attempt=in_attempt AND a.generation=in_generation
          AND a.state='Placing' AND a.recovery_epoch=${currentEpoch};
       RETURN FOUND;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptEndFunction}(
     in_attempt text,in_generation bigint,in_evidence text) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.session INTO bound FROM session_attempt a
        WHERE a.attempt=in_attempt FOR UPDATE;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Lost',evidence=in_evidence,ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=in_attempt AND a.generation=in_generation
          AND a.state IN ${liveStates} AND a.recovery_epoch=${currentEpoch};
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM ${sessionTurnReleaseFunction}(
         bound.tenant,bound.project,bound.session,in_attempt);
       RETURN true;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptReapLapsedFunction}(in_epoch text,in_max bigint)
     RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE lapsed record; reaped bigint;
     BEGIN
       IF in_epoch<>${currentEpoch} THEN RETURN 0; END IF;
       reaped:=0;
       FOR lapsed IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ${liveStates} AND a.recovery_epoch=in_epoch
              AND a.lease_expires_at < now()
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence='LeaseExpired',ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=lapsed.attempt;
         PERFORM ${sessionTurnReleaseFunction}(
           lapsed.tenant,lapsed.project,lapsed.session,lapsed.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptReapIdleFunction}(
     in_epoch text,in_idle_secs bigint,in_max bigint)
     RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE idled record; reaped bigint;
     BEGIN
       IF in_epoch<>${currentEpoch} THEN RETURN 0; END IF;
       reaped:=0;
       FOR idled IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ${liveStates} AND a.recovery_epoch=in_epoch
              AND a.idle_since IS NOT NULL
              AND a.idle_since < now() - make_interval(
                    secs => in_idle_secs::double precision)
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence='SessionIdle',ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=idled.attempt;
         PERFORM ${sessionTurnReleaseFunction}(
           idled.tenant,idled.project,idled.session,idled.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptFenceFunction}(in_epoch text,in_max bigint)
     RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE stale record; fenced bigint;
     BEGIN
       IF in_epoch<>${currentEpoch} THEN RETURN 0; END IF;
       fenced:=0;
       FOR stale IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ${liveStates} AND a.recovery_epoch<>in_epoch
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Superseded',generation=a.generation+1,evidence='Fenced',
                ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=stale.attempt;
         PERFORM ${sessionTurnReleaseFunction}(
           stale.tenant,stale.project,stale.session,stale.attempt);
         fenced:=fenced+1;
       END LOOP;
       RETURN fenced;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptCleanupFunction}(in_max bigint)
     RETURNS TABLE(tenant text,project text,session text,attempt text,generation bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation FROM session_attempt a
        WHERE a.state NOT IN ${liveStates} AND a.placement IS NOT NULL
          AND a.cleanup_completed_at IS NULL
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$`,
  `CREATE FUNCTION ${sessionAttemptCleanupCompletedFunction}(
     in_attempt text,in_generation bigint) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       UPDATE session_attempt a SET cleanup_completed_at=now()
        WHERE a.attempt=in_attempt AND a.generation=in_generation
          AND a.state NOT IN ${liveStates} AND a.cleanup_completed_at IS NULL;
       RETURN FOUND;
     END $$`,
];

/** Every scheduler-side boundary named beside its argument types, once. */
const schedulerSignatures: readonly (readonly [string, string])[] = [
  [sessionsAwaitingPlacementFunction, awaitingSignature],
  [sessionAttemptOpenFunction, attemptOpenSignature],
  [sessionAttemptPlaceFunction, attemptFenceSignature],
  [sessionAttemptEndFunction, attemptFenceSignature],
  [sessionAttemptReapLapsedFunction, reapSignature],
  [sessionAttemptReapIdleFunction, reapIdleSignature],
  [sessionAttemptFenceFunction, reapSignature],
  [sessionAttemptCleanupFunction, cleanupSignature],
  [sessionAttemptCleanupCompletedFunction, cleanupCompletedSignature],
];

const bindingSignature = "text,bigint";
const readAttemptSignature = "text";
const heartbeatSignature = "text,bigint,bigint";
const loseSignature = "text,bigint,text";
const bindReferenceSignature = "text,bigint,text";
const claimSignature = "text,bigint";
const answerSignature = "text,bigint,text,text,bigint,bigint";
const failSignature = "text,bigint,text,text";
const storeBatchSignature = "text,bigint,text,bigint,text,bigint,bigint";
const storeReadSignature = "text,bigint,text,bigint,bigint";
const streamListSignature = "text,bigint";

/** The eleven boundaries a session pod reaches through the worker plane. */
const sessionPlane = [
  `CREATE FUNCTION ${sessionAttemptBindingFunction}(
     in_secret_digest text,in_generation bigint)
     RETURNS TABLE(tenant text,project text,session text,attempt text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,
              a.state AS attempt_state,a.recovery_epoch,s.state AS session_state
         INTO bound FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest FOR UPDATE OF a;
       IF NOT FOUND OR bound.attempt_state NOT IN ${liveStates}
          OR bound.session_state<>'Open' OR bound.generation<>in_generation
          OR bound.recovery_epoch<>${currentEpoch} THEN
         RETURN;
       END IF;
       RETURN QUERY SELECT bound.tenant,bound.project,bound.session,bound.attempt;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptReadFunction}(in_secret_digest text)
     RETURNS TABLE(tenant text,project text,session text,attempt text,generation bigint,
                   kind text,principal text,capabilities text[],credential_slot text,
                   agent_reference text,live boolean)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              s.capabilities,s.credential_slot,s.agent_reference,
              (a.state IN ${liveStates} AND s.state='Open'
               AND a.recovery_epoch=${currentEpoch})
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`,
  `CREATE FUNCTION ${sessionAttemptHeartbeatFunction}(
     in_secret_digest text,in_generation bigint,in_lease_secs bigint) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM ${sessionAttemptBindingFunction}(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET lease_expires_at=now()+make_interval(
                secs => in_lease_secs::double precision)
        WHERE a.attempt=bound.attempt AND a.state IN ${liveStates};
       RETURN FOUND;
     END $$`,
  `CREATE FUNCTION ${sessionAttemptLoseFunction}(
     in_secret_digest text,in_generation bigint,in_evidence text) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text; ended boolean;
     BEGIN
       SELECT a.attempt INTO held FROM session_attempt a
        WHERE a.bearer_secret_digest=in_secret_digest;
       IF NOT FOUND THEN RETURN false; END IF;
       SELECT ${sessionAttemptEndFunction}(held,in_generation,in_evidence) INTO ended;
       RETURN ended;
     END $$`,
  `CREATE FUNCTION ${sessionReferenceBindFunction}(
     in_secret_digest text,in_generation bigint,in_reference text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; held text;
     BEGIN
       SELECT * INTO bound FROM ${sessionAttemptBindingFunction}(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_reference IS NULL
          OR length(in_reference) NOT BETWEEN 1 AND ${sessionIdentityCharsMax} THEN
         RETURN 'Conflict';
       END IF;
       SELECT s.agent_reference INTO held FROM agent_session s
        WHERE s.${boundSession} FOR UPDATE;
       IF held IS NULL THEN
         UPDATE agent_session s SET agent_reference=in_reference WHERE s.${boundSession};
         RETURN 'Bound';
       END IF;
       RETURN CASE WHEN held=in_reference THEN 'AlreadyBound' ELSE 'Conflict' END;
     END $$`,
  `CREATE FUNCTION ${sessionTurnClaimFunction}(
     in_secret_digest text,in_generation bigint)
     RETURNS TABLE(turn text,ordinal bigint,input_kind text,input text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; standing record; picked record;
     BEGIN
       SELECT * INTO bound FROM ${sessionAttemptBindingFunction}(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN; END IF;
       SELECT t.turn,t.ordinal,t.input_kind,t.input,t.attempt INTO standing
         FROM session_turn t WHERE t.${boundSession} AND t.state='Claimed' FOR UPDATE;
       IF FOUND THEN
         IF standing.attempt=bound.attempt THEN
           RETURN QUERY SELECT standing.turn,standing.ordinal,
                               standing.input_kind,standing.input;
         END IF;
         RETURN;
       END IF;
       SELECT t.turn,t.ordinal,t.input_kind,t.input INTO picked FROM session_turn t
        WHERE t.${boundSession} AND t.state='Queued'
        ORDER BY t.ordinal LIMIT 1 FOR UPDATE;
       IF NOT FOUND THEN RETURN; END IF;
       UPDATE session_turn t
          SET state='Claimed',attempt=bound.attempt,claim_generation=in_generation,
              claimed_at=now()
        WHERE t.${boundSession} AND t.turn=picked.turn;
       UPDATE session_attempt a SET idle_since=NULL WHERE a.attempt=bound.attempt;
       RETURN QUERY SELECT picked.turn,picked.ordinal,picked.input_kind,picked.input;
     END $$`,
  `CREATE FUNCTION ${sessionTurnAnswerFunction}(
     in_secret_digest text,in_generation bigint,in_turn text,in_result text,
     in_batch_first bigint,in_batch_last bigint) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM ${sessionAttemptBindingFunction}(
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
        WHERE t.${boundSession} AND t.turn=in_turn FOR UPDATE;
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
              claimed_at=NULL,ended_at=now()
        WHERE t.${boundSession} AND t.turn=in_turn;
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Answered';
     END $$`,
  `CREATE FUNCTION ${sessionTurnFailFunction}(
     in_secret_digest text,in_generation bigint,in_turn text,in_failure text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM ${sessionAttemptBindingFunction}(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_failure IS NULL
          OR in_failure NOT IN (${schemaTextSet([...allSessionTurnFailures])}) THEN
         RETURN 'Conflict';
       END IF;
       SELECT t.state,t.attempt,t.claim_generation,t.failure INTO stored
         FROM session_turn t WHERE t.${boundSession} AND t.turn=in_turn FOR UPDATE;
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
        WHERE t.${boundSession} AND t.turn=in_turn;
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Failed';
     END $$`,
  `CREATE FUNCTION ${sessionStoreBatchRecordFunction}(
     in_secret_digest text,in_generation bigint,in_stream text,in_batch bigint,
     in_digest text,in_bytes bigint,in_events bigint) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; existing record; highest bigint; held bigint;
     BEGIN
       SELECT * INTO bound FROM ${sessionAttemptBindingFunction}(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_digest !~ '${digestPattern}'
          OR length(in_stream) NOT BETWEEN 1 AND ${sessionStoreStreamCharsMax}
          OR in_stream ~ '[[:cntrl:]]' OR in_stream ~ '[[:space:]]' THEN
         RETURN 'Conflict';
       END IF;
       IF in_batch NOT BETWEEN 1 AND ${sessionStoreBatchesMax}
          OR in_bytes NOT BETWEEN 0 AND ${sessionStoreBatchBytesMax}
          OR in_events NOT BETWEEN 0 AND ${sessionStoreBatchBytesMax} THEN
         RETURN 'QuotaExceeded';
       END IF;
       SELECT b.digest,b.bytes INTO existing FROM session_store_batch b
        WHERE b.${boundSession} AND b.stream=in_stream AND b.batch=in_batch;
       IF FOUND THEN
         RETURN CASE WHEN existing.digest=in_digest AND existing.bytes=in_bytes
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       SELECT coalesce(max(b.batch),0) INTO highest FROM session_store_batch b
        WHERE b.${boundSession} AND b.stream=in_stream;
       IF in_batch<>highest+1 THEN RETURN 'OutOfOrder'; END IF;
       SELECT coalesce(sum(b.bytes),0) INTO held FROM session_store_batch b
        WHERE b.${boundSession};
       IF held+in_bytes>${sessionStoreBytesMax} THEN RETURN 'QuotaExceeded'; END IF;
       INSERT INTO session_store_batch
         (tenant,project,session,stream,batch,digest,bytes,events)
       VALUES(bound.tenant,bound.project,bound.session,in_stream,in_batch,
              in_digest,in_bytes,in_events);
       RETURN 'Stored';
     END $$`,
  `CREATE FUNCTION ${sessionStoreReadFunction}(
     in_secret_digest text,in_generation bigint,in_stream text,
     in_after bigint,in_limit bigint)
     RETURNS TABLE(batch bigint,digest text,bytes bigint)
     LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.batch,b.digest,b.bytes
         FROM ${sessionAttemptBindingFunction}(in_secret_digest,in_generation) k
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=k.session
        WHERE b.stream=in_stream AND b.batch>coalesce(in_after,0)
        ORDER BY b.batch
        LIMIT least(coalesce(in_limit,${sessionStorePageBatchesMax}),
                    ${sessionStorePageBatchesMax})
     $$`,
  `CREATE FUNCTION ${sessionStreamListFunction}(
     in_secret_digest text,in_generation bigint)
     RETURNS TABLE(stream text,batches bigint)
     LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.stream,count(*)::bigint
         FROM ${sessionAttemptBindingFunction}(in_secret_digest,in_generation) k
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=k.session
        GROUP BY b.stream ORDER BY b.stream
     $$`,
];

/** Every worker-plane boundary named beside its argument types, once. */
const planeSignatures: readonly (readonly [string, string])[] = [
  [sessionAttemptBindingFunction, bindingSignature],
  [sessionAttemptReadFunction, readAttemptSignature],
  [sessionAttemptHeartbeatFunction, heartbeatSignature],
  [sessionAttemptLoseFunction, loseSignature],
  [sessionReferenceBindFunction, bindReferenceSignature],
  [sessionTurnClaimFunction, claimSignature],
  [sessionTurnAnswerFunction, answerSignature],
  [sessionTurnFailFunction, failSignature],
  [sessionStoreBatchRecordFunction, storeBatchSignature],
  [sessionStoreReadFunction, storeReadSignature],
  [sessionStreamListFunction, streamListSignature],
];

/** What the API learns from a session bearer, which is a principal and nothing more. */
const sessionApi = [
  `CREATE FUNCTION ${sessionBearerAuthenticateFunction}(in_secret_digest text)
     RETURNS TABLE(tenant text,project text,session text,kind text,principal text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.session,s.kind,s.principal
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.state IN ${liveStates} AND s.state='Open'
          AND a.recovery_epoch=${currentEpoch}
     $$`,
  `ALTER FUNCTION ${sessionBearerAuthenticateFunction}(text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionBearerAuthenticateFunction}(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionBearerAuthenticateFunction}(text) TO ${apiRole}`,
];

const acceptanceSignature =
  "text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint";
const acceptanceSessionSignature = `${acceptanceSignature},text`;

/**
 * The mailbox door and the dispatch door that calls it, retyped rather than
 * replaced because a signature change is a drop and the ledger is append-only.
 * Each differs from the body it stands in for by the session an operation came
 * through and by nothing else.
 */
const sessionAcceptance = [
  `DROP FUNCTION ${acceptanceFunction}(${acceptanceSignature})`,
  `DROP FUNCTION ${dispatchAcceptanceFunction}(${acceptanceSignature})`,
  `CREATE FUNCTION ${acceptanceFunction}(
      in_tenant text, in_project text, in_operation text,
      in_authority_kind text, in_authority_subject text,
      in_key_version text, in_key_digest text, in_payload_digest text,
      in_retained_key_digests text[], in_retained_payload_digests text[],
      in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint,
      in_via_session text)
     RETURNS TABLE(result text, operation text, ordinal bigint, state text,
       authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE project_lifecycle text; project_generation bigint; next_ordinal bigint;
       pending_total bigint; pending_ordinary bigint; existing record;
       command_value jsonb; command_tag text; priority text; admission_class text;
       action_id text; authorizing_sequence bigint; action_resolution text;
     BEGIN
       IF cardinality(in_retained_key_digests) <> cardinality(in_retained_payload_digests) THEN
         RAISE EXCEPTION 'idempotency digest arrays disagree';
       END IF;

       BEGIN
         command_value := in_command::jsonb;
       EXCEPTION WHEN others THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_value->>'command' = 'Decide'
          AND jsonb_typeof(command_value->'event') = 'object' THEN
         command_tag := command_value->'event'->>'type';
       ELSIF command_value->>'command' = 'ReleaseDraft' THEN
         command_tag := 'ReleaseDraft';
       ELSIF command_value->>'command' = 'ResolveNativeAction'
          AND jsonb_typeof(command_value->'action') = 'string'
          AND length(command_value->>'action') BETWEEN 1 AND 256
          AND jsonb_typeof(command_value->'authorizingSeq') = 'number'
          AND (command_value->>'authorizingSeq') ~ '^[1-9][0-9]*$'
          AND command_value->>'resolution' IN (${schemaTextSet(allNativeActionResolutions)}) THEN
         command_tag := 'ResolveNativeAction';
         action_id := command_value->>'action';
         BEGIN
           authorizing_sequence := (command_value->>'authorizingSeq')::bigint;
         EXCEPTION WHEN numeric_value_out_of_range THEN
           RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
           RETURN;
         END;
         action_resolution := command_value->>'resolution';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       IF command_tag = 'Revoke' OR
          (command_tag = 'ResolveNativeAction' AND action_resolution = '${safetyResolution}') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', 'Dispatch', 'ResumeTicket') OR
             (command_tag = 'ResolveNativeAction' AND action_resolution IN (${schemaTextSet(acceptanceOrdinaryResolutions)})) THEN
         priority := 'Ordinary'; admission_class := 'Ordinary';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT p.lifecycle, p.lifecycle_generation INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;

       SELECT o.operation, d.ordinal, d.state, o.authority_kind, o.admission,
              d.lifecycle_generation, offered.payload_digest AS offered_payload, o.payload_digest
         INTO existing
         FROM unnest(in_retained_key_digests, in_retained_payload_digests)
              AS offered(key_digest, payload_digest)
         JOIN operation o ON o.tenant=in_tenant AND o.project=in_project
              AND o.authority_kind=in_authority_kind AND o.key_digest=offered.key_digest
         JOIN decision_input d ON d.tenant=o.tenant AND d.project=o.project
              AND d.input_kind='Operation' AND d.input_id=o.operation
         ORDER BY (o.payload_digest = offered.payload_digest) DESC
         LIMIT 1;
       IF FOUND THEN
         IF existing.payload_digest IS DISTINCT FROM existing.offered_payload THEN
           RETURN QUERY SELECT 'IdempotencyConflict'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         ELSE
           RETURN QUERY SELECT 'Original'::text, existing.operation::text,
             existing.ordinal::bigint, existing.state::text, existing.authority_kind::text,
             existing.admission::text, existing.lifecycle_generation::bigint, NULL::text;
         END IF;
         RETURN;
       END IF;

       IF command_tag='ResolveNativeAction' AND NOT EXISTS (
         SELECT 1 FROM native_action a JOIN native_action_resolution r
           USING (tenant, project, action)
          WHERE a.tenant=in_tenant AND a.project=in_project AND a.action=action_id
            AND a.state='Open' AND a.authorizing_seq=authorizing_sequence
            AND r.resolution=action_resolution FOR UPDATE OF a)
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_tag='ReleaseDraft' AND NOT EXISTS (
         SELECT 1 FROM draft_revision r
          WHERE r.tenant=in_tenant AND r.project=in_project
            AND r.ticket=(command_value->>'ticket')::bigint
            AND r.authoring_version=(command_value->>'authoringVersion')::bigint
            AND r.configuration_revision=command_value->>'configurationRevision')
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT count(*), count(*) FILTER (WHERE d.base_priority='Ordinary')
         INTO pending_total, pending_ordinary FROM decision_input d
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Pending';
       IF pending_total >= in_hard_limit THEN
         RETURN QUERY SELECT 'Unavailable'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF priority='Ordinary' AND pending_ordinary >= in_ordinary_soft_limit THEN
         RETURN QUERY SELECT 'Backpressure'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF NOT (project_lifecycle = 'Active' OR
          (admission_class = 'CorrectnessReducing' AND
           project_lifecycle IN ('Suspended', 'IntegrityBlocked', 'Deleting'))) THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, project_lifecycle;
         RETURN;
       END IF;

       UPDATE project p SET ingress_next=p.ingress_next+1
        WHERE p.tenant=in_tenant AND p.project=in_project
        RETURNING p.ingress_next-1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag, via_session)
       VALUES (in_tenant, in_project, in_operation, in_authority_kind, in_authority_subject,
          admission_class, in_key_version, in_key_digest, in_payload_digest, in_command, command_tag,
          in_via_session);
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation, priority, project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready=true, generation=project_readiness.generation+1;
       RETURN QUERY SELECT 'Accepted'::text, in_operation, next_ordinal, 'Pending'::text,
         in_authority_kind, admission_class, project_generation, NULL::text;
     END $$`,
  `CREATE FUNCTION ${dispatchAcceptanceFunction}(
      in_tenant text,in_project text,in_operation text,in_authority_kind text,
      in_authority_subject text,in_key_version text,in_key_digest text,in_payload_digest text,
      in_retained_key_digests text[],in_retained_payload_digests text[],in_command text,
      in_ordinary_soft_limit bigint,in_hard_limit bigint,in_via_session text)
     RETURNS TABLE(result text,operation text,ordinal bigint,state text,authority_kind text,
       admission text,lifecycle_generation bigint,lifecycle text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE command_value jsonb; ticket_value bigint; accepted record;
     BEGIN
       BEGIN command_value:=in_command::jsonb;
       EXCEPTION WHEN others THEN RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
         NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'version'<>'1'
          OR command_value->>'command' NOT IN ('ManualDispatch','ProposeDispatch')
          OR NOT command_integer(command_value->'ticket')
          OR (command_value->>'ticket') !~ '^[1-9][0-9]*$'
          OR NOT command_integer(command_value->'expectedTicketVersion')
          OR (command_value->>'expectedTicketVersion') !~ '^[1-9][0-9]*$' THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       BEGIN ticket_value:=(command_value->>'ticket')::bigint;
       EXCEPTION WHEN numeric_value_out_of_range THEN RETURN QUERY SELECT 'InvalidCommand'::text,
         NULL::text,NULL::bigint,NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'command'='ProposeDispatch' AND (
          jsonb_typeof(command_value->'observedViewToken')<>'object'
          OR command_value->'observedViewToken'->>'tenant'<>in_tenant
          OR command_value->'observedViewToken'->>'project'<>in_project
          OR jsonb_typeof(command_value->'observedViewToken'->'recoveryEpoch')<>'string'
          OR length(command_value->'observedViewToken'->>'recoveryEpoch') NOT BETWEEN 1 AND 256
          OR command_value->'observedViewToken'->>'schemaVersion'<>'1'
          OR NOT command_integer(command_value->'observedViewToken'->'watermark')
          OR (command_value->'observedViewToken'->>'watermark') !~ '^(0|[1-9][0-9]*)$'
          OR (command_value->'observedViewToken'->>'digest') !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(command_value->'selectorDecisionReference')<>'string'
          OR length(command_value->>'selectorDecisionReference') NOT BETWEEN 1 AND 256) THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       SELECT * INTO accepted FROM ${acceptanceFunction}(
         in_tenant,in_project,in_operation,in_authority_kind,in_authority_subject,
         in_key_version,in_key_digest,in_payload_digest,in_retained_key_digests,
         in_retained_payload_digests,jsonb_build_object('version',1,'command','Decide',
           'event',jsonb_build_object('type','ResumeTicket','value',ticket_value))::text,
         in_ordinary_soft_limit,in_hard_limit,in_via_session);
       IF accepted.result='Accepted' THEN UPDATE operation AS stored
         SET command=in_command,command_tag=command_value->>'command'
         WHERE stored.tenant=in_tenant AND stored.project=in_project
           AND stored.operation=in_operation; END IF;
       RETURN QUERY SELECT accepted.result::text,accepted.operation::text,accepted.ordinal::bigint,
         accepted.state::text,accepted.authority_kind::text,accepted.admission::text,
         accepted.lifecycle_generation::bigint,accepted.lifecycle::text;
     END $$`,
  `ALTER FUNCTION ${acceptanceFunction}(${acceptanceSessionSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${dispatchAcceptanceFunction}(${acceptanceSessionSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${acceptanceFunction}(${acceptanceSessionSignature}),
     ${dispatchAcceptanceFunction}(${acceptanceSessionSignature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${acceptanceFunction}(${acceptanceSessionSignature}),
     ${dispatchAcceptanceFunction}(${acceptanceSessionSignature}) TO ${apiRole}`,
];

/** The operation row's audit column, and the grant that lets the API read it. */
const sessionOperations = [
  `ALTER TABLE operation ADD COLUMN via_session text`,
  `ALTER TABLE operation ADD CONSTRAINT operation_via_session_is_a_session
     FOREIGN KEY (tenant, project, via_session)
       REFERENCES agent_session (${sessionKey})`,
  `GRANT SELECT (via_session) ON operation TO ${apiRole}`,
];

/**
 * What the boundary owner's bodies read and write. The negative space is the
 * point: no runtime role holds any privilege on these four relations, because
 * every move against one is a function above.
 */
const sessionGrants = [
  `GRANT SELECT,INSERT ON agent_session,session_attempt,session_turn,session_store_batch
     TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (agent_reference,state,closed_at,turn_next,attempt_next)
     ON agent_session TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state,generation,lease_owner,lease_expires_at,placement,evidence,
                 idle_since,ended_at,cleanup_completed_at)
     ON session_attempt TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state,attempt,claim_generation,attempts_spent,result,failure,
                 batch_first,batch_last,claimed_at,ended_at)
     ON session_turn TO ${boundaryOwnerRole}`,
  ...schedulerSignatures.map(
    ([name, signature]) =>
      `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  ),
  ...schedulerSignatures.map(
    ([name, signature]) =>
      `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  ),
  ...schedulerSignatures.map(
    ([name, signature]) =>
      `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${schedulerRole}`,
  ),
  ...planeSignatures.map(
    ([name, signature]) =>
      `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  ),
  ...planeSignatures.map(
    ([name, signature]) =>
      `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  ),
  ...planeSignatures.map(
    ([name, signature]) =>
      `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${workerPlaneRole}`,
  ),
];

/** A session, its attempts, its turns and its store are rows. */
export const migration058: Migration = {
  version: 58,
  name: "agent sessions, their turns and their store",
  statements: [
    ...sessionRelations,
    ...sessionImmutability,
    ...sessionProvisioning,
    ...sessionTurnRelease,
    ...sessionPlacement,
    ...sessionPlane,
    ...sessionApi,
    ...sessionOperations,
    ...sessionAcceptance,
    ...sessionGrants,
  ],
};
