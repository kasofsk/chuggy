/**
 * Every lead and inquiry session is deleted with the rows under it, and a
 * session, its turns and its capability sets admit a thread's alone.
 *
 * IT REFUSES RATHER THAN REWRITES. Before anything is deleted it asserts that
 * no lead or inquiry is open, has an attempt placing or running or a turn
 * queued or claimed, that no thread holds `LeadDecision`, and that no thread's
 * turn is an `Observation` or an `Inquiry`. A database holding any of them
 * fails here, its rows untouched.
 *
 * THE DELETION clears `operation.via_session` and `draft.origin_session` where
 * they name such a session, keeping the rows and their foreign keys; deletes
 * its `session_turn_context` rows, then its `session_store_batch` rows, each
 * with its write-once trigger, `session_turn_context_is_written_once` and
 * `session_store_batch_is_written_once`, disabled for that statement alone;
 * then its `session_turn` and `session_attempt` rows, the inquiries'
 * `agent_session` rows and the leads'; and last every `Session` row of
 * `project_change` whose resource names a lead's or an inquiry's kind.
 *
 * A LEAD'S TRANSCRIPT BYTES STAY ON THE ARTIFACTS VOLUME, under
 * `artifactSessionRoot`'s directory for each session, which no migration
 * reaches: nothing reads them once their rows are gone. An operator who wants
 * them removed lists the sessions before rollout with
 * `SELECT tenant,project,session FROM agent_session WHERE kind='Lead'` and
 * removes each one's directory by hand.
 *
 * THE CHECKS NARROW: `agent_session_kind_is_known` to `Thread`,
 * `agent_session_capabilities_are_known` without `LeadDecision`, and
 * `session_turn_kind_is_known` to `UserMessage`, `Wake` and `OfferReply`.
 * `chat_host.session_capabilities` and `session_attempt.host_capabilities` lose
 * `LeadDecision`, the second with `session_attempt_is_fenced` disabled for that
 * statement alone, and `chat_host_session_capabilities_are_known` and
 * `session_attempt_host_capabilities_are_known` are 180's less it.
 * `agent_session_one_lead_per_project` is dropped.
 *
 * THE FORK, THE COMPACTION WINDOW AND THE OWN-PROMPT FLAG ARE DROPPED:
 * `agent_session.parent_session`, `auto_compact_window` and
 * `system_prompt_own`, with `agent_session_forks_a_session`,
 * `agent_session_parent_is_whole` and
 * `agent_session_auto_compact_window_is_a_leads`. Every function that read
 * them is written first without them. `read_session_attempt`,
 * `read_session_opening` and `sessions_awaiting_placement` change their result
 * types, so each is dropped and created again and given the owner and grant
 * it held. `open_agent_session` keeps its signature and answers
 * `Conflict` to a parent; it, `agent_session_is_written_once`,
 * `list_session_streams` and `read_session_store` are replaced in place and
 * keep their owners and grants.
 */

import {
  apiRole,
  boundaryOwnerRole,
  schedulerRole,
  sessionAttemptReadFunction,
  sessionOpenFunction,
  sessionOpeningReadFunction,
  sessionStoreReadFunction,
  sessionStreamListFunction,
  sessionsAwaitingPlacementFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";
import { capabilitiesHeld } from "./180-chat-host-session-capabilities.ts";

/** Every capability a session may hold, in the order the runtime names them. */
const sessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
  "TicketDispatch",
  "MemberRead",
  "ThreadOffer",
];

/** Every kind of turn a mailbox may hold, in the order the runtime names them. */
const sessionTurnInputKinds = ["UserMessage", "Wake", "OfferReply"];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** The CHECK that holds `column` to known capabilities, no more of them than there are, or to NULL. */
function capabilitySet(column: string): string {
  return `CHECK (cardinality(${column}) <= ${String(sessionCapabilities.length)}
                AND ${column} <@ ${textArray(sessionCapabilities)})`;
}

/** Whether the row of `alias`'s `column` names a lead or an inquiry of its own project. */
function retiredSession(alias: string, column: string): string {
  return `EXISTS(SELECT 1 FROM agent_session s
                  WHERE s.tenant=${alias}.tenant AND s.project=${alias}.project
                    AND s.session=${alias}.${column}
                    AND s.kind IN ('Lead','Inquiry'))`;
}

/** The rows that would still be live or name the lead, each a reason this migration refuses. */
const historyStillLive = `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.agent_session
                WHERE kind IN ('Lead','Inquiry') AND state='Open') THEN
      RAISE EXCEPTION 'migration 208: a lead or an inquiry is open'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.session_attempt a
                WHERE a.state IN ('Placing','Running')
                  AND ${retiredSession("a", "session")}) THEN
      RAISE EXCEPTION 'migration 208: a lead or an inquiry has a live attempt'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.session_turn t
                WHERE t.state IN ('Queued','Claimed')
                  AND ${retiredSession("t", "session")}) THEN
      RAISE EXCEPTION 'migration 208: a lead or an inquiry has a turn to take'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.agent_session
                WHERE kind='Thread' AND 'LeadDecision'=ANY(capabilities)) THEN
      RAISE EXCEPTION 'migration 208: a thread holds LeadDecision'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.session_turn t
                JOIN public.agent_session s USING (tenant,project,session)
                WHERE s.kind='Thread' AND t.input_kind IN ('Observation','Inquiry')) THEN
      RAISE EXCEPTION 'migration 208: a thread holds an observation or an inquiry'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END $$`;

/** Deletes `table`'s rows of every lead and inquiry. */
function retiredRowsDeleted(table: string): string {
  return `DELETE FROM public.${table} r WHERE ${retiredSession("r", "session")}`;
}

/** `retiredRowsDeleted` of `table`, with its write-once `trigger` disabled around it. */
function retiredRowsDeletedPast(table: string, trigger: string): string[] {
  return [
    `ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`,
    retiredRowsDeleted(table),
    `ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`,
  ];
}

const attemptRead = `public.${sessionAttemptReadFunction}(in_secret_digest text)`;

const opening = `public.${sessionOpeningReadFunction}(in_tenant text, in_project text, in_session text)`;

const awaiting = `public.${sessionsAwaitingPlacementFunction}(in_epoch text, in_max bigint)`;

/** The definer boilerplate a dropped function is given again, granted to `role` as `privilege`. */
function owned(
  signature: string,
  role: string,
  privilege: "ALL" | "EXECUTE",
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ${privilege} ON FUNCTION ${signature} TO ${role}`,
  ];
}

const attemptReadCreated = `CREATE FUNCTION ${attemptRead} RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint, kind text, principal text, capabilities text[], credential_slot text, agent_reference text, system_prompt text, model text, effort text, shell_credential_handed boolean, live boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              ${capabilitiesHeld("s.capabilities", "a.host_capabilities")},
              s.credential_slot,s.agent_reference,s.system_prompt,s.model,s.effort,
              (s.kind='Thread' AND a.holder_kind='ChatHost'
               AND a.host_capabilities IS NOT NULL),
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`;

const openingCreated = `CREATE FUNCTION ${opening} RETURNS TABLE(system_prompt text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.system_prompt
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
     $$`;

const awaitingCreated = `CREATE FUNCTION ${awaiting} RETURNS TABLE(tenant text, project text, session text, kind text, principal text, agent_reference text, capabilities text[], credential_slot text, account text, cluster text, state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.tenant,s.project,s.session,s.kind,s.principal,
              s.agent_reference,s.capabilities,s.credential_slot,s.account,s.cluster,s.state
         FROM agent_session s
        WHERE s.state='Open'
          AND in_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
          AND session_waiting_route(s.tenant,s.project,s.session)='InCluster'
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                      WHERE a.tenant=s.tenant AND a.project=s.project
                        AND a.session=s.session AND a.state IN ('Placing','Running'))
        ORDER BY s.tenant,s.project,s.session
        LIMIT in_max
     $$`;

const sessionOpened = `CREATE OR REPLACE FUNCTION public.${sessionOpenFunction}(in_tenant text, in_project text, in_session text, in_kind text, in_principal text, in_parent text, in_capabilities text[], in_credential_slot text, in_system_prompt text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; drawn record;
     BEGIN
       IF in_parent IS NOT NULL THEN RETURN 'Conflict'; END IF;
       SELECT s.kind,s.principal,s.capabilities,s.credential_slot,
              s.system_prompt,s.state
         INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        FOR UPDATE;
       IF FOUND THEN
         RETURN CASE WHEN held.state='Open' AND held.kind=in_kind
                      AND held.principal=in_principal
                      AND held.capabilities IS NOT DISTINCT FROM in_capabilities
                      AND held.credential_slot=in_credential_slot
                      AND held.system_prompt IS NOT DISTINCT FROM in_system_prompt
                     THEN 'AlreadyOpen' ELSE 'Conflict' END;
       END IF;
       IF in_kind='Thread' THEN
         PERFORM pg_advisory_xact_lock(hashtextextended(
         'member-thread-open:' || in_tenant || '/' || in_project || '/' || in_principal, 0));
         IF (SELECT count(*) FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open')>=member_thread_limit(in_tenant,in_project,in_principal) THEN
           RETURN 'Conflict';
         END IF;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,
          credential_slot,account,cluster,system_prompt)
       VALUES(in_tenant,in_project,in_session,in_kind,in_principal,
              in_capabilities,in_credential_slot,drawn.account,drawn.cluster,
              in_system_prompt);
       RETURN 'Opened';
     END $$`;

const writtenOnce = `CREATE OR REPLACE FUNCTION public.agent_session_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF (NEW.tenant,NEW.project,NEW.session,NEW.kind,NEW.principal,
           NEW.credential_slot,NEW.account,NEW.cluster,NEW.opened_at,NEW.open_key,
           NEW.scope)
          IS DISTINCT FROM
          (OLD.tenant,OLD.project,OLD.session,OLD.kind,OLD.principal,
           OLD.credential_slot,OLD.account,OLD.cluster,OLD.opened_at,OLD.open_key,
           OLD.scope) THEN
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
     END $$`;

const streamsListed = `CREATE OR REPLACE FUNCTION public.${sessionStreamListFunction}(in_secret_digest text, in_generation bigint, in_max bigint) RETURNS TABLE(stream text, batches bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT b.stream,count(*)::bigint
         FROM session_attempt_binding(in_secret_digest,in_generation) k
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=k.session
        GROUP BY b.stream ORDER BY b.stream
        LIMIT least(coalesce(in_max,101),
                    101)
     $$`;

const storeRead = `CREATE OR REPLACE FUNCTION public.${sessionStoreReadFunction}(in_secret_digest text, in_generation bigint, in_stream text, in_after bigint, in_limit bigint) RETURNS TABLE(session text, batch bigint, digest text, bytes bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT b.session,b.batch,b.digest,b.bytes
         FROM session_attempt_binding(in_secret_digest,in_generation) k
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=k.session
        WHERE b.stream=in_stream AND b.batch>coalesce(in_after,0)
        ORDER BY b.batch
        LIMIT least(coalesce(in_limit,8),
                    8)
     $$`;

export const migration208: Migration = {
  version: 208,
  name: "every lead and inquiry is deleted, and a session is a thread",
  statements: [
    historyStillLive,
    `UPDATE public.operation o SET via_session=NULL
      WHERE ${retiredSession("o", "via_session")}`,
    `UPDATE public.draft d SET origin_session=NULL
      WHERE ${retiredSession("d", "origin_session")}`,
    ...retiredRowsDeletedPast(
      "session_turn_context",
      "session_turn_context_is_written_once",
    ),
    ...retiredRowsDeletedPast(
      "session_store_batch",
      "session_store_batch_is_written_once",
    ),
    retiredRowsDeleted("session_turn"),
    retiredRowsDeleted("session_attempt"),
    `DELETE FROM public.agent_session WHERE kind='Inquiry'`,
    `DELETE FROM public.agent_session WHERE kind='Lead'`,
    `DELETE FROM public.project_change
      WHERE kind='Session' AND resource IS JSON OBJECT
        AND resource::jsonb->>'kind' IN ('Lead','Inquiry')`,
    `DROP INDEX public.agent_session_one_lead_per_project`,
    `ALTER TABLE public.agent_session
       DROP CONSTRAINT agent_session_kind_is_known,
       DROP CONSTRAINT agent_session_capabilities_are_known,
       ADD CONSTRAINT agent_session_kind_is_known CHECK (kind = 'Thread'),
       ADD CONSTRAINT agent_session_capabilities_are_known
         CHECK (cardinality(capabilities) BETWEEN 0 AND 16
                AND capabilities <@ ${textArray(sessionCapabilities)})`,
    `ALTER TABLE public.session_turn
       DROP CONSTRAINT session_turn_kind_is_known,
       ADD CONSTRAINT session_turn_kind_is_known
         CHECK (input_kind = ANY (${textArray(sessionTurnInputKinds)}))`,
    `UPDATE public.chat_host
        SET session_capabilities=array_remove(session_capabilities,'LeadDecision')
      WHERE 'LeadDecision'=ANY(session_capabilities)`,
    `ALTER TABLE public.chat_host
       DROP CONSTRAINT chat_host_session_capabilities_are_known,
       ADD CONSTRAINT chat_host_session_capabilities_are_known
         ${capabilitySet("session_capabilities")}`,
    `ALTER TABLE public.session_attempt DISABLE TRIGGER session_attempt_is_fenced`,
    `UPDATE public.session_attempt
        SET host_capabilities=array_remove(host_capabilities,'LeadDecision')
      WHERE 'LeadDecision'=ANY(host_capabilities)`,
    `ALTER TABLE public.session_attempt ENABLE TRIGGER session_attempt_is_fenced`,
    `ALTER TABLE public.session_attempt
       DROP CONSTRAINT session_attempt_host_capabilities_are_known,
       ADD CONSTRAINT session_attempt_host_capabilities_are_known
         ${capabilitySet("host_capabilities")}`,
    `DROP FUNCTION ${attemptRead}`,
    attemptReadCreated,
    ...owned(attemptRead, workerPlaneRole, "ALL"),
    `DROP FUNCTION ${opening}`,
    openingCreated,
    ...owned(opening, apiRole, "EXECUTE"),
    `DROP FUNCTION ${awaiting}`,
    awaitingCreated,
    ...owned(awaiting, schedulerRole, "ALL"),
    sessionOpened,
    writtenOnce,
    streamsListed,
    storeRead,
    `ALTER TABLE public.agent_session
       DROP CONSTRAINT agent_session_forks_a_session,
       DROP CONSTRAINT agent_session_parent_is_whole,
       DROP CONSTRAINT agent_session_auto_compact_window_is_a_leads,
       DROP COLUMN parent_session,
       DROP COLUMN auto_compact_window,
       DROP COLUMN system_prompt_own`,
  ],
};
