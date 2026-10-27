/**
 * A member holds several open threads in a project, up to a limit of their own
 * there, and a ticket event wakes the one thread its draft was filed from.
 *
 * `agent_session_one_thread_per_member` IS DROPPED. What bounds a member's open
 * threads now is a count, taken under an advisory lock on the member's
 * `(tenant, project, principal)`, against `member_thread_limit`: the row
 * `set_member_thread_limit` writes, or `threadsOpenDefault` where none was
 * written. Every door that opens a thread takes that lock and that count, so
 * two opens racing for the last slot are serialized rather than both admitted.
 * A limit lowered below what a member holds closes nothing; it refuses their
 * next open until they are under it.
 *
 * AN OPEN IS IDEMPOTENT ON THE CLIENT'S KEY. `open_member_thread` takes the key
 * its caller minted and records it in `agent_session.open_key`, unique per
 * member, so the same key again answers the thread it opened, whatever that
 * thread's state now. A key is checked before the count, so a retried open
 * that already succeeded is never refused for the slot it took itself.
 * `open_agent_session`, the provisioning door, opens a thread with no key and
 * is held to the same count, answering `Conflict` at the limit as it answered
 * a second open thread before.
 *
 * THE MAILBOX IS THE SESSION NAMED. `enqueue_thread_message` resolved a
 * member's one thread from their principal; it now takes the session the
 * caller named, refuses one that is not this member's thread, and answers as
 * before otherwise. `wake_member_thread` takes the session it wakes for the same
 * reason, in place of the principal.
 *
 * A DRAFT CARRIES ITS ORIGIN SESSION: the session whose bearer created it,
 * which no revision moves. It is a column of `draft` because that row outlives
 * every reason a thread is woken for — a deleted draft and a released one keep
 * theirs. `thread_wake_candidates` answers the origin alone, and only while it
 * is an open thread, so a draft filed from the console, or from a thread since
 * closed, wakes nobody. A draft that stood before this migration is given the
 * thread its first revision's member held open then, which is at most one,
 * because that is the thread its events woke until now.
 *
 * The bodies are written out rather than built from a helper, so this file goes
 * on saying what it installed when the baseline changes.
 */

import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  selectorServiceRole,
  sessionOpenFunction,
  sessionReferenceWrittenOnceFunction,
  threadLimitFunction,
  threadLimitSetFunction,
  threadMessageEnqueueFunction,
  threadOpenFunction,
  threadWakeCandidatesFunction,
  threadWakeFunction,
  type Migration,
} from "../shared.ts";

/** The open threads a member holds in a project where no limit was written for them. */
const threadsOpenDefault = 10;

/** The most a limit may be written as, which is what one thread listing answers. */
const threadsOpenMax = 64;

/** The longest key an open is idempotent on. */
const openKeyCharsMax = 64;

/** The key itself: what a client mints, in a charset every surface holds unescaped. */
const openKeyPattern = `^[A-Za-z0-9_-]{1,${String(openKeyCharsMax)}}$`;

const limitRead = `public.${threadLimitFunction}(in_tenant text, in_project text, in_principal text)`;

const limitSet = `public.${threadLimitSetFunction}(in_tenant text, in_project text, in_principal text, in_threads_max bigint, in_authority_kind text, in_authority_subject text)`;

const threadOpenOld = `public.${threadOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_credential_slot text, in_system_prompt text)`;

const threadOpen = `public.${threadOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_key text, in_credential_slot text, in_system_prompt text)`;

const sessionOpen = `public.${sessionOpenFunction}(in_tenant text, in_project text, in_session text, in_kind text, in_principal text, in_parent text, in_capabilities text[], in_credential_slot text, in_system_prompt text)`;

const messageEnqueue = `public.${threadMessageEnqueueFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text, in_route text)`;

const wakeOld = `public.${threadWakeFunction}(in_tenant text, in_project text, in_principal text, in_turn text, in_input text, in_route text)`;

const wake = `public.${threadWakeFunction}(in_tenant text, in_project text, in_session text, in_turn text, in_input text, in_route text)`;

const wakeCandidates = `public.${threadWakeCandidatesFunction}(in_after bigint, in_max bigint)`;

const draftCreateOld = `public.${draftCreateFunction}(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text)`;

const draftCreate = `public.${draftCreateFunction}(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text, in_origin_session text)`;

/** The lock every door opening a member's thread takes before it counts their open ones. */
const memberThreadLock = `pg_advisory_xact_lock(hashtextextended(
         'member-thread-open:' || in_tenant || '/' || in_project || '/' || in_principal, 0))`;

/** The open threads a member holds in the project, which the lock above makes a count no other open can race. */
const memberThreadsOpen = `(SELECT count(*) FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open')`;

/** The definer boilerplate a function created here ends with. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
  ];
}

const limitStatements = [
  `CREATE TABLE public.member_thread_limit (
       tenant text NOT NULL,
       project text NOT NULL,
       principal text NOT NULL,
       threads_max bigint NOT NULL
         CONSTRAINT member_thread_limit_is_bounded
         CHECK (threads_max BETWEEN 1 AND ${String(threadsOpenMax)}),
       set_by_kind text NOT NULL
         CONSTRAINT member_thread_limit_setter_kind_is_bounded
         CHECK (length(set_by_kind) BETWEEN 1 AND 256),
       set_by_subject text NOT NULL
         CONSTRAINT member_thread_limit_setter_subject_is_bounded
         CHECK (length(set_by_subject) BETWEEN 1 AND 256),
       set_at timestamp with time zone NOT NULL,
       PRIMARY KEY (tenant,project,principal),
       CONSTRAINT member_thread_limit_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.member_thread_limit TO ${boundaryOwnerRole}`,
  `CREATE FUNCTION ${limitRead} RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT coalesce(
         (SELECT l.threads_max FROM member_thread_limit l
           WHERE l.tenant=in_tenant AND l.project=in_project
             AND l.principal=in_principal),
         ${String(threadsOpenDefault)})
     $$`,
  ...owned(limitRead, apiRole),
  `CREATE FUNCTION ${limitSet} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing bigint;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF NOT FOUND THEN RETURN 'NotFound'; END IF;
       SELECT l.threads_max INTO standing FROM member_thread_limit l
        WHERE l.tenant=in_tenant AND l.project=in_project
          AND l.principal=in_principal FOR UPDATE;
       IF FOUND AND standing=in_threads_max THEN RETURN 'Unchanged'; END IF;
       INSERT INTO member_thread_limit
         (tenant,project,principal,threads_max,set_by_kind,set_by_subject,set_at)
         VALUES (in_tenant,in_project,in_principal,in_threads_max,
                 in_authority_kind,in_authority_subject,now())
         ON CONFLICT (tenant,project,principal) DO UPDATE
           SET threads_max=EXCLUDED.threads_max,
               set_by_kind=EXCLUDED.set_by_kind,
               set_by_subject=EXCLUDED.set_by_subject,
               set_at=EXCLUDED.set_at;
       RETURN 'Written';
     END $$`,
  ...owned(limitSet, apiRole),
];

const sessionStatements = [
  `DROP INDEX public.agent_session_one_thread_per_member`,
  `ALTER TABLE public.agent_session
       ADD COLUMN open_key text
         CONSTRAINT agent_session_open_key_is_bounded
         CHECK (open_key IS NULL OR open_key ~ '${openKeyPattern}')`,
  `CREATE UNIQUE INDEX agent_session_open_key_is_unique
       ON public.agent_session USING btree (tenant, project, principal, open_key)
       WHERE (open_key IS NOT NULL)`,
  `CREATE OR REPLACE FUNCTION public.${sessionReferenceWrittenOnceFunction}() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF (NEW.tenant,NEW.project,NEW.session,NEW.kind,NEW.principal,NEW.parent_session,
           NEW.credential_slot,NEW.account,NEW.cluster,NEW.opened_at,NEW.open_key)
          IS DISTINCT FROM
          (OLD.tenant,OLD.project,OLD.session,OLD.kind,OLD.principal,OLD.parent_session,
           OLD.credential_slot,OLD.account,OLD.cluster,OLD.opened_at,OLD.open_key) THEN
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
  `DROP FUNCTION ${threadOpenOld}`,
  `CREATE FUNCTION ${threadOpen} RETURNS TABLE(opened text, session text, threads_max bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; allowed bigint; drawn record;
     BEGIN
       PERFORM ${memberThreadLock};
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal AND s.open_key=in_key;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held,NULL::bigint; RETURN;
       END IF;
       allowed := member_thread_limit(in_tenant,in_project,in_principal);
       IF ${memberThreadsOpen}>=allowed THEN
         RETURN QUERY SELECT 'ThreadLimitReached'::text,NULL::text,allowed; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster,system_prompt,opened_after_sequence,open_key)
       VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
              ARRAY['RepositoryRead', 'RunCommands', 'ProjectRead', 'DraftAuthor', 'DraftOriginate', 'TicketDispatch']::text[],in_credential_slot,
              drawn.account,drawn.cluster,in_system_prompt,
              coalesce((SELECT max(head.sequence) FROM project_change head),0),
              in_key);
       RETURN QUERY SELECT 'Opened'::text,in_session,NULL::bigint;
     END $$`,
  ...owned(threadOpen, apiRole),
  `CREATE OR REPLACE FUNCTION ${sessionOpen} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
       IF in_kind='Thread' THEN
         PERFORM ${memberThreadLock};
         IF ${memberThreadsOpen}>=member_thread_limit(in_tenant,in_project,in_principal) THEN
           RETURN 'Conflict';
         END IF;
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
  `CREATE OR REPLACE FUNCTION ${messageEnqueue} RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; answered record;
     BEGIN
       SELECT s.session,s.principal,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoThread'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF held.principal<>in_principal THEN
         RETURN QUERY SELECT 'NotYourThread'::text,NULL::bigint,held.session;
         RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyEnqueued'::text,standing,held.session; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.state='Queued';
       IF queued>=8 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held.session,in_turn,'UserMessage',in_input,in_route);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN 'Enqueued'
                             WHEN 'AlreadyEnqueued' THEN 'AlreadyEnqueued'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$`,
  `DROP FUNCTION ${wakeOld}`,
  `CREATE FUNCTION ${wake} RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; answered record;
     BEGIN
       SELECT s.session,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoThread'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyWoken'::text,standing,held.session; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.state='Queued';
       IF queued>=8 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held.session,in_turn,'Wake',in_input,in_route);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN 'Woken'
                             WHEN 'AlreadyEnqueued' THEN 'AlreadyWoken'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$`,
  ...owned(wake, selectorServiceRole),
];

const originStatements = [
  `ALTER TABLE public.draft
       ADD COLUMN origin_session text,
       ADD CONSTRAINT draft_origin_is_a_session
         FOREIGN KEY (tenant,project,origin_session)
         REFERENCES public.agent_session(tenant,project,session)`,
  `UPDATE public.draft d SET origin_session=s.session
     FROM public.draft_revision r, public.agent_session s
    WHERE r.tenant=d.tenant AND r.project=d.project AND r.ticket=d.ticket
      AND r.authoring_version=1 AND r.authority_kind='Member'
      AND s.tenant=d.tenant AND s.project=d.project AND s.kind='Thread'
      AND s.state='Open' AND s.principal=r.authority_subject`,
  `DROP FUNCTION ${draftCreateOld}`,
  `CREATE FUNCTION ${draftCreate} RETURNS TABLE(result text, ticket bigint, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE minted bigint; landing text; target text;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project
            AND revision=in_configuration AND digest=in_configuration_digest)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       landing := coalesce(in_finalization_mode,
     (SELECT b.landing_mode FROM project_repository b
       WHERE b.tenant=in_tenant AND b.project=in_project
         AND b.repository=in_repository),
     'Push');
       target := in_finalization_target;
       IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',NULL::bigint,NULL::bigint,NULL::text; RETURN;
       END IF;
       UPDATE project SET ticket_next=ticket_next+1
        WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active' AND head=in_expected_head
        RETURNING ticket_next-1 INTO minted;
       IF minted IS NULL THEN RETURN QUERY SELECT 'Stale',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision,origin_session)
         VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration,in_origin_session);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,selection,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_overrides::jsonb,in_selection::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,landing,target,in_repository);
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       INSERT INTO draft_brief_image (tenant,project,ticket,ordinal,artifact)
         SELECT in_tenant,in_project,minted,image.ordinal,image.artifact
           FROM unnest(in_images) WITH ORDINALITY AS image(artifact,ordinal);
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,minted,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  ...owned(draftCreate, apiRole),
  `CREATE OR REPLACE FUNCTION ${wakeCandidates} RETURNS TABLE(sequence bigint, tenant text, project text, kind text, resource text, reason text, principal text, session text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT c.sequence,c.tenant,c.project,c.kind,c.resource,c.wake_reason,
              s.principal,s.session
         FROM project_change c
         JOIN draft d
           ON d.tenant=c.tenant AND d.project=c.project
          AND d.ticket::text=c.resource
         JOIN agent_session s
           ON s.tenant=d.tenant AND s.project=d.project
          AND s.session=d.origin_session
          AND s.kind='Thread' AND s.state='Open'
          AND c.sequence>s.opened_after_sequence
        WHERE c.sequence>coalesce(in_after,0)
          AND c.wake_reason IS NOT NULL
        ORDER BY c.sequence,s.session
        LIMIT least(coalesce(in_max,64),
                    64)
     $$`,
];

export const migration086: Migration = {
  version: 86,
  name: "a member holds several open threads, and a ticket wakes the one it was filed from",
  statements: [...limitStatements, ...sessionStatements, ...originStatements],
};
