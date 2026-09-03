/**
 * A member's own thread: the row it is opened as, the door a message goes
 * through, the door a wake goes through, the reads a page is drawn from, and
 * the bounded join that decides whose thread a change wakes.
 *
 * THE TWO DOORS ARE TWO FUNCTIONS BECAUSE THEY ARE TWO ROLES. `enqueue_thread_message`
 * is the API's and writes `UserMessage`; `wake_member_thread` is the selector
 * service's and writes `Wake`. An input kind passed as an argument would make
 * one grant do both jobs, and the whole point of the narrowing is that the API
 * cannot wake a thread and the selector cannot speak as a member.
 *
 * NEITHER DOOR RESOLVES A SESSION FROM AN ARGUMENT. Each finds the caller's own
 * thread from the principal, so a member cannot write into another's mailbox
 * even where the route that called it was wrong. The member's door does take
 * `in_session` — the session the URL named — and REFUSES A MISMATCH itself, so
 * the comparison is a control at this tier rather than a check the caller was
 * trusted to make. That is also what stops a stale listing enqueuing into the
 * wrong conversation: a thread closed and reopened between a read and a write
 * answers `NotYourThread` instead of taking a first turn with no seeding block
 * in front of it. The selector's door names no session because a wake is about
 * a member and not about a page anyone is reading.
 *
 * THE OPEN DOOR'S INDEX IS THE CONTROL AND ITS PRE-CHECK IS NOT.
 * `agent_session_one_thread_per_member` — the partial unique index 058 declared
 * over `(tenant, project, principal) WHERE kind='Thread' AND state='Open'` —
 * decides which of two concurrent opens wins, and the exception arm is what
 * turns the loser's refusal into the session that won;
 * the pre-check ahead of both answers exactly what that arm answers, so it is a
 * fast path and a reader must not take it for a second control. A CLOSED THREAD
 * DOES NOT BLOCK A NEW ONE, because the index is partial on `state='Open'`.
 *
 * THE MAILBOX ARMS ARE ORDERED AND THE ORDER IS THE ANSWER. A retried turn is
 * `AlreadyEnqueued` even where the mailbox is full, because a member who
 * resends is asking after the turn they already sent; a closed thread is
 * `Closed` even where its owner's membership is also gone, because a closed
 * session is the fact its owner can act on. A LISTING LEFT JOINS THE
 * MEMBERSHIP, so a thread whose owner's membership was revoked answers with no
 * owner rather than being hidden — a session that can still act is one an owner
 * must be able to see and close.
 *
 * A RETRIED TURN DOES NOT REWRITE ITS INPUT. `AlreadyEnqueued` answers the
 * ordinal the turn already has and leaves the row alone: a turn a pod may have
 * claimed or answered is history, and a door that edited it would make a
 * transcript disagree with the mailbox it came from.
 *
 * `open_member_thread` TAKES NO CAPABILITY ROSTER: the API may open a session
 * for the very principal that asked, which grants nothing the caller lacks, and
 * may not choose what that session may do. The roster is this migration's own
 * array literal, generated from `threadCapabilitiesDefault`.
 *
 * A GENERATED CHECK IS REPLACED WHERE IT WAS LAST WRITTEN. 058 wrote
 * `agent_session_capabilities_are_known` from `allSessionCapabilities` and 061
 * replaced it; the roster has since gained the member that admits origination,
 * so a fresh installation already holds the wide check and a migrated one holds
 * 061's for ever unless this replaces it. The device is 059's and 061's and the
 * reason has not changed. The prompt bound is NOT replaced: a thread's
 * objectives are derived from the same North Star ceiling a lead's are and are
 * shorter than one, so `sessionPromptCeilings` does not move — and the suite
 * writes a thread prompt at its own ceiling to hold that.
 *
 * THE ROSTER BECOMES A COLUMN A LATER WRITE MAY MOVE. `agent_session_is_written_once`
 * froze `capabilities` with the identity columns; reconfiguring one thread is
 * the provisioning root's in this slice, so the roster leaves the frozen tuple
 * and `set_session_capabilities` is the one door that moves it. Everything that
 * decides who the session acts as — its kind, its principal, its parent, its
 * credential slot, the account and the cluster it draws — stays frozen, because
 * those are what the session IS and a session that could become another is not
 * an authority at all.
 *
 * THE STORE READS BECOME SESSION-KEYED. 059's `read_lead_store` and
 * `list_lead_store_streams` differ from what a thread's transcript needs in one
 * predicate, so they are dropped rather than copied: three near-identical
 * definers is the duplication that makes a fix land in two of them.
 * `read_lead_standing` is KEPT, because a lead's shape carries the project's
 * attention and notification cursor and a thread has neither.
 *
 * THE WAKE JOIN IS SQL AND NOT A PROCESS. It is a bounded read over four
 * relations, and a runtime that pulled the change rows out and joined them
 * itself would be a second copy of a query the database answers. AUTHORSHIP IS
 * `draft_revision`'S, not the release operation's: `operation` carries no ticket
 * column and the only link is the retained command JSON, so a durable read that
 * followed the release would break the day a command shape moved. The
 * consequence is that a wake follows whoever WROTE a ticket rather than whoever
 * released it.
 *
 * THE CURSOR IS ITS OWN ROW BECAUSE THE PASS IS INSTALLATION-WIDE, like the
 * change log it reads. The selector's own state is per project, so a column on
 * `selector_project_state` would be one cursor per project over one shared log
 * — and a project whose selector had never run would hold a cursor at zero and
 * re-wake every member of every other project's history.
 */

import {
  sessionStorePageBatchesMax,
  sessionStoreStreamsAnswered,
  threadBacklogMax,
  threadTurnsAnsweredMax,
  threadWakesPerPassMax,
  threadsAnsweredMax,
} from "../../../../contract/http.ts";
import {
  allSessionCapabilities,
  sessionCapabilitiesMax,
} from "../../../../interpreter/agentSession.ts";
import { threadCapabilitiesDefault } from "../../../../interpreter/thread.ts";
import {
  apiRole,
  boundaryOwnerRole,
  leadStoreReadFunction,
  leadStreamListFunction,
  projectThreadsReadFunction,
  schemaTextSet,
  selectorServiceRole,
  sessionCapabilitiesSetFunction,
  sessionReferenceWrittenOnceFunction,
  sessionStoreBatchesReadFunction,
  sessionStoreStreamListFunction,
  sessionTurnEnqueueFunction,
  threadMessageEnqueueFunction,
  threadOpenFunction,
  threadStandingReadFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
  type Migration,
} from "../shared.ts";

/** The roster a thread is opened with, rendered as the literal the definer writes. */
const threadRosterLiteral = `ARRAY[${schemaTextSet([
  ...threadCapabilitiesDefault,
])}]::text[]`;

/** The capability check regenerated over the widened roster, exactly as 058 renders it. */
const widenedCapabilities = [
  `ALTER TABLE agent_session
     DROP CONSTRAINT agent_session_capabilities_are_known,
     ADD CONSTRAINT agent_session_capabilities_are_known CHECK (
       cardinality(capabilities) BETWEEN 0 AND ${sessionCapabilitiesMax}
       AND capabilities <@ ARRAY[${schemaTextSet([
         ...allSessionCapabilities,
       ])}]::text[])`,
];

/**
 * The identity a session may never take back, with the roster taken off it and
 * the one door that moves the roster. Everything else 058 froze stays frozen.
 */
const reconfigurableRoster = [
  `CREATE OR REPLACE FUNCTION ${sessionReferenceWrittenOnceFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF (NEW.tenant,NEW.project,NEW.session,NEW.kind,NEW.principal,NEW.parent_session,
           NEW.credential_slot,NEW.account,NEW.cluster,NEW.opened_at)
          IS DISTINCT FROM
          (OLD.tenant,OLD.project,OLD.session,OLD.kind,OLD.principal,OLD.parent_session,
           OLD.credential_slot,OLD.account,OLD.cluster,OLD.opened_at) THEN
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
  `GRANT UPDATE (capabilities) ON agent_session TO ${boundaryOwnerRole}`,
  `CREATE FUNCTION ${sessionCapabilitiesSetFunction}(
     in_tenant text,in_project text,in_session text,in_capabilities text[])
     RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text[];
     BEGIN
       SELECT s.capabilities INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoSession'; END IF;
       IF held IS NOT DISTINCT FROM in_capabilities THEN RETURN 'Unchanged'; END IF;
       UPDATE agent_session s SET capabilities=in_capabilities
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session;
       RETURN 'Set';
     END $$`,
];

/**
 * The door that opens a member's thread, where the partial unique index 058
 * declared is the control and the exception arm turns a race lost against it
 * into the answer the caller wanted.
 */
const memberThread = [
  `CREATE FUNCTION ${threadOpenFunction}(
     in_tenant text,in_project text,in_principal text,in_session text,
     in_credential_slot text,in_system_prompt text)
     RETURNS TABLE(opened text,session text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text; drawn record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open'
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
         VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
                ${threadRosterLiteral},in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt);
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`,
];

/**
 * What both mailbox doors do, differing in the input kind they write and the
 * two arm names they answer under. It is one body taken twice rather than one
 * function with a kind argument, because the two are granted to different roles
 * and a shared function would be a shared grant.
 */
function threadMailboxDoor(door: {
  readonly name: string;
  readonly inputKind: string;
  readonly enqueued: string;
  readonly already: string;
  /** Whether the caller names the session it means, which only the member's door does. */
  readonly named: boolean;
}): string {
  const { name, inputKind, enqueued, already } = door;
  return `CREATE FUNCTION ${name}(
     in_tenant text,in_project text,in_principal text,${
       door.named ? "in_session text," : ""
     }in_turn text,in_input text)
     RETURNS TABLE(enqueued text,ordinal bigint,session text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record; standing bigint; queued bigint; answered record;
     BEGIN
       SELECT s.session,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal
        ORDER BY (s.state='Open') DESC,s.opened_at DESC
        LIMIT 1 FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoThread'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
${
  door.named
    ? `       IF held.session<>in_session THEN
         RETURN QUERY SELECT 'NotYourThread'::text,NULL::bigint,held.session;
         RETURN;
       END IF;
`
    : ""
}       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT '${already}'::text,standing,held.session; RETURN;
       END IF;
       IF NOT EXISTS(SELECT 1 FROM project_membership m
                      WHERE m.principal=in_principal AND m.tenant=in_tenant
                        AND m.project=in_project) THEN
         RETURN QUERY SELECT 'Orphaned'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.state='Queued';
       IF queued>=${threadBacklogMax} THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT * INTO answered FROM ${sessionTurnEnqueueFunction}(
         in_tenant,in_project,held.session,in_turn,'${inputKind}',in_input);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN '${enqueued}'
                             WHEN 'AlreadyEnqueued' THEN '${already}'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$`;
}

const mailboxDoors = [
  threadMailboxDoor({
    name: threadMessageEnqueueFunction,
    inputKind: "UserMessage",
    enqueued: "Enqueued",
    already: "AlreadyEnqueued",
    named: true,
  }),
  threadMailboxDoor({
    name: threadWakeFunction,
    inputKind: "Wake",
    enqueued: "Woken",
    already: "AlreadyWoken",
    named: false,
  }),
];

/**
 * The two reads a thread page is drawn from: the listing, which LEFT JOINs the
 * membership, and the standing read, which admits `kind='Thread'` alone and
 * walks backwards from `in_before`.
 */
const threadReads = [
  `CREATE FUNCTION ${projectThreadsReadFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(session text,principal text,owner text,state text,
                   agent_reference text,turns bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.session,s.principal,m.authority_subject,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session)
         FROM agent_session s
         LEFT JOIN project_membership m
                ON m.tenant=s.tenant AND m.project=s.project
               AND m.principal=s.principal
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
        ORDER BY s.opened_at,s.session
        LIMIT least(coalesce(in_max,${threadsAnsweredMax}),${threadsAnsweredMax})
     $$`,
  `CREATE FUNCTION ${threadStandingReadFunction}(
     in_tenant text,in_project text,in_session text,
     in_before bigint,in_turns_max bigint)
     RETURNS TABLE(session text,principal text,owner text,session_state text,
                   agent_reference text,turns bigint,next_before bigint,
                   turn text,turn_ordinal bigint,input_kind text,turn_state text,
                   input text,result text,failure text,model text,tokens bigint,
                   cost_micros bigint,duration_ms bigint,tools text[],
                   batch_first bigint,batch_last bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       WITH page AS (
         SELECT t.turn,t.ordinal,t.input_kind,t.state,t.input,t.result,t.failure,
                t.model,t.tokens,t.cost_micros,t.duration_ms,t.tools,
                t.batch_first,t.batch_last
           FROM session_turn t
          WHERE t.tenant=in_tenant AND t.project=in_project AND t.session=in_session
            AND (in_before IS NULL OR t.ordinal<in_before)
          ORDER BY t.ordinal DESC
          LIMIT least(coalesce(in_turns_max,${threadTurnsAnsweredMax}),
                      ${threadTurnsAnsweredMax}))
       SELECT s.session,s.principal,m.authority_subject,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              CASE WHEN EXISTS(SELECT 1 FROM session_turn older
                                WHERE older.tenant=s.tenant
                                  AND older.project=s.project
                                  AND older.session=s.session
                                  AND older.ordinal<(SELECT min(q.ordinal) FROM page q))
                   THEN (SELECT min(q.ordinal) FROM page q) END,
              page.turn,page.ordinal,page.input_kind,page.state,page.input,
              page.result,page.failure,page.model,page.tokens,page.cost_micros,
              page.duration_ms,page.tools,page.batch_first,page.batch_last
         FROM agent_session s
         LEFT JOIN project_membership m
                ON m.tenant=s.tenant AND m.project=s.project
               AND m.principal=s.principal
         LEFT JOIN page ON true
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        ORDER BY page.ordinal
     $$`,
];

/**
 * The store reads keyed on the session they are asked about. They read
 * `session_store_batch` under its own primary key rather than joining
 * `agent_session`, because the partition and the session are the key and a join
 * that only re-asserted the row exists would be a second predicate saying
 * nothing.
 */
const sessionStoreReads = [
  `DROP FUNCTION ${leadStoreReadFunction}(text,text,text,bigint,bigint)`,
  `DROP FUNCTION ${leadStreamListFunction}(text,text,bigint)`,
  `CREATE FUNCTION ${sessionStoreBatchesReadFunction}(
     in_tenant text,in_project text,in_session text,in_stream text,
     in_after bigint,in_max bigint)
     RETURNS TABLE(stream text,batch bigint,digest text,bytes bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.stream,b.batch,b.digest,b.bytes
         FROM session_store_batch b
        WHERE b.tenant=in_tenant AND b.project=in_project AND b.session=in_session
          AND b.stream=in_stream AND b.batch>coalesce(in_after,0)
        ORDER BY b.batch
        LIMIT least(coalesce(in_max,${sessionStorePageBatchesMax}),
                    ${sessionStorePageBatchesMax})
     $$`,
  `CREATE FUNCTION ${sessionStoreStreamListFunction}(
     in_tenant text,in_project text,in_session text,in_max bigint)
     RETURNS TABLE(stream text,batches bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.stream,count(*)::bigint
         FROM session_store_batch b
        WHERE b.tenant=in_tenant AND b.project=in_project AND b.session=in_session
        GROUP BY b.stream ORDER BY b.stream
        LIMIT least(coalesce(in_max,${sessionStoreStreamsAnswered}),
                    ${sessionStoreStreamsAnswered})
     $$`,
];

/**
 * The reason a change row carries for the thread it wakes, decided from the
 * kind and the row the resource names. A ticket is matched as `ticket::text =
 * resource` rather than `resource::bigint`, so a change kind this query does
 * not read — one whose resource is not a number at all — is simply no candidate
 * instead of an error the whole pass dies of.
 */
const wakeReason = `CASE c.kind
    WHEN 'AgenticRefusal' THEN
      (SELECT CASE f.event WHEN 'Refused' THEN 'TicketRefused'
                           WHEN 'Lifted' THEN 'RefusalLifted' END
         FROM selector_agentic_refusal f
        WHERE f.tenant=c.tenant AND f.project=c.project
          AND f.ticket::text=c.resource
        ORDER BY f.ordinal DESC LIMIT 1)
    WHEN 'Draft' THEN
      (SELECT 'DraftDeleted' FROM draft d
        WHERE d.tenant=c.tenant AND d.project=c.project
          AND d.ticket::text=c.resource AND d.state='Deleted')
    WHEN 'Ticket' THEN
      (SELECT CASE p.phase WHEN 'Escalated' THEN 'TicketEscalated'
                           WHEN 'Done' THEN 'TicketCompleted'
                           WHEN 'Abandoned' THEN 'TicketAbandoned'
                           WHEN 'Revoked' THEN 'TicketAbandoned' END
         FROM ticket_projection p
        WHERE p.tenant=c.tenant AND p.project=c.project
          AND p.ticket::text=c.resource)
  END`;

/**
 * The wake pass's two doors and the cursor between them. A candidate is one
 * change row and one open thread whose owner authored a revision of the ticket
 * it names: the authorship is asked as an EXISTS rather than joined, so a
 * ticket several of whose revisions one member wrote CANNOT produce that member
 * twice — the duplicate is unrepresentable instead of removed afterwards.
 */
const wakePass = [
  `CREATE TABLE thread_wake_cursor (
     singleton boolean PRIMARY KEY DEFAULT true,
     sequence bigint NOT NULL DEFAULT 0,
     CONSTRAINT thread_wake_cursor_is_one_row CHECK (singleton),
     CONSTRAINT thread_wake_cursor_is_not_negative CHECK (sequence >= 0))`,
  `INSERT INTO thread_wake_cursor (singleton) VALUES (true)`,
  `GRANT SELECT ON thread_wake_cursor TO ${selectorServiceRole}`,
  `GRANT SELECT,UPDATE (sequence) ON thread_wake_cursor TO ${boundaryOwnerRole}`,
  `CREATE FUNCTION ${threadWakeCandidatesFunction}(in_after bigint,in_max bigint)
     RETURNS TABLE(sequence bigint,tenant text,project text,kind text,
                   resource text,reason text,principal text,session text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT c.sequence,c.tenant,c.project,c.kind,c.resource,named.reason,
              s.principal,s.session
         FROM project_change c
         CROSS JOIN LATERAL (SELECT ${wakeReason} AS reason) named
         JOIN agent_session s
           ON s.tenant=c.tenant AND s.project=c.project
          AND s.kind='Thread' AND s.state='Open'
        WHERE c.sequence>coalesce(in_after,0)
          AND named.reason IS NOT NULL
          AND EXISTS(SELECT 1 FROM draft_revision r
                       JOIN project_membership m
                         ON m.tenant=r.tenant AND m.project=r.project
                        AND m.authority_kind=r.authority_kind
                        AND m.authority_subject=r.authority_subject
                      WHERE r.tenant=c.tenant AND r.project=c.project
                        AND r.ticket::text=c.resource
                        AND m.principal=s.principal)
        ORDER BY c.sequence,s.session
        LIMIT least(coalesce(in_max,${threadWakesPerPassMax}),
                    ${threadWakesPerPassMax})
     $$`,
  `CREATE FUNCTION ${threadWakeCursorAdvanceFunction}(in_sequence bigint)
     RETURNS bigint
     LANGUAGE sql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       UPDATE thread_wake_cursor
          SET sequence=greatest(sequence,coalesce(in_sequence,0))
        WHERE singleton
        RETURNING sequence
     $$`,
];

/** Every door 062 declares, beside the argument types each is named by. */
const threadSignatures: readonly (readonly [string, string, string])[] = [
  [threadOpenFunction, "text,text,text,text,text,text", apiRole],
  [threadMessageEnqueueFunction, "text,text,text,text,text,text", apiRole],
  [projectThreadsReadFunction, "text,text,bigint", apiRole],
  [threadStandingReadFunction, "text,text,text,bigint,bigint", apiRole],
  [
    sessionStoreBatchesReadFunction,
    "text,text,text,text,bigint,bigint",
    apiRole,
  ],
  [sessionStoreStreamListFunction, "text,text,text,bigint", apiRole],
  [threadWakeFunction, "text,text,text,text,text", selectorServiceRole],
  [threadWakeCandidatesFunction, "bigint,bigint", selectorServiceRole],
  [threadWakeCursorAdvanceFunction, "bigint", selectorServiceRole],
];

/**
 * `set_session_capabilities` is granted to NO runtime role, exactly as
 * `open_agent_session` is not: a role that could rewrite a roster could widen
 * the thread it acts through, and reconfiguring one is provisioning rather than
 * work. The identity that owns the boundary is what runs it.
 */
const capabilitiesSignature = "text,text,text,text[]";

const doorGrants = [
  ...threadSignatures.map(
    ([name, signature]) =>
      `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  ),
  ...threadSignatures.map(
    ([name, signature]) =>
      `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  ),
  ...threadSignatures.map(
    ([name, signature, role]) =>
      `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${role}`,
  ),
  `ALTER FUNCTION ${sessionCapabilitiesSetFunction}(${capabilitiesSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionCapabilitiesSetFunction}(${capabilitiesSignature})
     FROM PUBLIC`,
];

/** A member's thread, the messages it takes and the changes that wake it. */
export const migration062: Migration = {
  version: 62,
  name: "member threads, their messages and their wakes",
  statements: [
    ...widenedCapabilities,
    ...reconfigurableRoster,
    ...memberThread,
    ...mailboxDoors,
    ...threadReads,
    ...sessionStoreReads,
    ...wakePass,
    ...doorGrants,
  ],
};
