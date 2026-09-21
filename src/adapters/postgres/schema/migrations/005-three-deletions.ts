import type { Migration } from "../shared.ts";

/**
 * Three values leave the machine at once, and with them everything only they
 * reached: the `NoFinalizer` a release could choose, the `DependencyRevoked` a
 * ticket was parked under when a dependency it waited on was revoked, and the
 * `AnyPass` a stage could be evaluated by. A release names one finalizer, a
 * stage passes unanimously, and a revoke transitions the ticket it names and
 * nothing else.
 *
 * THE GUARD IS THE FIRST STATEMENT BECAUSE A NARROWED CHECK IS NOT A NO-OP
 * OVER STORED ROWS. `ADD CONSTRAINT` revalidates what the relation already
 * holds, so an installation that parked a ticket at the removed reason would
 * otherwise fail partway down this list; it refuses at the top instead, naming
 * the relations that hold the rows, and the whole migration rolls back with
 * its ledger row.
 *
 * THE GUARD READS FIELDS RATHER THAN TEXT, for the reason 004's header gives:
 * a row that mentions a removed value is not a row that reached it. The cast
 * stands behind `IS JSON OBJECT` as the `journal_entry_release_ticket` index
 * does, so a row that is not a document is not a cast failure. The cascade
 * leaves no literal to look for, so the guard reads its shape instead: a
 * revoke record that transitioned more than one ticket is a cascade, and a
 * decider that parks nothing can never produce that record again.
 *
 * `native_action` KEEPS A SETTLED-ROW ARM AND `ticket_projection` DOES NOT. A
 * settled desk task is a human's recorded decision, and the wire never reads
 * one — only an Open action is offered, resolved or waited on — so a settled
 * row at the removed reason is history rather than a machine state. The rig
 * holds such rows on its real project, so refusing them is refusing to migrate
 * the installation this release is for; the projection holds none, and the
 * guard above is what says so. The arm admits no new row either way: every
 * writer inserts an action Open, the guard refuses an Open one at the removed
 * reason, and only a row that was already there can reach the arm.
 *
 * THE JOURNAL'S TEXT IS DIGEST-CHAINED, SO `decision_event_is_valid` ADMITS
 * THE LEGACY KEYS RATHER THAN HAVING THEM REWRITTEN. A stored entry's bytes
 * are what its digest attests, so no `finalizer` or `combinator` key can be
 * dropped from one; the function admits the key absent or at its surviving
 * spelling and refuses the removed spelling, which is the line the guard draws
 * over the rows, drawn again over what the boundary will accept next.
 *
 * `create_draft` AND `revise_draft` LOSE THE LANDING ARM THEY GUARDED WITH THE
 * FINALIZER. A draft that lands nothing is a landing choice rather than a
 * finalizer choice, so the authoring no longer answers the question and the
 * landing is resolved for every draft the way it was resolved for the rest.
 *
 * `None` JOINS THE TWO LANDING ROSTERS BY WIDENING, WHICH IS WHY IT NEEDS NO
 * ARM IN THE GUARD. A widened check revalidates the same rows and admits
 * strictly more of them, so there is no stored row it can refuse and nothing
 * for the guard to look for.
 *
 * A BRIEF THAT RECORDED NO LANDING RECORDED THE ONE THAT LANDS NOTHING, AND IS
 * REWRITTEN TO SAY SO. The two functions above are the only writers of
 * `draft_brief`, and every branch but the removed arm resolved a landing:
 * `coalesce` of the brief's mode, the repository's, and `Push` is never null.
 * So a null `finalization_mode` is exactly a draft whose authoring named the
 * finalizer that lands nothing, which is what `None` is the name for now.
 */

export const migration005: Migration = {
  version: 5,
  name: "the finalizer choice, the revoke cascade and the combinator leave",
  statements: [
    `DO $$
       DECLARE holders text;
       BEGIN
         SELECT string_agg(relation, ', ' ORDER BY relation) INTO holders FROM (
           SELECT 'ticket_projection' AS relation
            WHERE EXISTS (SELECT FROM public.ticket_projection
                           WHERE reason = 'DependencyRevoked')
           UNION ALL
           SELECT 'native_action'
            WHERE EXISTS (SELECT FROM public.native_action
                           WHERE state = 'Open' AND reason = 'DependencyRevoked')
           UNION ALL
           SELECT 'journal_entry'
            WHERE EXISTS (
              SELECT FROM public.journal_entry AS stored
              CROSS JOIN LATERAL (SELECT CASE WHEN stored.entry IS JSON OBJECT
                                              THEN stored.entry::jsonb END AS document) AS read
               WHERE read.document->'event'->'value'->>'finalizer' = 'NoFinalizer'
                  OR read.document->'event'->'value'->'prog'
                     @> '[{"combinator":"AnyPass"}]'::jsonb
                  OR read.document->'event'->'value'->>'reason' = 'DependencyRevoked'
                  OR (read.document->'rec'->>'label' = 'ticket-revoked'
                      AND CASE WHEN jsonb_typeof(read.document->'rec'->'transitions') = 'array'
                               THEN jsonb_array_length(read.document->'rec'->'transitions') END > 1))
         ) AS held;
         IF holders IS NOT NULL THEN
           RAISE EXCEPTION 'rows this migration no longer admits remain in %', holders
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'Dispatch', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'TaskDone' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND command_integer(value->'tid')
           AND value->>'verdict' IN ('Pass', 'Fail')
           AND jsonb_typeof(value->'result') = 'object'
           AND command_integer(value->'result'->'manifest')
           AND command_integer(value->'result'->'digest')
           AND command_integer(value->'result'->'schema');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded', 'FinalizationFailed');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'reason' IN ('NoReason', 'WorkFailed', 'ReworkBudgetExhausted',
             'ExecutionPolicyDenied', 'TicketConfigIncompatible',
             'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported',
             'RequiredCapabilityUnavailable');
       END IF;
       IF tag <> 'ReleaseTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR NOT command_integer(value->'workFanout')
          OR COALESCE(value->>'finalizer', 'ManagedFinalizer') <> 'ManagedFinalizer' THEN
         RETURN false;
       END IF;
       IF (SELECT count(*) FROM jsonb_array_elements(value->'deps')) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(value->'deps') AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'deps') AS elements(element) LOOP
         IF NOT command_integer(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'prog') AS elements(element) LOOP
         IF jsonb_typeof(item) <> 'object' OR NOT command_integer(item->'fanout')
            OR COALESCE(item->>'combinator', 'UnanimousPass') <> 'UnanimousPass' THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
    `CREATE OR REPLACE FUNCTION public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) RETURNS TABLE(result text, ticket bigint, authoring_version bigint, state text)
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
       INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,landing,target,in_repository);
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,minted,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$;`,
    `CREATE OR REPLACE FUNCTION public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; landing text; target text;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',current.authoring_version,current.state; RETURN; END IF;
       landing := coalesce(in_finalization_mode,
     (SELECT b.landing_mode FROM project_repository b
       WHERE b.tenant=in_tenant AND b.project=in_project
         AND b.repository=in_repository),
     'Push');
       target := in_finalization_target;
       IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',current.authoring_version,current.state; RETURN;
       END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,landing,target,in_repository)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,repository=EXCLUDED.repository,
           finalization_mode=EXCLUDED.finalization_mode,finalization_target=EXCLUDED.finalization_target;
       DELETE FROM draft_brief_link
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,in_ticket,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       DELETE FROM draft_brief_check
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,in_ticket,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       UPDATE draft SET authoring_version=next_version,configuration_revision=in_configuration
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,'Draft'::text;
     END $$;`,
    `ALTER TABLE public.ticket_projection
       DROP CONSTRAINT ticket_projection_reason_is_known,
       ADD CONSTRAINT ticket_projection_reason_is_known CHECK ((reason = ANY (ARRAY['NoReason'::text, 'WorkFailed'::text, 'ReworkBudgetExhausted'::text, 'ExecutionPolicyDenied'::text, 'TicketConfigIncompatible'::text, 'ExecutionProfileUnavailable'::text, 'RuntimeVersionUnsupported'::text, 'RequiredCapabilityUnavailable'::text])))`,
    `ALTER TABLE public.native_action
       DROP CONSTRAINT native_action_reason_check,
       ADD CONSTRAINT native_action_reason_check CHECK (((reason = ANY (ARRAY['NoReason'::text, 'WorkFailed'::text, 'ReworkBudgetExhausted'::text, 'ExecutionPolicyDenied'::text, 'TicketConfigIncompatible'::text, 'ExecutionProfileUnavailable'::text, 'RuntimeVersionUnsupported'::text, 'RequiredCapabilityUnavailable'::text])) OR ((state <> 'Open'::text) AND (reason = 'DependencyRevoked'::text))))`,
    `ALTER TABLE public.draft_brief
       DROP CONSTRAINT draft_brief_finalization_mode_is_known,
       ADD CONSTRAINT draft_brief_finalization_mode_is_known CHECK ((finalization_mode = ANY (ARRAY['Push'::text, 'PullRequest'::text, 'PullRequestMerge'::text, 'None'::text])))`,
    `ALTER TABLE public.project_repository
       DROP CONSTRAINT project_repository_landing_mode_is_known,
       ADD CONSTRAINT project_repository_landing_mode_is_known CHECK ((landing_mode = ANY (ARRAY['Push'::text, 'PullRequest'::text, 'PullRequestMerge'::text, 'None'::text])))`,
    `ALTER TABLE public.dispatch_candidate
       DROP COLUMN finalizer`,
    `UPDATE public.dispatch_candidate
        SET program = '[' || coalesce((
              SELECT string_agg(format('{"fanout":%s}', stage->>'fanout'), ',' ORDER BY position)
                FROM jsonb_array_elements(program::jsonb)
                  WITH ORDINALITY AS stages(stage, position)), '') || ']'`,
    `UPDATE public.draft_brief
        SET finalization_mode = 'None'
      WHERE finalization_mode IS NULL`,
  ],
};
