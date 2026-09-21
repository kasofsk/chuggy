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
 * does, so a row that is not a document is not a cast failure.
 *
 * THE CASCADE'S OWN ROWS ARE ADMITTED, AND THE GUARD LOOKS FOR NONE OF THEM. A
 * revoke that transitioned the tickets behind it names no removed value: it is
 * a plain `Revoke` whose record carries the dependents' transitions, and
 * `src/actor/decisionSemantics.ts` re-derives it at the semantics that wrote
 * it, parking each dependent at the reason that survived. Refusing those rows
 * would turn a stored history this image replays into one it will not load.
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
 * THE ONE DOOR A FINALIZATION CONCLUDES THROUGH ADMITS A SUCCESS THAT
 * CONCLUDED ON NO ATTEMPT, AND ONLY FOR A BRIEF THAT LANDS NOTHING. Every
 * other conclusion is evidence read off rows — a prepared attempt, a concluded
 * permit, a promoted ref — and a landing that lands nothing prepares none of
 * them, so the arm is the brief's own `finalization_mode` read through the
 * request's ticket. It is the narrowest widening that admits the new
 * conclusion: the attempt the submission names must be absent as well as the
 * attempt row, `IS NOT DISTINCT FROM` keeps every comparison two-valued so an
 * unknown landing refuses rather than falls through, and no other outcome, kind
 * or landing reaches it. The command the door builds omits the key rather than
 * carrying it null, and `ticket_command_is_valid` admits it absent for the same
 * reason.
 *
 * A BRIEF THAT RECORDED NO LANDING RECORDED THE ONE THAT LANDS NOTHING, AND IS
 * REWRITTEN TO SAY SO. The two functions above are the only writers of
 * `draft_brief`, and every branch but the removed arm resolved a landing:
 * `coalesce` of the brief's mode, the repository's, and `Push` is never null.
 * So a null `finalization_mode` is exactly a draft whose authoring named the
 * finalizer that lands nothing, which is what `None` is the name for now.
 *
 * THE MAILBOX BOUND IS NARROWED BECAUSE A CANDIDATE NOW WEIGHS LESS. The
 * widest observation one lead turn may be given is a sum over the parts, and a
 * dispatch candidate that no longer carries a finalizer or a stage combinator
 * shrinks it; the row that must hold one is re-rendered at the new figure, and
 * the budget seeded from it re-seeded, exactly as 004 did when it last moved.
 * A narrowed length check revalidates stored rows, so the guard above holds a
 * `session_turn` arm at the new figure for the same reason 004 held one at its.
 *
 * A LANDING THAT LANDS NOTHING NAMES NO REFERENCE, AND THE RELATION IS WHAT
 * SAYS SO. The reader brands a stored landing through the variant its mode
 * selects, and the `None` variant has no target, so a row holding both is a
 * row the brief read throws on. That narrowing needs no arm in the guard
 * either: the check it replaces admitted no `None` at all, so the only rows at
 * that mode are the ones the rewrite above just made, and a row whose mode was
 * null held no target for `draft_brief_finalization_target_needs_a_mode` to
 * admit it.
 */

/**
 * What this migration renders `sessionTurnInputCharsMax` as, in the mailbox
 * bound it re-renders and in the observation budget it re-seeds.
 */
export const leadObservationTokensPerDecisionAt005 = 17_363_763;

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
           SELECT 'session_turn'
            WHERE EXISTS (SELECT FROM public.session_turn
                           WHERE length(input) > 17363763)
           UNION ALL
           SELECT 'journal_entry'
            WHERE EXISTS (
              SELECT FROM public.journal_entry AS stored
              CROSS JOIN LATERAL (SELECT CASE WHEN stored.entry IS JSON OBJECT
                                              THEN stored.entry::jsonb END AS document) AS read
               WHERE read.document->'event'->'value'->>'finalizer' = 'NoFinalizer'
                  OR read.document->'event'->'value'->'prog'
                     @> '[{"combinator":"AnyPass"}]'::jsonb
                  OR read.document->'event'->'value'->>'reason' = 'DependencyRevoked')
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
    `CREATE OR REPLACE FUNCTION public.ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
       BEGIN
         IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
           RETURN false;
         END IF;
         IF command->>'command' = 'SubmitFinalizationResult' THEN
           RETURN jsonb_typeof(command->'version') = 'number'
             AND command->>'version' = '1'
             AND jsonb_typeof(command->'request') = 'string'
             AND length(command->>'request') BETWEEN 1 AND 256
             AND (command->'attempt' IS NULL
               OR (jsonb_typeof(command->'attempt') = 'string'
                 AND length(command->>'attempt') BETWEEN 1 AND 256))
             AND command_integer(command->'requestGeneration')
             AND (command->>'requestGeneration')::numeric >= 1
             AND jsonb_typeof(command->'recoveryEpoch') = 'string'
             AND length(command->>'recoveryEpoch') BETWEEN 1 AND 256
             AND command->>'outcome' IN ('FinalizationSucceeded', 'FinalizationFailed');
         END IF;
         RETURN public_ticket_command_is_valid(command)
           AND (command->>'command' <> 'Decide'
             OR command->'event'->>'type' NOT IN ('FinalizationResult'));
       END $$;`,
    `CREATE OR REPLACE FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       IF in_outcome NOT IN ('FinalizationSucceeded', 'FinalizationFailed') THEN
         RAISE EXCEPTION 'finalization outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       scoped_digest := encode(sha256(convert_to('finalization:' || in_request, 'UTF8')), 'hex');
       SELECT f.ticket, f.state, f.request_generation, f.recovery_epoch, f.kind,
              a.attempt, a.outcome AS attempt_outcome, a.failure_kind,
              p.state AS permit_state, r.verdict, w.finalization_mode AS landing
         INTO bound
         FROM finalization_request f
         LEFT JOIN draft_brief w
           ON w.tenant = f.tenant AND w.project = f.project AND w.ticket = f.ticket
         LEFT JOIN finalization_attempt a
           ON a.tenant = f.tenant AND a.project = f.project
              AND a.request = f.request AND a.attempt = in_attempt
         LEFT JOIN commit_permit p
           ON p.tenant = a.tenant AND p.project = a.project AND p.attempt = a.attempt
         LEFT JOIN finalization_reconciliation r
           ON r.tenant = p.tenant AND r.project = p.project AND r.permit = p.permit
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownRequest'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT o.operation INTO settled FROM operation o
        WHERE o.tenant = in_tenant AND o.project = in_project
          AND o.authority_kind = 'Finalizer' AND o.key_digest = scoped_digest;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, settled,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = settled);
         RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.state NOT IN ('Open', 'Registered')
          OR bound.request_generation <> in_request_generation
          OR bound.recovery_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR (bound.attempt IS NULL
            AND NOT (in_attempt IS NULL
              AND bound.landing IS NOT DISTINCT FROM 'None'))
          OR NOT (
            (in_outcome = 'FinalizationFailed'
              AND bound.kind = 'RunFinalizer'
              AND bound.attempt_outcome = 'Failed'
              AND bound.failure_kind IS NOT DISTINCT FROM in_failure_kind)
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND bound.attempt_outcome = 'Prepared'
              AND bound.permit_state IS NOT DISTINCT FROM 'Concluded'
              AND bound.verdict IS NOT DISTINCT FROM 'Promoted')
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND in_attempt IS NULL
              AND bound.landing IS NOT DISTINCT FROM 'None'))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       command_value := jsonb_build_object('version', 1,
         'command', 'SubmitFinalizationResult', 'request', in_request,
         'requestGeneration', in_request_generation,
         'recoveryEpoch', in_recovery_epoch, 'outcome', in_outcome)
         || CASE WHEN in_attempt IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('attempt', in_attempt) END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the finalization result this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, 'Finalizer',
          in_authority_subject, 'CorrectnessReducing', 'finalizer-v1',
          scoped_digest,
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, 'FinalizationResult');
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
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
    `ALTER TABLE public.session_turn
       DROP CONSTRAINT session_turn_text_is_bounded,
       ADD CONSTRAINT session_turn_text_is_bounded CHECK ((((length(input) >= 1) AND (length(input) <= 17363763)) AND (COALESCE(length(result), 0) <= 65536)))`,
    `UPDATE public.selector_runtime_settings
        SET controls = replace(controls, '"tokensPerDecision":17403663', '"tokensPerDecision":17363763')`,
    `UPDATE public.selector_runtime_settings_history
        SET controls = replace(controls, '"tokensPerDecision":17403663', '"tokensPerDecision":17363763')`,
    `ALTER TABLE public.draft_brief
       ADD CONSTRAINT draft_brief_finalization_none_names_no_reference CHECK (((finalization_mode <> 'None'::text) OR (finalization_target IS NULL)))`,
  ],
};
