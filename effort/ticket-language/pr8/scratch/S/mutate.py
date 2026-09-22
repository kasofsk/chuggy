import sys
P='/home/geoff/claude/chuggy-wt/released-schema/src/adapters/postgres/schema/migrations/013-released-ticket.ts'
I='/home/geoff/claude/chuggy-wt/released-schema/src/adapters/postgres/schema/migrations/index.ts'
which=sys.argv[1]
s=open(P).read(); idx=open(I).read()
def sub(old,new,count=1):
    global s
    assert old in s, which
    s=s.replace(old,new,count)
M={
 'unregistered': lambda: None,
 'guard_deleted': lambda: sub("""    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,\n""",""),
 'guard_remedy': lambda: sub("empty the journal with deploy/rig/wipe-tickets.sql first","empty the journal first"),
 'old_spelling_admitted': lambda: sub("          OR value ? 'deps' OR value ? 'prog'\n",""),
 'content_unweighed': lambda: sub("OR NOT ${referencePredicate}(value->'${releasedContentField}')","OR NOT command_integer(value->'${releasedContentField}')"),
 'work_definition_unweighed': lambda: sub("          OR NOT ${taskDefinitionPredicate}(value->'${releasedWorkField}')\n",""),
 'evaluator_definition_unweighed': lambda: sub("              OR NOT ${taskDefinitionPredicate}(entry->'${evaluatorTaskField}')",""),
 'stage_not_positional': lambda: sub("         IF (item->>'${stageKeyField}')::bigint <> place","         IF (item->>'${stageKeyField}')::bigint < 1"),
 'evaluators_not_distinct': lambda: sub("""         IF (SELECT count(DISTINCT element->'${evaluatorKeyField}')
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element))
            <> jsonb_array_length(item->'${stageEvaluatorsField}') THEN
           RETURN false;
         END IF;\n""",""),
 'dispatch_unweighed': lambda: sub("""       IF tag IN ('Revoke', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'Dispatch' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND ${referencePredicate}(value->'ticket')
           AND ${referencePredicate}(value->'${dispatchSourceField}');
       END IF;""","""       IF tag IN ('Revoke', 'Dispatch', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;"""),
 'dispatch_source_unfloored': lambda: sub("AND ${referencePredicate}(value->'${dispatchSourceField}')","AND command_integer(value->'${dispatchSourceField}')"),
 'obligation_any_task': lambda: sub("            OR obligation->'${obligationTaskField}' IS DISTINCT FROM task\n",""),
 'accepted_source_unweighed': lambda: sub("           RETURN ${referencePredicate}(report->'value'->'${acceptedSourceField}');","           RETURN true;"),
 'produced_not_an_object': lambda: sub("            OR jsonb_typeof(produced) <> 'object'\n",""),
 'result_reference_unweighed': lambda: sub("            OR jsonb_typeof(produced->'${resultReferenceField}') <> 'object'\n            OR NOT ${referencePredicate}(produced->'${resultReferenceField}'->'manifest')\n",""),
 'obligation_not_an_object': lambda: sub("            OR jsonb_typeof(obligation) <> 'object'\n",""),
 'obligation_context_unweighed': lambda: sub("            OR NOT ${referencePredicate}(obligation->'${obligationContextField}')\n",""),
 'definition_unbounded': lambda: sub("    CONSTRAINT ticket_definition_material_is_bounded CHECK (((jsonb_typeof(definition) = 'object'::text) AND (length((definition)::text) <= ${String(ticketDefinitionCharsMax)}))),\n",""),
 'definition_digest_unnamed': lambda: sub("    CONSTRAINT ticket_definition_digest_is_named CHECK (((length(digest) >= 1) AND (length(digest) <= 256))),\n",""),
 'definition_ticket_unfloored': lambda: sub("    CONSTRAINT ticket_definition_ticket_is_positive CHECK ((ticket >= 1))\n",""),
 'source_not_whole': lambda: sub("    CONSTRAINT ticket_source_names_a_commit_with_its_repository CHECK (((repository IS NULL) = (commit IS NULL))),\n",""),
 'source_unfloored': lambda: sub("    CONSTRAINT ticket_source_counters_are_positive CHECK (((ticket >= 1) AND (source >= 1))),\n",""),
 'commit_not_hex': lambda: sub("    CONSTRAINT ticket_source_commit_is_hex CHECK ((commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'::text)),\n",""),
 'work_definition_misread': lambda: sub("           definition := released->'${releasedWorkField}';","           definition := released->'workload';"),
 'evaluator_key_ignored': lambda: sub("              AND (evaluators.evaluator->>'${evaluatorKeyField}')::bigint = bound.evaluator;",";"),
 'context_is_not_the_cycle': lambda: sub("           '${obligationContextField}', bound.cycle);","           '${obligationContextField}', bound.ticket);"),
 'source_folded_from_the_result': lambda: sub("             accepted := result_digest_fold(observed.commit);","             accepted := result_digest_fold(bound.digest);"),
 'source_row_unwritten': lambda: sub("""             INSERT INTO ticket_source
               (tenant, project, ticket, source, repository, commit, ref)
             VALUES (in_tenant, in_project, bound.ticket, accepted,
               observed.repository, observed.commit, observed.ref)
             ON CONFLICT (tenant, project, ticket, source) DO NOTHING;\n""",""),
 'unsourced_pass_admitted': lambda: sub("""           ELSIF EXISTS (SELECT FROM ticket_source t
                          WHERE t.tenant = in_tenant AND t.project = in_project
                            AND t.ticket = bound.ticket AND t.repository IS NOT NULL) THEN
             RETURN QUERY SELECT '${sourceUnrecordedResult}'::text, NULL::text, NULL::bigint;
             RETURN;\n""",""),
 'index_at_the_old_key': lambda: sub("-> '${releasedIdField}'::text)","-> 'ticket'::text)"),
 'authority_keeps_the_tag': lambda: sub("""    WHEN 'TaskDone'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'FinalizationResult'::text""","""    WHEN 'TaskDone'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'ExecutionBlocked'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'FinalizationResult'::text"""),
 'entry_unreadable_by_the_door': lambda: sub("    `GRANT SELECT(entry) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,\n",""),
 'scheduler_reads_no_source': lambda: sub("GRANT SELECT ON TABLE public.ticket_source TO ${schedulerRole};",""),
 'predicate_unowned': lambda: sub("    `ALTER FUNCTION public.${referencePredicate}(value jsonb) OWNER TO ${boundaryOwnerRole}`,\n",""),
 'api_reads_no_source': lambda: sub("    `GRANT SELECT(commit) ON TABLE public.ticket_source TO ${apiRole}`,\n",""),
}
if which=='unregistered':
    idx=idx.replace("  migration013,\n","")
    open(I,'w').write(idx)
else:
    M[which]()
    open(P,'w').write(s)
