export const baselineFunctions: readonly string[] = [
  `CREATE FUNCTION accept_dispatch_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) RETURNS TABLE(result text, operation text, ordinal bigint, state text, authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
       SELECT * INTO accepted FROM accept_operation(
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
     END $_$;


ALTER FUNCTION public.accept_dispatch_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION accept_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) RETURNS TABLE(result text, operation text, ordinal bigint, state text, authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
          AND command_value->>'resolution' IN ('Resume', 'Revoke', 'RetryHandoff', 'AbandonHandoff', 'Approve', 'Decline') THEN
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
          (command_tag = 'ResolveNativeAction' AND action_resolution = 'Revoke') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', 'Dispatch', 'ResumeTicket') OR
             (command_tag = 'ResolveNativeAction' AND action_resolution IN ('Resume', 'RetryHandoff', 'AbandonHandoff', 'Approve', 'Decline')) THEN
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
     END $_$;


ALTER FUNCTION public.accept_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION advance_selector_attempt(in_attempt text, in_transition text, in_evidence text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           IF in_transition='Running' THEN
             UPDATE selector_attempt SET state='Running',updated_at=now()
               WHERE attempt=in_attempt AND state='Starting';
           ELSIF in_transition='Completed' THEN
             UPDATE selector_attempt SET state='Completed',terminal_evidence=in_evidence,updated_at=now()
               WHERE attempt=in_attempt AND state='Running'
                 AND EXISTS (SELECT 1 FROM selector_observation WHERE attempt=in_attempt);
             IF FOUND THEN
               UPDATE selector_decision_permit SET released_at=now()
                 WHERE attempt=in_attempt AND released_at IS NULL;
             END IF;
           ELSIF in_transition='Quarantined' THEN
             UPDATE selector_attempt SET state='Quarantined',updated_at=now()
               WHERE attempt=in_attempt AND state IN ('Starting','Running','Terminating','Quarantined');
           ELSIF in_transition='Terminated' THEN
             UPDATE selector_attempt SET state='Terminated',terminal_evidence=in_evidence,updated_at=now()
               WHERE attempt=in_attempt AND state IN ('Starting','Running','Terminating','Quarantined');
             IF FOUND THEN
               UPDATE selector_decision_permit SET released_at=now()
                 WHERE attempt=in_attempt AND released_at IS NULL;
             END IF;
           ELSE RAISE EXCEPTION 'invalid selector attempt transition';
           END IF;
           RETURN FOUND;
         END $$;


ALTER FUNCTION public.advance_selector_attempt(in_attempt text, in_transition text, in_evidence text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION advance_selector_delivery(in_decision text, in_ticket bigint, in_transition text, in_outcome text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF in_transition='Submitted' THEN
         UPDATE selector_proposal_delivery SET state='Submitted',reconcile_at=now()
           WHERE selector_decision=in_decision AND ticket=in_ticket
             AND state='Pending';
       ELSIF in_transition='Terminal' THEN
         UPDATE selector_proposal_delivery SET state='Terminal',outcome=in_outcome,
           reconcile_at=NULL
           WHERE selector_decision=in_decision AND ticket=in_ticket
             AND state IN ('Pending','Submitted');
       ELSE RAISE EXCEPTION 'invalid selector delivery transition';
       END IF;
       RETURN FOUND;
     END $$;


ALTER FUNCTION public.advance_selector_delivery(in_decision text, in_ticket bigint, in_transition text, in_outcome text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION advance_thread_wake_cursor(in_sequence bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       UPDATE thread_wake_cursor
          SET sequence=greatest(sequence,coalesce(in_sequence,0))
        WHERE singleton
        RETURNING sequence
     $$;


ALTER FUNCTION public.advance_thread_wake_cursor(in_sequence bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION agent_session_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
     END $$;`,
  `CREATE FUNCTION allocate_selector_attempt(in_attempt text, in_tenant text, in_project text, concurrent_limit integer, rate_limit integer, decision_milliseconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           IF length(in_attempt) NOT BETWEEN 1 AND 256
              OR concurrent_limit NOT BETWEEN 1 AND 100
              OR rate_limit NOT BETWEEN 1 AND 100000
              OR decision_milliseconds NOT BETWEEN 1 AND 3600000 THEN
             RAISE EXCEPTION 'invalid selector attempt allocation';
           END IF;
           PERFORM pg_advisory_xact_lock(1936028274);
           IF EXISTS (SELECT 1 FROM selector_attempt WHERE attempt=in_attempt) THEN
             RETURN false;
           END IF;
           IF (SELECT count(*) FROM selector_decision_permit WHERE released_at IS NULL) >= concurrent_limit
              OR (SELECT count(*) FROM selector_decision_permit
                    WHERE acquired_at >= now()-interval '1 minute') >= rate_limit THEN
             RETURN false;
           END IF;
           INSERT INTO selector_attempt (attempt,tenant,project,state,lease_expires_at)
             VALUES (in_attempt,in_tenant,in_project,'Starting',
               now()+greatest(decision_milliseconds*2,decision_milliseconds+300000)*interval '1 millisecond');
           INSERT INTO selector_decision_permit (attempt) VALUES (in_attempt);
           RETURN true;
         END $$;


ALTER FUNCTION public.allocate_selector_attempt(in_attempt text, in_tenant text, in_project text, concurrent_limit integer, rate_limit integer, decision_milliseconds integer) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION answer_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[]) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_result IS NULL OR length(in_result)>65536
          OR (in_batch_first IS NULL)<>(in_batch_last IS NULL)
          OR coalesce(in_batch_first,1)>coalesce(in_batch_last,1)
          OR coalesce(in_batch_first,1) NOT BETWEEN 1 AND 65536
          OR coalesce(in_batch_last,1) NOT BETWEEN 1 AND 65536
          OR array_position(in_tools,NULL) IS NOT NULL
          OR EXISTS(SELECT 1 FROM unnest(coalesce(in_tools,'{}'::text[])) named
                     WHERE length(named) NOT BETWEEN 1
                           AND 128) THEN
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
     END $$;


ALTER FUNCTION public.answer_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[]) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION append_project_change(in_tenant text, in_project text, in_kind text, in_resource text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       RETURN append_project_change(
         in_tenant,in_project,in_kind,in_resource,(CASE in_kind
    WHEN 'Draft' THEN
      (SELECT 'DraftDeleted' FROM draft d
        WHERE d.tenant=in_tenant AND d.project=in_project
          AND d.ticket::text=in_resource AND d.state='Deleted')
    WHEN 'Ticket' THEN
      (SELECT CASE p.phase WHEN 'Escalated' THEN 'TicketEscalated'
                           WHEN 'Done' THEN 'TicketCompleted'
                           WHEN 'Abandoned' THEN 'TicketAbandoned'
                           WHEN 'Revoked' THEN 'TicketAbandoned' END
         FROM ticket_projection p
        WHERE p.tenant=in_tenant AND p.project=in_project
          AND p.ticket::text=in_resource)
  END)::text);
     END $$;


ALTER FUNCTION public.append_project_change(in_tenant text, in_project text, in_kind text, in_resource text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION append_project_change(in_tenant text, in_project text, in_kind text, in_resource text, in_wake_reason text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE appended bigint;
     BEGIN
       INSERT INTO project_change (tenant,project,kind,resource,wake_reason)
       VALUES (in_tenant,in_project,in_kind,in_resource,in_wake_reason)
       RETURNING sequence INTO appended;
       PERFORM pg_notify('chuggy_project_change','');
       RETURN appended;
     END $$;


ALTER FUNCTION public.append_project_change(in_tenant text, in_project text, in_kind text, in_resource text, in_wake_reason text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION authenticate_session_bearer(in_secret_digest text) RETURNS TABLE(tenant text, project text, session text, kind text, principal text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,s.kind,s.principal
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.state IN ('Placing','Running') AND s.state='Open'
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
     $$;


ALTER FUNCTION public.authenticate_session_bearer(in_secret_digest text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION bind_project_repository(in_tenant text, in_project text, in_repository text, in_recovery_epoch text, in_operation text, in_authority_kind text, in_authority_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE existing project_repository_bind_operation%ROWTYPE;
           holder project_repository%ROWTYPE;
           current_epoch text;
           accepted text;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended('operation:'||in_operation,0));
     SELECT * INTO existing FROM project_repository_bind_operation
      WHERE operation=in_operation;
     IF FOUND THEN
       IF existing.tenant=in_tenant AND existing.project=in_project
          AND existing.repository=in_repository
          AND existing.recovery_epoch=in_recovery_epoch
          AND existing.authority_kind=in_authority_kind
          AND existing.authority_subject=in_authority_subject
         THEN RETURN 'AlreadyBound'; END IF;
       RETURN 'OperationConflict';
     END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended('repository:'||in_repository,0));
     PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='foreign_key_violation',
       MESSAGE='repository binding project is absent'; END IF;
     SELECT epoch INTO current_epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1;
     IF current_epoch IS DISTINCT FROM in_recovery_epoch
       THEN RETURN 'RecoveryEpochMismatch'; END IF;
     SELECT * INTO holder FROM project_repository WHERE repository=in_repository;
     IF FOUND THEN
       IF holder.tenant<>in_tenant OR holder.project<>in_project
         THEN RETURN 'RepositoryBoundElsewhere'; END IF;
       IF holder.retired_at IS NULL THEN
         accepted := 'AlreadyBound';
       ELSE
         UPDATE project_repository b SET retired_at=NULL
          WHERE b.tenant=in_tenant AND b.project=in_project
            AND b.repository=in_repository;
         accepted := 'Bound';
       END IF;
     ELSE
       INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
         VALUES(in_tenant,in_project,in_repository,in_recovery_epoch);
       accepted := 'Bound';
     END IF;
     INSERT INTO project_repository_bind_operation
       (operation,tenant,project,repository,recovery_epoch,
        authority_kind,authority_subject,outcome)
       VALUES(in_operation,in_tenant,in_project,in_repository,in_recovery_epoch,
              in_authority_kind,in_authority_subject,accepted);
     RETURN accepted;
   END $$;


ALTER FUNCTION public.bind_project_repository(in_tenant text, in_project text, in_repository text, in_recovery_epoch text, in_operation text, in_authority_kind text, in_authority_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION bind_session_reference(in_secret_digest text, in_generation bigint, in_reference text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; held text;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_reference IS NULL
          OR length(in_reference) NOT BETWEEN 1 AND 256 THEN
         RETURN 'Conflict';
       END IF;
       SELECT s.agent_reference INTO held FROM agent_session s
        WHERE s.tenant=bound.tenant AND project=bound.project AND session=bound.session FOR UPDATE;
       IF held IS NULL THEN
         UPDATE agent_session s SET agent_reference=in_reference WHERE s.tenant=bound.tenant AND project=bound.project AND session=bound.session;
         RETURN 'Bound';
       END IF;
       RETURN CASE WHEN held=in_reference THEN 'AlreadyBound' ELSE 'Conflict' END;
     END $$;


ALTER FUNCTION public.bind_session_reference(in_secret_digest text, in_generation bigint, in_reference text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION cancel_pending_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE locked_state text;
     BEGIN
       SELECT state INTO locked_state FROM decision_input
        WHERE tenant=in_tenant AND project=in_project AND input_kind='Operation' AND input_id=in_operation FOR UPDATE;
       IF NOT FOUND THEN RETURN NULL; END IF;
       IF locked_state <> 'Pending' THEN RETURN CASE locked_state WHEN 'Journaled' THEN 'Succeeded' ELSE locked_state END; END IF;
       UPDATE decision_input SET state='Cancelled', terminal_at=now(),
         settled_authority_kind=in_authority_kind, settled_authority_subject=in_authority_subject
        WHERE tenant=in_tenant AND project=in_project AND input_kind='Operation' AND input_id=in_operation;
       PERFORM publish_project_notification(in_tenant,in_project,'Operation',in_operation,NULL,NULL);
       RETURN locked_state;
     END $$;


ALTER FUNCTION public.cancel_pending_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION claim_selector_attempt_reconciliation(attempt_limit integer) RETURNS TABLE(attempt text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           IF attempt_limit NOT BETWEEN 1 AND 100 THEN
             RAISE EXCEPTION 'invalid selector attempt reconciliation bound';
           END IF;
           PERFORM pg_advisory_xact_lock(1936028274);
           UPDATE selector_attempt SET state='Quarantined',updated_at=now()
             WHERE state IN ('Starting','Running') AND lease_expires_at<=now();
           RETURN QUERY SELECT candidate.attempt FROM selector_attempt candidate
             WHERE candidate.state='Quarantined'
             ORDER BY candidate.updated_at,candidate.attempt LIMIT attempt_limit;
         END $$;


ALTER FUNCTION public.claim_selector_attempt_reconciliation(attempt_limit integer) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION claim_selector_deliveries(delivery_limit integer) RETURNS TABLE(selector_decision text, ticket bigint, tenant text, project text, operation text, command text, attempts bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       UPDATE selector_proposal_delivery delivery
         SET attempts=delivery.attempts+1,retry_at=now()+interval '30 seconds'
       WHERE (delivery.selector_decision,delivery.ticket) IN (
         SELECT candidate.selector_decision,candidate.ticket
           FROM selector_proposal_delivery candidate
         WHERE candidate.state='Pending' AND candidate.retry_at<=now()
         ORDER BY candidate.retry_at,candidate.selector_decision,candidate.ticket
         LIMIT CASE WHEN delivery_limit BETWEEN 1 AND 100 THEN delivery_limit ELSE 0 END
         FOR UPDATE SKIP LOCKED)
       RETURNING delivery.selector_decision,delivery.ticket,delivery.tenant,
         delivery.project,delivery.operation,delivery.command,delivery.attempts
     $$;


ALTER FUNCTION public.claim_selector_deliveries(delivery_limit integer) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION claim_selector_proposal_reconciliation(delivery_limit integer) RETURNS TABLE(selector_decision text, ticket bigint, tenant text, project text, operation text, command text, attempts bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       UPDATE selector_proposal_delivery delivery
         SET reconciliation_attempts=delivery.reconciliation_attempts+1,
             reconcile_at=now()+interval '30 seconds'
       WHERE (delivery.selector_decision,delivery.ticket) IN (
         SELECT candidate.selector_decision,candidate.ticket
           FROM selector_proposal_delivery candidate
         WHERE candidate.state='Submitted'
           AND coalesce(candidate.reconcile_at,'-infinity'::timestamptz)<=now()
         ORDER BY coalesce(candidate.reconcile_at,'-infinity'::timestamptz),
           candidate.selector_decision,candidate.ticket
         LIMIT CASE WHEN delivery_limit BETWEEN 1 AND 100 THEN delivery_limit ELSE 0 END
         FOR UPDATE SKIP LOCKED)
       RETURNING delivery.selector_decision,delivery.ticket,delivery.tenant,
         delivery.project,delivery.operation,delivery.command,
         delivery.reconciliation_attempts AS attempts
     $$;


ALTER FUNCTION public.claim_selector_proposal_reconciliation(delivery_limit integer) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION claim_session_turn(in_secret_digest text, in_generation bigint) RETURNS TABLE(turn text, ordinal bigint, input_kind text, input text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; standing record; picked record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN; END IF;
       SELECT t.turn,t.ordinal,t.input_kind,t.input,t.attempt INTO standing
         FROM session_turn t WHERE t.tenant=bound.tenant AND project=bound.project AND session=bound.session AND t.state='Claimed' FOR UPDATE;
       IF FOUND THEN
         IF standing.attempt=bound.attempt THEN
           RETURN QUERY SELECT standing.turn,standing.ordinal,
                               standing.input_kind,standing.input;
         END IF;
         RETURN;
       END IF;
       SELECT t.turn,t.ordinal,t.input_kind,t.input INTO picked FROM session_turn t
        WHERE t.tenant=bound.tenant AND project=bound.project AND session=bound.session AND t.state='Queued'
        ORDER BY t.ordinal LIMIT 1 FOR UPDATE;
       IF NOT FOUND THEN RETURN; END IF;
       UPDATE session_turn t
          SET state='Claimed',attempt=bound.attempt,claim_generation=in_generation,
              claimed_at=now()
        WHERE t.tenant=bound.tenant AND project=bound.project AND session=bound.session AND t.turn=picked.turn;
       UPDATE session_attempt a SET idle_since=NULL WHERE a.attempt=bound.attempt;
       RETURN QUERY SELECT picked.turn,picked.ordinal,picked.input_kind,picked.input;
     END $$;


ALTER FUNCTION public.claim_session_turn(in_secret_digest text, in_generation bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION close_agent_session(in_tenant text, in_project text, in_session text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text;
     BEGIN
       SELECT s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND OR held<>'Open' THEN RETURN false; END IF;
       UPDATE session_turn t
          SET state='Abandoned',failure='SessionClosed',ended_at=now(),
              attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.state IN ('Queued','Claimed');
       UPDATE agent_session s SET state='Closed',closed_at=now()
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session;
       RETURN true;
     END $$;


ALTER FUNCTION public.close_agent_session(in_tenant text, in_project text, in_session text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION close_member_thread(in_tenant text, in_project text, in_session text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text;
     BEGIN
       SELECT s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoThread'; END IF;
       IF held<>'Open' THEN RETURN 'AlreadyClosed'; END IF;
       PERFORM close_agent_session(in_tenant,in_project,in_session);
       RETURN 'Closed';
     END $$;


ALTER FUNCTION public.close_member_thread(in_tenant text, in_project text, in_session text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION command_integer(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
     BEGIN
       IF value IS NULL OR jsonb_typeof(value) <> 'number'
          OR value::text !~ '^-?(0|[1-9][0-9]*)$' THEN
         RETURN false;
       END IF;
       RETURN value::text::numeric BETWEEN -9007199254740991 AND 9007199254740991;
     EXCEPTION WHEN numeric_value_out_of_range THEN
       RETURN false;
     END $_$;


ALTER FUNCTION public.command_integer(value jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION commit_permit_concludes_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF OLD.state = 'Concluded' THEN
         RAISE EXCEPTION 'permit % is already concluded, and a permit is spent once', OLD.permit
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.permit, NEW.attempt, NEW.recovery_epoch,
           NEW.lifecycle_generation)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.permit, OLD.attempt, OLD.recovery_epoch,
           OLD.lifecycle_generation) THEN
         RAISE EXCEPTION 'permit % would change the identity, epoch or generation it was granted under',
           OLD.permit USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.commit_permit_concludes_once() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION create_configuration_revision(in_tenant text, in_project text, in_revision text, in_parent text, in_canonical text, in_digest text, in_kind text, in_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE existing configuration_revision%ROWTYPE; inserted boolean := false;
     BEGIN
       BEGIN
         INSERT INTO configuration_revision
           (tenant,project,revision,parent,canonical,digest,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_revision,in_parent,in_canonical,in_digest,in_kind,in_subject)
         ON CONFLICT (tenant,project,revision) DO NOTHING RETURNING true INTO inserted;
       EXCEPTION
         WHEN foreign_key_violation THEN RETURN 'ParentNotFound';
         WHEN unique_violation THEN NULL;
       END;
       IF inserted THEN
         PERFORM publish_project_notification(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
         RETURN 'Created';
       END IF;
       SELECT * INTO existing FROM configuration_revision
        WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
       RETURN CASE WHEN existing.canonical=in_canonical AND existing.digest=in_digest
         AND existing.parent IS NOT DISTINCT FROM in_parent THEN 'AlreadyExists' ELSE 'IdentityConflict' END;
     END $$;


ALTER FUNCTION public.create_configuration_revision(in_tenant text, in_project text, in_revision text, in_parent text, in_canonical text, in_digest text, in_kind text, in_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) RETURNS TABLE(result text, ticket bigint, authoring_version bigint, state text)
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
       IF in_authoring::jsonb->'value'->>'finalizer' = 'NoFinalizer' THEN
         IF in_finalization_mode IS NOT NULL OR in_finalization_target IS NOT NULL THEN
           RAISE EXCEPTION 'a ticket with no finalizer lands nothing'
             USING ERRCODE='check_violation';
         END IF;
       ELSE
         landing := coalesce(in_finalization_mode,
       (SELECT b.landing_mode FROM project_repository b
         WHERE b.tenant=in_tenant AND b.project=in_project
           AND b.repository=in_repository),
       'Push');
         target := in_finalization_target;
         IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
           RETURN QUERY SELECT 'LandingUnbranched',NULL::bigint,NULL::bigint,NULL::text; RETURN;
         END IF;
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
     END $$;


ALTER FUNCTION public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION decision_event_is_valid(event jsonb) RETURNS boolean
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
             'FinalizationBudgetExhausted', 'GasExhausted', 'DependencyRevoked',
             'ExecutionPolicyDenied', 'TicketConfigIncompatible',
             'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported',
             'RequiredCapabilityUnavailable');
       END IF;
       IF tag <> 'ReleaseTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR NOT command_integer(value->'workFanout')
          OR jsonb_typeof(value->'reworkPolicy') <> 'object'
          OR value->'reworkPolicy'->>'type' <> 'BudgetedRework'
          OR NOT command_integer(value->'reworkPolicy'->'value')
          OR value->>'resumePricing' NOT IN ('RetryCharged', 'RetryFree')
          OR value->>'finalizer' NOT IN ('NoFinalizer', 'ManagedFinalizer') THEN
         RETURN false;
       END IF;
       IF NOT (value->'finalizationPricing' = '"DeadlineOnly"'::jsonb OR
          (jsonb_typeof(value->'finalizationPricing') = 'object'
           AND value->'finalizationPricing'->>'type' = 'Budgeted'
           AND command_integer(value->'finalizationPricing'->'value'))) THEN
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
            OR item->>'combinator' NOT IN ('UnanimousPass', 'AnyPass') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;


ALTER FUNCTION public.decision_event_is_valid(event jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION delete_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_kind text, in_subject text) RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         SELECT r.tenant,r.project,r.ticket,r.authoring_version+1,r.configuration_revision,r.authoring,in_kind,in_subject
           FROM draft_revision r WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
            AND r.authoring_version=current.authoring_version;
       UPDATE draft d SET state='Deleted',authoring_version=d.authoring_version+1
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket;
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',in_ticket::text,NULL,current.authoring_version+1);
       RETURN QUERY SELECT 'Deleted',current.authoring_version+1,'Deleted'::text;
     END $$;


ALTER FUNCTION public.delete_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_kind text, in_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION durable_row_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       RAISE EXCEPTION
         '% is written once, and a row that could be edited is not evidence', TG_TABLE_NAME
         USING ERRCODE = 'integrity_constraint_violation';
     END $$;


ALTER FUNCTION public.durable_row_is_written_once() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION end_session_attempt(in_attempt text, in_generation bigint, in_evidence text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.session INTO bound FROM session_attempt a
        WHERE a.attempt=in_attempt FOR UPDATE;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Lost',evidence=in_evidence,ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=in_attempt AND a.generation=in_generation
          AND a.state IN ('Placing','Running') AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1);
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM release_session_attempt_turns(
         bound.tenant,bound.project,bound.session,in_attempt);
       RETURN true;
     END $$;


ALTER FUNCTION public.end_session_attempt(in_attempt text, in_generation bigint, in_evidence text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION enforce_selector_automatic_readiness() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF NEW.dispatch_mode='Automatic' AND NOT EXISTS (
         SELECT 1 FROM selector_runtime_readiness
           WHERE singleton=1 AND production_host) THEN
         RAISE EXCEPTION 'automatic selector requires a production capability host'
           USING ERRCODE='CHG01';
       END IF;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.enforce_selector_automatic_readiness() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION enforce_selector_proposal_attempt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM selector_attempt
             WHERE attempt=NEW.selector_decision AND tenant=NEW.tenant
               AND project=NEW.project AND state='Completed') THEN
             RAISE EXCEPTION 'selector proposal requires a completed durable attempt';
           END IF;
           RETURN NEW;
         END $$;


ALTER FUNCTION public.enforce_selector_proposal_attempt() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION enforce_selector_proposal_initial_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE running_mode text;
     BEGIN
       SELECT mode INTO STRICT running_mode
         FROM selector_runtime_settings WHERE singleton=1 FOR SHARE;
       IF running_mode='Paused' THEN RETURN NULL; END IF;
       NEW.state=CASE selector_project_dispatch_mode(NEW.tenant,NEW.project)
         WHEN 'Automatic' THEN 'Pending' ELSE 'AwaitingApproval' END;
       NEW.outcome=NULL;
       NEW.attempts=0;
       NEW.retry_at=now();
       NEW.reconcile_at=NULL;
       NEW.reconciliation_attempts=0;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.enforce_selector_proposal_initial_state() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION enqueue_lead_turn(in_tenant text, in_project text, in_turn text, in_input text) RETURNS TABLE(enqueued text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; answered record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1);
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held,in_turn,'Observation',in_input);
       RETURN QUERY SELECT answered.enqueued,answered.ordinal;
     END $$;


ALTER FUNCTION public.enqueue_lead_turn(in_tenant text, in_project text, in_turn text, in_input text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION enqueue_session_turn(in_tenant text, in_project text, in_session text, in_turn text, in_input_kind text, in_input text) RETURNS TABLE(enqueued text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; minted bigint;
     BEGIN
       SELECT s.state,s.turn_next INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND THEN
         RAISE EXCEPTION 'there is no session % to enqueue a turn for', in_session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyEnqueued'::text,standing; RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.state='Queued';
       IF queued>=256 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET turn_next=s.turn_next+1
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session RETURNING s.turn_next-1 INTO minted;
       INSERT INTO session_turn (tenant,project,session,turn,ordinal,input_kind,input)
         VALUES(in_tenant,in_project,in_session,in_turn,minted,in_input_kind,in_input);
       RETURN QUERY SELECT 'Enqueued'::text,minted;
     END $$;


ALTER FUNCTION public.enqueue_session_turn(in_tenant text, in_project text, in_session text, in_turn text, in_input_kind text, in_input text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION enqueue_thread_message(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text) RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
       IF held.session<>in_session THEN
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
         in_tenant,in_project,held.session,in_turn,'UserMessage',in_input);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN 'Enqueued'
                             WHEN 'AlreadyEnqueued' THEN 'AlreadyEnqueued'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$;


ALTER FUNCTION public.enqueue_thread_message(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION execution_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM append_project_change(
         NEW.tenant,NEW.project,'Execution',NEW.execution);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.execution_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION execution_attempt_is_fenced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF OLD.state NOT IN ('Placing', 'Running') THEN
           IF OLD.cleanup_completed_at IS NULL AND NEW.cleanup_completed_at IS NOT NULL
              AND (to_jsonb(NEW) - 'cleanup_completed_at')
                  IS NOT DISTINCT FROM (to_jsonb(OLD) - 'cleanup_completed_at') THEN
             RETURN NEW;
           END IF;
           RAISE EXCEPTION 'attempt % is already %, and a finished attempt is written once',
             OLD.attempt, OLD.state USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF (NEW.tenant, NEW.project, NEW.execution, NEW.attempt, NEW.attempt_number,
             NEW.recovery_epoch)
            IS DISTINCT FROM
            (OLD.tenant, OLD.project, OLD.execution, OLD.attempt, OLD.attempt_number,
             OLD.recovery_epoch) THEN
           RAISE EXCEPTION 'attempt % would change the identity or epoch it was issued under',
             OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF NEW.generation < OLD.generation THEN
           RAISE EXCEPTION 'attempt % would move its generation backwards', OLD.attempt
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF OLD.state = 'Running' AND NEW.state = 'Placing' THEN
           RAISE EXCEPTION 'attempt % would return to placement after running', OLD.attempt
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$;`,
  `CREATE FUNCTION execution_backlog(in_tenant text, in_project text) RETURNS TABLE(project_backlog bigint, installation_backlog bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT (SELECT count(*) FROM execution e
                WHERE e.tenant = in_tenant AND e.project = in_project
                  AND e.status NOT IN ('Terminal', 'Cancelled'))
            + (SELECT count(*) FROM execution_request q
                 JOIN execution_request_task t
                   ON t.tenant = q.tenant AND t.project = q.project AND t.request = q.request
                WHERE q.tenant = in_tenant AND q.project = in_project
                  AND q.kind IN ('SpawnWork', 'SpawnEvaluation') AND q.state = 'Open'),
              (SELECT count(*) FROM execution e
                WHERE e.status NOT IN ('Terminal', 'Cancelled'))
     $$;


ALTER FUNCTION public.execution_backlog(in_tenant text, in_project text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION execution_moves_legally() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE reported text;
     BEGIN
       IF OLD.status IN ('Terminal', 'Cancelled') THEN
         RAISE EXCEPTION 'execution % is already %, and a settled execution is written once',
           OLD.execution, OLD.status USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.execution, NEW.ticket, NEW.task, NEW.source_request,
           NEW.account, NEW.cluster, NEW.configuration_revision, NEW.configuration_digest,
           NEW.requirement_identity,NEW.requirement_value,NEW.requirement_digest,
           NEW.requirement_source,NEW.platform_default_version)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.execution, OLD.ticket, OLD.task, OLD.source_request,
           OLD.account, OLD.cluster, OLD.configuration_revision, OLD.configuration_digest,
           OLD.requirement_identity,OLD.requirement_value,OLD.requirement_digest,
           OLD.requirement_source,OLD.platform_default_version) THEN
         RAISE EXCEPTION 'execution % would change an identity or a pin it was registered under',
           OLD.execution USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.status IS DISTINCT FROM OLD.status
          AND NOT execution_status_move_is_legal(OLD.status, NEW.status) THEN
         RAISE EXCEPTION 'execution % may not move from % to %',
           OLD.execution, OLD.status, NEW.status
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.attempt_next < OLD.attempt_next OR NEW.retries_spent < OLD.retries_spent THEN
         RAISE EXCEPTION 'execution % would reuse an attempt number or unspend a retry',
           OLD.execution USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.result_manifest IS NOT NULL THEN
         SELECT r.verdict INTO reported FROM execution_result r
          WHERE r.tenant = NEW.tenant AND r.project = NEW.project
            AND r.manifest = NEW.result_manifest;
         IF (NEW.outcome = 'Passed') IS DISTINCT FROM (reported = 'Pass') THEN
           RAISE EXCEPTION 'execution % settles % over a manifest that reported %',
             OLD.execution, NEW.outcome, reported
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END IF;
       RETURN NEW;
     END $$;`,
  `CREATE FUNCTION execution_result_artifact_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM append_project_change(NEW.tenant,NEW.project,'Execution',
         (SELECT named.execution FROM execution_result AS named
           WHERE named.tenant=NEW.tenant AND named.project=NEW.project
             AND named.manifest=NEW.manifest));
       RETURN NULL;
     END $$;


ALTER FUNCTION public.execution_result_artifact_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION execution_result_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       RAISE EXCEPTION
         'result manifest % is written once, and a manifest that could be edited is not evidence',
         OLD.manifest
         USING ERRCODE = 'integrity_constraint_violation';
     END $$;`,
  `CREATE FUNCTION execution_result_reporter_is_unfenced() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE reporter text;
     BEGIN
       SELECT a.state INTO reporter FROM execution_attempt a
        WHERE a.tenant = NEW.tenant AND a.project = NEW.project
          AND a.execution = NEW.execution AND a.attempt = NEW.attempt;
       IF reporter = 'Superseded' THEN
         RAISE EXCEPTION
           'attempt % was fenced, and a fenced reporter''s manifest is not evidence',
           NEW.attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$;`,
  `CREATE FUNCTION execution_run_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM append_project_change(
         NEW.tenant,NEW.project,'Execution',NEW.execution);
       PERFORM append_project_change(NEW.tenant,NEW.project,'Ticket',
         (SELECT named.ticket::text FROM execution AS named
           WHERE named.tenant=NEW.tenant AND named.project=NEW.project
             AND named.execution=NEW.execution),
         NULL::text);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.execution_run_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION execution_run_evidence_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       RAISE EXCEPTION
         'run evidence for attempt % is written once, and evidence that could be edited is not evidence',
         OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
     END $$;`,
  `CREATE FUNCTION execution_run_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF TG_OP = 'UPDATE' AND OLD.configuration_path IS NULL
          AND NEW.configuration_path IS NOT NULL
          AND (to_jsonb(NEW) - 'configuration_path' - 'configuration_digest' - 'configuration_bytes' - 'configuration_recorded_at')
              IS NOT DISTINCT FROM
              (to_jsonb(OLD) - 'configuration_path' - 'configuration_digest' - 'configuration_bytes' - 'configuration_recorded_at') THEN
         RETURN NEW;
       END IF;
       RAISE EXCEPTION
         'run % records its configuration once and is written once otherwise',
         OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
     END $$;`,
  `CREATE FUNCTION execution_status_move_is_legal(before text, after text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
       SELECT CASE before
         WHEN 'Queued'    THEN after IN ('Admitted', 'Cancelled')
         WHEN 'Admitted'  THEN after IN ('Launching', 'Terminal', 'Cancelled')
         WHEN 'Launching' THEN after IN ('Running', 'Terminal', 'Cancelled')
         WHEN 'Running'   THEN after IN ('Terminal', 'Cancelled')
         WHEN 'Terminal'  THEN after = 'Terminal'
         WHEN 'Cancelled' THEN after = 'Cancelled'
       END $$;


ALTER FUNCTION public.execution_status_move_is_legal(before text, after text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION fail_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_failure text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_failure IS NULL
          OR in_failure NOT IN ('AgentFailed', 'AgentRateLimited', 'AgentTurnsExhausted', 'AgentBudgetExhausted', 'StoreRefused') THEN
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
     END $$;


ALTER FUNCTION public.fail_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_failure text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION fence_old_epoch_session_attempts(in_epoch text, in_max bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record; fenced bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       fenced:=0;
       FOR stale IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ('Placing','Running') AND a.recovery_epoch<>in_epoch
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Superseded',generation=a.generation+1,evidence='Fenced',
                ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=stale.attempt;
         PERFORM release_session_attempt_turns(
           stale.tenant,stale.project,stale.session,stale.attempt);
         fenced:=fenced+1;
       END LOOP;
       RETURN fenced;
     END $$;


ALTER FUNCTION public.fence_old_epoch_session_attempts(in_epoch text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION finalization_change_proposal_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
       IF TG_OP = 'DELETE' THEN
         RAISE EXCEPTION 'a change proposal that could be erased is not evidence'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.request, NEW.permit, NEW.proposal_request,
           NEW.head_ref, NEW.head_commit, NEW.base_ref, NEW.base_commit,
           NEW.title, NEW.body, NEW.opened_at)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.request, OLD.permit, OLD.proposal_request,
           OLD.head_ref, OLD.head_commit, OLD.base_ref, OLD.base_commit,
           OLD.title, OLD.body, OLD.opened_at) THEN
         RAISE EXCEPTION 'what a change proposal asked for is written once'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.creation IS NOT NULL
          AND (NEW.creation, NEW.creation_contradiction, NEW.creation_evidence)
              IS DISTINCT FROM
              (OLD.creation, OLD.creation_contradiction, OLD.creation_evidence) THEN
         RAISE EXCEPTION 'a change proposal is created once and read back after'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.merge IS NOT NULL
          AND (NEW.merge, NEW.merge_reason, NEW.merge_commit)
              IS DISTINCT FROM (OLD.merge, OLD.merge_reason, OLD.merge_commit) THEN
         RAISE EXCEPTION 'a change proposal is merged once and read back after'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1)
          OR NEW.refusals NOT IN (OLD.refusals, OLD.refusals + 1)
          OR NEW.declines NOT IN (OLD.declines, OLD.declines + 1)
          OR NEW.reconciliations
             NOT IN (OLD.reconciliations, OLD.reconciliations + 1)
          OR NEW.merge_attempts
             NOT IN (OLD.merge_attempts, OLD.merge_attempts + 1)
          OR NEW.merge_refusals
             NOT IN (OLD.merge_refusals, OLD.merge_refusals + 1)
          OR NEW.merge_declines
             NOT IN (OLD.merge_declines, OLD.merge_declines + 1)
          OR NEW.merge_readings
             NOT IN (OLD.merge_readings, OLD.merge_readings + 1) THEN
         RAISE EXCEPTION 'a change proposal counts one act at a time'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.finalization_change_proposal_is_written_once() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION finalization_reconciliation_concludes_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF OLD.verdict <> 'Unreadable' THEN
         RAISE EXCEPTION
           'reconciliation of permit % already concluded %, and a verdict is read once',
           OLD.permit, OLD.verdict USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.permit, NEW.candidate_commit, NEW.target_ref)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.permit, OLD.candidate_commit, OLD.target_ref) THEN
         RAISE EXCEPTION
           'reconciliation of permit % would change the candidate or ref it was read against',
           OLD.permit USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.finalization_reconciliation_concludes_once() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION finalization_request_configuration_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
         RAISE EXCEPTION 'finalization request configuration is immutable'
           USING ERRCODE = 'integrity_constraint_violation';
       END $$;


ALTER FUNCTION public.finalization_request_configuration_is_written_once() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION forge_installation_keeps_its_claim() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'a forge installation claim is not released'
         USING ERRCODE='integrity_constraint_violation';
     END IF;
     IF NEW.forge IS DISTINCT FROM OLD.forge
        OR NEW.app IS DISTINCT FROM OLD.app
        OR NEW.account IS DISTINCT FROM OLD.account
        OR NEW.tenant IS DISTINCT FROM OLD.tenant THEN
       RAISE EXCEPTION 'a forge installation does not change hands'
         USING ERRCODE='integrity_constraint_violation';
     END IF;
     RETURN NEW; END $$;


ALTER FUNCTION public.forge_installation_keeps_its_claim() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION heartbeat_session_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET lease_expires_at=now()+make_interval(
                secs => in_lease_secs::double precision)
        WHERE a.attempt=bound.attempt AND a.state IN ('Placing','Running');
       RETURN FOUND;
     END $$;


ALTER FUNCTION public.heartbeat_session_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION heartbeat_worker_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       BEGIN
         IF in_lease_secs <= 0 THEN RETURN false; END IF;
         UPDATE execution_attempt a
            SET lease_expires_at=now()+make_interval(secs=>in_lease_secs::double precision)
           FROM execution e
          WHERE a.capability_secret_digest=in_secret_digest
            AND a.generation=in_generation
            AND a.state='Running'
            AND a.lease_expires_at>now()
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
            AND e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
            AND e.status='Running';
         RETURN FOUND;
       END $$;


ALTER FUNCTION public.heartbeat_worker_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION hide_member_thread(in_tenant text, in_project text, in_session text, in_hidden boolean) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held timestamptz;
     BEGIN
       SELECT s.hidden_at INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoThread'; END IF;
       IF in_hidden AND held IS NULL THEN
         UPDATE agent_session s SET hidden_at=now()
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.session=in_session;
       ELSIF NOT in_hidden AND held IS NOT NULL THEN
         UPDATE agent_session s SET hidden_at=NULL
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.session=in_session;
       END IF;
       RETURN CASE WHEN in_hidden THEN 'Hidden' ELSE 'Shown' END;
     END $$;


ALTER FUNCTION public.hide_member_thread(in_tenant text, in_project text, in_session text, in_hidden boolean) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION import_repository_configuration(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_kind text, in_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE existing configuration_revision%ROWTYPE;
           provenance repository_configuration_provenance%ROWTYPE; inserted boolean := false;
   BEGIN
     PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR SHARE;
     PERFORM 1 FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_expected_repository
        AND b.recovery_epoch=in_expected_recovery_epoch;
     IF NOT FOUND THEN RETURN 'StaleBinding'; END IF;
     INSERT INTO configuration_revision
       (tenant,project,revision,parent,canonical,digest,authority_kind,authority_subject)
     VALUES (in_tenant,in_project,in_revision,NULL,in_canonical,in_digest,in_kind,in_subject)
     ON CONFLICT (tenant,project,revision) DO NOTHING RETURNING true INTO inserted;
     IF inserted IS NOT TRUE THEN
       SELECT * INTO existing FROM configuration_revision
        WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
       IF existing.canonical<>in_canonical OR existing.digest<>in_digest OR existing.parent IS NOT NULL
         THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict'; END IF;
     END IF;
     INSERT INTO repository_configuration_provenance
       (tenant,project,revision,digest,repository,repository_commit,path,name)
     VALUES (in_tenant,in_project,in_revision,in_digest,in_expected_repository,in_commit,in_path,in_name)
     ON CONFLICT (tenant,project,revision) DO NOTHING;
     SELECT * INTO provenance FROM repository_configuration_provenance
      WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
     IF provenance.digest<>in_digest OR provenance.repository<>in_expected_repository
        OR provenance.repository_commit<>in_commit OR provenance.path<>in_path OR provenance.name<>in_name
       THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict'; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended(in_tenant||'/'||in_project,0));
     INSERT INTO repository_configuration_version (tenant,project,name,digest,number)
     SELECT in_tenant,in_project,in_name,in_digest,coalesce(max(number),0)+1
       FROM repository_configuration_version
      WHERE tenant=in_tenant AND project=in_project AND name=in_name
     ON CONFLICT (tenant,project,name,digest) DO NOTHING;
     IF inserted THEN
       PERFORM publish_project_notification(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
       RETURN 'Imported'; END IF;
     RETURN 'AlreadyImported';
   EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict';
   END $$;


ALTER FUNCTION public.import_repository_configuration(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_kind text, in_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION inquiry_closes_with_its_turn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       UPDATE agent_session s SET state='Closed',closed_at=now()
        WHERE s.tenant=NEW.tenant AND s.project=NEW.project
          AND s.session=NEW.session AND s.kind='Inquiry';
       RETURN NULL;
     END $$;


ALTER FUNCTION public.inquiry_closes_with_its_turn() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION inquiry_writes_no_store_batch() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF EXISTS(SELECT 1 FROM agent_session s
                  WHERE s.tenant=NEW.tenant AND s.project=NEW.project
                    AND s.session=NEW.session AND s.kind='Inquiry') THEN
         RAISE EXCEPTION
           'session % is an inquiry, and an inquiry answers aside rather than keeping a transcript',
           NEW.session USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.inquiry_writes_no_store_batch() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION lead_session(in_tenant text, in_project text) RETURNS TABLE(session text, state text, agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.state,s.agent_reference FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
     $$;


ALTER FUNCTION public.lead_session(in_tenant text, in_project text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION legacy_event(command text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     BEGIN
       RETURN command::jsonb;
     EXCEPTION WHEN others THEN
       RETURN NULL;
     END $$;


ALTER FUNCTION public.legacy_event(command text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION list_project_repository_bindings(in_tenant text, in_project text, in_max bigint) RETURNS TABLE(repository text, bound_at timestamp with time zone, landing_mode text, retired_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_mode,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
      ORDER BY b.bound_at,b.repository
      LIMIT least(coalesce(in_max,200),
                  200)
     $$;


ALTER FUNCTION public.list_project_repository_bindings(in_tenant text, in_project text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION list_repository_bindings(in_max bigint) RETURNS TABLE(tenant text, project text, repository text, bound_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.tenant,b.project,b.repository,b.bound_at FROM project_repository b
      WHERE b.retired_at IS NULL
      ORDER BY b.bound_at,b.tenant,b.project,b.repository
      LIMIT least(coalesce(in_max,1000),
                  1000)
     $$;


ALTER FUNCTION public.list_repository_bindings(in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION list_session_store_streams(in_tenant text, in_project text, in_session text, in_max bigint) RETURNS TABLE(stream text, batches bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT b.stream,count(*)::bigint
         FROM session_store_batch b
        WHERE b.tenant=in_tenant AND b.project=in_project AND b.session=in_session
        GROUP BY b.stream ORDER BY b.stream
        LIMIT least(coalesce(in_max,101),
                    101)
     $$;


ALTER FUNCTION public.list_session_store_streams(in_tenant text, in_project text, in_session text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION list_session_streams(in_secret_digest text, in_generation bigint, in_max bigint) RETURNS TABLE(stream text, batches bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT b.stream,count(*)::bigint
         FROM session_attempt_binding(in_secret_digest,in_generation) k
         CROSS JOIN LATERAL (
       SELECT k.session AS session,NULL::bigint AS ceiling
       UNION ALL
       SELECT s.parent_session,
              (SELECT coalesce(max(t.batch_last),0) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.parent_session
                  AND t.state IN ('Answered','Failed'))
         FROM agent_session s
        WHERE s.tenant=k.tenant AND s.project=k.project AND s.session=k.session) readable
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=readable.session
        GROUP BY b.stream ORDER BY b.stream
        LIMIT least(coalesce(in_max,101),
                    101)
     $$;


ALTER FUNCTION public.list_session_streams(in_secret_digest text, in_generation bigint, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION lose_session_attempt(in_secret_digest text, in_generation bigint, in_evidence text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; ended boolean;
     BEGIN
       SELECT a.attempt INTO held FROM session_attempt a
        WHERE a.bearer_secret_digest=in_secret_digest;
       IF NOT FOUND THEN RETURN false; END IF;
       SELECT end_session_attempt(held,in_generation,in_evidence) INTO ended;
       RETURN ended;
     END $$;


ALTER FUNCTION public.lose_session_attempt(in_secret_digest text, in_generation bigint, in_evidence text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION lose_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       DECLARE bound record;
       BEGIN
         SELECT a.tenant,a.project,a.execution INTO bound
           FROM execution_attempt a
          WHERE a.capability_secret_digest=in_secret_digest;
         IF NOT FOUND THEN RETURN false; END IF;
         PERFORM 1 FROM execution e
          WHERE e.tenant=bound.tenant AND e.project=bound.project
            AND e.execution=bound.execution FOR UPDATE;
         UPDATE execution_attempt a
            SET state='Lost',evidence=in_evidence,ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL
          WHERE a.capability_secret_digest=in_secret_digest
            AND a.generation=in_generation AND a.state IN ('Placing','Running')
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                   ORDER BY ordinal DESC LIMIT 1);
         IF NOT FOUND THEN RETURN false; END IF;
         UPDATE execution e SET retries_spent=e.retries_spent+1,
                                placement_backoff_from=now()
          WHERE e.tenant=bound.tenant AND e.project=bound.project
            AND e.execution=bound.execution
            AND e.status NOT IN ('Terminal','Cancelled');
         RETURN FOUND;
       END $$;


ALTER FUNCTION public.lose_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION materialize_legacy_execution_requirement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE configuration jsonb;
     BEGIN
       IF NEW.requirement_identity IS NOT NULL THEN RETURN NEW; END IF;
       SELECT canonical::jsonb INTO STRICT configuration FROM configuration_revision
         WHERE tenant=NEW.tenant AND project=NEW.project
           AND revision=NEW.configuration_revision AND digest=NEW.configuration_digest;
       NEW.requirement_identity=NEW.execution;
       NEW.requirement_value=jsonb_build_object('mode','Container','operatingSystem','Linux',
         'architecture','Amd64','image',configuration->>'image');
       NEW.requirement_digest=encode(sha256(convert_to(format(
         '{"mode":"Container","operatingSystem":"Linux","architecture":"Amd64","image":%s}',
         to_json(configuration->>'image')::text),'UTF8')),'hex');
       NEW.requirement_source='PlatformDefault';
       NEW.platform_default_version=1;
       RETURN NEW;
     END $$;


ALTER FUNCTION public.materialize_legacy_execution_requirement() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION native_action_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       BEGIN
         PERFORM append_project_change(
           NEW.tenant,NEW.project,'NativeAction',NEW.ticket::text);
         RETURN NULL;
       END $$;


ALTER FUNCTION public.native_action_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION native_action_resolution_pairs_with_its_kind() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       DECLARE asked text;
       BEGIN
         SELECT n.kind INTO asked FROM native_action n
          WHERE n.tenant = NEW.tenant AND n.project = NEW.project
            AND n.action = NEW.action;
         IF NOT ((asked = 'TicketEscalation' AND NEW.resolution IN ('Resume', 'Revoke'))
              OR (asked = 'HandoffBlock' AND NEW.resolution IN ('RetryHandoff', 'AbandonHandoff'))
              OR (asked = 'FinalizationApproval' AND NEW.resolution IN ('Approve', 'Decline'))) THEN
           RAISE EXCEPTION '% is not an answer a % asks for', NEW.resolution, asked
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$;


ALTER FUNCTION public.native_action_resolution_pairs_with_its_kind() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION open_agent_session(in_tenant text, in_project text, in_session text, in_kind text, in_principal text, in_parent text, in_capabilities text[], in_credential_slot text, in_system_prompt text) RETURNS text
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
     END $$;


ALTER FUNCTION public.open_agent_session(in_tenant text, in_project text, in_session text, in_kind text, in_principal text, in_parent text, in_capabilities text[], in_credential_slot text, in_system_prompt text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION open_lead_inquiry(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text) RETURNS TABLE(opened text, ordinal bigint, session text)
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
         in_tenant,in_project,in_session,in_turn,'Inquiry',in_question);
       RETURN QUERY SELECT 'Opened'::text,answered.ordinal,in_session;
     END $_$;


ALTER FUNCTION public.open_lead_inquiry(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION open_member_thread(in_tenant text, in_project text, in_principal text, in_session text, in_credential_slot text, in_system_prompt text) RETURNS TABLE(opened text, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
            account,cluster,system_prompt,opened_after_sequence)
         VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
                ARRAY['RepositoryRead', 'RunCommands', 'ProjectRead', 'DraftAuthor', 'DraftOriginate']::text[],in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt,
                coalesce((SELECT max(head.sequence) FROM project_change head),0));
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$;


ALTER FUNCTION public.open_member_thread(in_tenant text, in_project text, in_principal text, in_session text, in_credential_slot text, in_system_prompt text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION open_project_lead(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text) RETURNS TABLE(opened text, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
                ARRAY['RepositoryRead', 'ProjectRead', 'DraftAuthor']::text[],in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt);
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Lead' AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$;


ALTER FUNCTION public.open_project_lead(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION open_session_attempt(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint) RETURNS TABLE(opened text, attempt text, generation bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; numbered bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       SELECT s.state,s.account,s.cluster INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND OR held.state<>'Open'
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND project=in_project AND session=in_session AND a.state IN ('Placing','Running'))
          OR NOT EXISTS(SELECT 1 FROM session_turn t
                     WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.state='Queued') THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=in_tenant AND project=in_project AND session=in_session
                    AND a.ended_at > now() - make_interval(
                          secs => in_backoff_secs::double precision)) THEN
         RETURN QUERY SELECT 'BackingOff'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.account=held.account AND a.state IN ('Placing','Running'))>=in_account_max THEN
         RETURN QUERY SELECT 'AccountAtMaximum'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.cluster=held.cluster AND a.state IN ('Placing','Running'))>=in_cluster_max THEN
         RETURN QUERY SELECT 'ClusterFull'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,in_epoch,'Placing',
              in_attempt,now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest);
       RETURN QUERY SELECT 'Opened'::text,in_attempt,1::bigint;
     END $$;


ALTER FUNCTION public.open_session_attempt(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION place_session_attempt(in_attempt text, in_generation bigint, in_placement text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       UPDATE session_attempt a
          SET state='Running',placement=in_placement,
              idle_since=CASE WHEN EXISTS(
                SELECT 1 FROM session_turn t
                 WHERE t.tenant=a.tenant AND t.project=a.project
                   AND t.session=a.session AND t.attempt=a.attempt
                   AND t.state='Claimed') THEN NULL ELSE now() END
        WHERE a.attempt=in_attempt AND a.generation=in_generation
          AND a.state='Placing' AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1);
       RETURN FOUND;
     END $$;


ALTER FUNCTION public.place_session_attempt(in_attempt text, in_generation bigint, in_placement text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_active_work(in_tenant text, in_project text) RETURNS TABLE(queued bigint, admitted bigint, launching bigint, running bigint, cluster_slots_max bigint, cluster_active bigint, account_maximum bigint, account_active bigint, account_deficit bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT own.queued, own.admitted, own.launching, own.running,
              coalesce(c.slots_max, 0)::bigint, coalesce(clustered.active, 0),
              coalesce(a.maximum, 0)::bigint, coalesce(held.active, 0),
              greatest(coalesce(a.reserved, 0) - coalesce(held.active, 0), 0)::bigint
         FROM (SELECT count(*) FILTER (WHERE e.status = 'Queued')    AS queued,
                      count(*) FILTER (WHERE e.status = 'Admitted')  AS admitted,
                      count(*) FILTER (WHERE e.status = 'Launching') AS launching,
                      count(*) FILTER (WHERE e.status = 'Running')   AS running
                 FROM execution e
                WHERE e.tenant = in_tenant AND e.project = in_project) own
         LEFT JOIN capacity_account a
                ON a.account = project_capacity_account(in_tenant, in_project)
         LEFT JOIN execution_cluster c ON c.cluster = a.cluster
         LEFT JOIN LATERAL (SELECT count(*) AS active FROM execution x
                             WHERE x.cluster = a.cluster
                               AND x.status IN ('Admitted','Launching','Running')) clustered ON true
         LEFT JOIN LATERAL (SELECT count(*) AS active FROM execution x
                             WHERE x.account = a.account
                               AND x.status IN ('Admitted','Launching','Running')) held ON true
     $$;


ALTER FUNCTION public.project_active_work(in_tenant text, in_project text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_capacity_account(in_tenant text, in_project text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
       SELECT octet_length(in_tenant)::text || ':' || in_tenant
           || octet_length(in_project)::text || ':' || in_project
     $$;


ALTER FUNCTION public.project_capacity_account(in_tenant text, in_project text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_change_retains(in_cursor bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT in_cursor >= coalesce(min(sequence),in_cursor + 1) - 1 FROM project_change
     $$;


ALTER FUNCTION public.project_change_retains(in_cursor bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_draws_a_capacity_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       INSERT INTO capacity_account (account, cluster, reserved, maximum, policy_revision)
       VALUES (project_capacity_account(NEW.tenant, NEW.project), 'default', 1, 8, 1)
       ON CONFLICT (account) DO NOTHING;
       RETURN NULL;
     END $$;


ALTER FUNCTION public.project_draws_a_capacity_account() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_notification_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM append_project_change(NEW.tenant,NEW.project,NEW.kind,NEW.resource);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.project_notification_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_repository_bind_operation_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
     RAISE EXCEPTION 'repository bind operations are immutable'
       USING ERRCODE='integrity_constraint_violation'; END $$;


ALTER FUNCTION public.project_repository_bind_operation_is_immutable() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_repository_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$ BEGIN
     IF TG_OP='UPDATE'
        AND to_jsonb(NEW)-'landing_mode'-'retired_at'
          = to_jsonb(OLD)-'landing_mode'-'retired_at'
       THEN RETURN NEW; END IF;
     RAISE EXCEPTION 'repository bindings are immutable but for their landing and their retirement'
       USING ERRCODE='integrity_constraint_violation'; END $$;


ALTER FUNCTION public.project_repository_is_immutable() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION project_tenure_is_fenced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     DECLARE
       was_live boolean;
       is_live  boolean;
     BEGIN
       IF NEW.fencing_epoch < OLD.fencing_epoch THEN
         RAISE EXCEPTION
           'project %/% would move its fencing epoch backwards, and a fence only advances',
           OLD.tenant, OLD.project
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       was_live := OLD.owner IS NOT NULL AND OLD.lease_expires_at > now();
       is_live  := NEW.owner IS NOT NULL AND NEW.lease_expires_at > now();
       IF is_live AND NEW.fencing_epoch = OLD.fencing_epoch
          AND NOT (was_live
                   AND NEW.owner = OLD.owner
                   AND NEW.recovery_epoch IS NOT DISTINCT FROM OLD.recovery_epoch)
       THEN
         RAISE EXCEPTION
           'project %/% would take a tenure without advancing its fencing epoch',
           OLD.tenant, OLD.project
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END
     $$;`,
  `CREATE FUNCTION public_ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'version') <> 'number'
          OR command->>'version' <> '1' THEN
         RETURN false;
       END IF;
       IF command->>'command' = 'Decide' THEN
         RETURN decision_event_is_valid(command->'event')
           AND command->'event'->>'type' <> 'ReleaseTicket';
       END IF;
       IF command->>'command' = 'ReleaseDraft' THEN
         RETURN command_integer(command->'ticket') AND (command->>'ticket')::numeric >= 1
           AND command_integer(command->'authoringVersion') AND (command->>'authoringVersion')::numeric >= 1
           AND jsonb_typeof(command->'configurationRevision')='string'
           AND length(command->>'configurationRevision') BETWEEN 1 AND 256;
       END IF;
       RETURN command->>'command' = 'ResolveNativeAction'
         AND jsonb_typeof(command->'action') = 'string'
         AND length(command->>'action') BETWEEN 1 AND 256
         AND command_integer(command->'authorizingSeq')
         AND (command->>'authorizingSeq')::numeric >= 1
         AND command->>'resolution' IN ('Resume', 'Revoke', 'RetryHandoff', 'AbandonHandoff', 'Approve', 'Decline');
     END $$;


ALTER FUNCTION public.public_ticket_command_is_valid(command jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION publish_continuation(in_tenant text, in_project text, in_ordinal bigint, in_continuation text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       BEGIN
         INSERT INTO decision_input
           (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
         SELECT in_tenant, in_project, in_ordinal, 'Continuation', in_continuation,
                'Continuation', lifecycle_generation
           FROM project WHERE tenant=in_tenant AND project=in_project;
         INSERT INTO project_readiness (tenant, project, ready, generation)
         VALUES (in_tenant, in_project, true, 1)
         ON CONFLICT (tenant, project) DO UPDATE
           SET ready=true, generation=project_readiness.generation+1;
       END $$;


ALTER FUNCTION public.publish_continuation(in_tenant text, in_project text, in_ordinal bigint, in_continuation text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION publish_project_notification(in_tenant text, in_project text, in_kind text, in_resource text, in_project_seq bigint, in_authoring_version bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE allocated bigint; retention_max constant bigint := 1000;
     BEGIN
       UPDATE project SET notification_next=notification_next+1
        WHERE tenant=in_tenant AND project=in_project
        RETURNING notification_next-1 INTO allocated;
       IF allocated IS NULL THEN RAISE EXCEPTION 'notification project is absent'; END IF;
       INSERT INTO project_notification
         (tenant,project,ordinal,kind,resource,project_seq,authoring_version)
       VALUES (in_tenant,in_project,allocated,in_kind,in_resource,in_project_seq,in_authoring_version);
       DELETE FROM project_notification
        WHERE tenant=in_tenant AND project=in_project AND ordinal <= allocated-retention_max;
       RETURN allocated;
     END $$;


ALTER FUNCTION public.publish_project_notification(in_tenant text, in_project text, in_kind text, in_resource text, in_project_seq bigint, in_authoring_version bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) RETURNS TABLE(repository text, candidate_commit text, configuration_revision text, configuration_digest text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.repository,a.candidate_commit,a.configuration_revision,a.configuration_digest
         FROM finalization_request f
         JOIN finalization_attempt a
           ON a.tenant=f.tenant AND a.project=f.project AND a.request=f.request
         JOIN commit_permit p
           ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
         JOIN finalization_reconciliation r
           ON r.tenant=p.tenant AND r.project=p.project AND r.permit=p.permit
        WHERE f.tenant=in_tenant AND f.project=in_project AND f.ticket=in_ticket
          AND f.kind='PromoteForHandoff' AND p.state='Concluded'
          AND r.verdict='Promoted'
        ORDER BY f.authorizing_seq DESC,a.prepared_at DESC LIMIT 1
       $$;


ALTER FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_agentic_refusals(in_tenant text, in_project text, in_ticket bigint, in_max bigint) RETURNS TABLE(ordinal bigint, event text, ticket_version bigint, reason text, selector_decision text, recorded_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT r.ordinal,r.event,r.ticket_version,r.reason,
              r.selector_decision,r.recorded_at
         FROM selector_agentic_refusal r
        WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
        ORDER BY r.ordinal
        LIMIT least(coalesce(in_max,33),
                    33)
     $$;


ALTER FUNCTION public.read_agentic_refusals(in_tenant text, in_project text, in_ticket bigint, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_lead_inquiries(in_tenant text, in_project text, in_max bigint) RETURNS TABLE(session text, principal text, state text, turn text, turn_state text, ordinal bigint, input text, result text, failure text, asked_at timestamp with time zone, model text, tokens bigint, cost_micros bigint, duration_ms bigint, tools text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.principal,s.state,
              t.turn,t.state,t.ordinal,t.input,t.result,t.failure,t.enqueued_at,
              t.model,t.tokens,t.cost_micros,t.duration_ms,t.tools
         FROM agent_session s
         JOIN agent_session parent
           ON parent.tenant=s.tenant AND parent.project=s.project
          AND parent.session=s.parent_session AND parent.kind='Lead'
         JOIN session_turn t
           ON t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
         WHERE s.tenant=in_tenant AND s.project=in_project
        ORDER BY t.enqueued_at DESC,s.session DESC
        LIMIT least(coalesce(in_max,32),32)
     $$;


ALTER FUNCTION public.read_lead_inquiries(in_tenant text, in_project text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_lead_inquiry(in_tenant text, in_project text, in_session text) RETURNS TABLE(session text, principal text, state text, turn text, turn_state text, ordinal bigint, input text, result text, failure text, asked_at timestamp with time zone, model text, tokens bigint, cost_micros bigint, duration_ms bigint, tools text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.principal,s.state,
              t.turn,t.state,t.ordinal,t.input,t.result,t.failure,t.enqueued_at,
              t.model,t.tokens,t.cost_micros,t.duration_ms,t.tools
         FROM agent_session s
         JOIN agent_session parent
           ON parent.tenant=s.tenant AND parent.project=s.project
          AND parent.session=s.parent_session AND parent.kind='Lead'
         JOIN session_turn t
           ON t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
         WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
     $$;


ALTER FUNCTION public.read_lead_inquiry(in_tenant text, in_project text, in_session text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_lead_standing(in_tenant text, in_project text, in_turns_max bigint) RETURNS TABLE(session text, session_state text, agent_reference text, attention text, notification_cursor bigint, handoff_note text, turn text, turn_ordinal bigint, input_kind text, turn_state text, failure text, model text, tokens bigint, cost_micros bigint, duration_ms bigint, tools text[], batch_first bigint, batch_last bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
            LIMIT least(coalesce(in_turns_max,32),
                        32)) tail ON true
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
        ORDER BY tail.ordinal
     $$;


ALTER FUNCTION public.read_lead_standing(in_tenant text, in_project text, in_turns_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_lead_turn(in_turn text) RETURNS TABLE(state text, result text, failure text, model text, tokens bigint, cost_micros bigint, duration_ms bigint, tools text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT t.state,t.result,t.failure,t.model,t.tokens,
              t.cost_micros,t.duration_ms,t.tools
         FROM session_turn t
         JOIN agent_session s ON s.tenant=t.tenant AND s.project=t.project
                             AND s.session=t.session
        WHERE s.kind='Lead' AND t.turn=in_turn
     $$;


ALTER FUNCTION public.read_lead_turn(in_turn text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint) RETURNS TABLE(ticket bigint, authoring_version bigint, state text, configuration_revision text, authoring text, title text, intent text, branch text, repository text, finalization_mode text, finalization_target text, links text[], checks text[], version_name text, version_number bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,
              r.authoring,b.title,b.intent,b.branch,b.repository,
              b.finalization_mode,b.finalization_target,
              (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                WHERE k.tenant=d.tenant AND k.project=d.project
                  AND k.ticket=d.ticket),
              (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                WHERE c.tenant=d.tenant AND c.project=d.project
                  AND c.ticket=d.ticket),
              v.name,v.number
         FROM draft d
         JOIN draft_revision r USING (tenant,project,ticket,authoring_version)
         LEFT JOIN draft_brief b
           ON b.tenant=d.tenant AND b.project=d.project AND b.ticket=d.ticket
         LEFT JOIN repository_configuration_provenance p
           ON p.tenant=d.tenant AND p.project=d.project
          AND p.revision=d.configuration_revision
         LEFT JOIN repository_configuration_version v
           ON v.tenant=d.tenant AND v.project=d.project
          AND v.name=p.name AND v.digest=p.digest
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Draft'
          AND d.ticket>coalesce(in_after,0)
        ORDER BY d.ticket
        LIMIT least(coalesce(in_max,101),
                    101)
     $$;


ALTER FUNCTION public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_project_repository_binding(in_tenant text, in_project text, in_repository text) RETURNS TABLE(repository text, recovery_epoch text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.recovery_epoch FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND (in_repository IS NULL OR b.repository=in_repository)
        AND (in_repository IS NOT NULL OR b.retired_at IS NULL)
      ORDER BY b.bound_at,b.repository LIMIT 1
     $$;


ALTER FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_project_repository_landing(in_tenant text, in_project text, in_repository text) RETURNS TABLE(repository text, bound_at timestamp with time zone, landing_mode text, retired_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_mode,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository
     $$;


ALTER FUNCTION public.read_project_repository_landing(in_tenant text, in_project text, in_repository text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_project_threads(in_tenant text, in_project text, in_max bigint) RETURNS TABLE(session text, principal text, state text, agent_reference text, turns bigint, first_message text, member_title text, opened_at timestamp with time zone, last_activity_at timestamp with time zone, hidden_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.principal,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              (SELECT left(CASE WHEN strpos(t.input,chr(10)||chr(10)||'# What your owner says'||chr(10)||chr(10))>0
                  THEN split_part(t.input,chr(10)||chr(10)||'# What your owner says'||chr(10)||chr(10),-1)
                  ELSE split_part(t.input,'- A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.'||chr(10)||chr(10),-1) END,80)
         FROM session_turn t
        WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
          AND t.input_kind='UserMessage'
        ORDER BY t.ordinal
        LIMIT 1),
              s.member_title,s.opened_at,moved.at,s.hidden_at
         FROM agent_session s
         CROSS JOIN LATERAL (
           SELECT greatest(s.opened_at,s.closed_at,
                    (SELECT max(greatest(t.enqueued_at,t.ended_at))
                       FROM session_turn t
                      WHERE t.tenant=s.tenant AND t.project=s.project
                        AND t.session=s.session)) AS at) moved
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
        ORDER BY (s.state='Open') DESC,moved.at DESC,s.session
        LIMIT least(coalesce(in_max,64),64)
     $$;


ALTER FUNCTION public.read_project_threads(in_tenant text, in_project text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_selector_interactions(in_tenant text, in_project text, in_after bigint, in_max bigint, in_newest_first boolean) RETURNS TABLE(selector_decision text, ordinal bigint, instructions_version text, instructions text, observed_view text, observed_token text, context text, tool_activity text, result text, implementation_revision text, model_revision text, policy_revision text, accounting text, started_at timestamp with time zone, completed_at timestamp with time zone, observed_view_chunks text[], context_chunks text[], tool_activity_chunks text[], dispatches text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT i.selector_decision,i.ordinal,i.instructions_version,i.instructions,
              i.observed_view,i.observed_token,i.context,i.tool_activity,i.result,
              i.implementation_revision,i.model_revision,i.policy_revision,
              i.accounting,i.started_at,i.completed_at,
              coalesce(viewed.chunks,'{}'::text[]),
              coalesce(held.chunks,'{}'::text[]),
              coalesce(used.chunks,'{}'::text[]),
              settled.dispatches
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
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
             'ticket',landed.ticket,'state',landed.state,'outcome',landed.outcome)
             ORDER BY landed.ticket)::text AS dispatches
      FROM (SELECT d.ticket,d.state,d.outcome
              FROM selector_proposal_delivery d
             WHERE d.selector_decision=i.selector_decision
             ORDER BY d.ticket
             LIMIT 8) landed) settled ON true
        WHERE i.tenant=in_tenant AND i.project=in_project
          AND (in_newest_first IS TRUE OR i.ordinal>coalesce(in_after,0))
        ORDER BY CASE WHEN in_newest_first IS TRUE THEN -i.ordinal ELSE i.ordinal END
        LIMIT least(coalesce(in_max,50),
                    50)
     $$;


ALTER FUNCTION public.read_selector_interactions(in_tenant text, in_project text, in_after bigint, in_max bigint, in_newest_first boolean) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_selector_planning_intent(in_tenant text, in_project text) RETURNS TABLE(selector_decision text, intent text, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT p.selector_decision,p.intent,p.updated_at
         FROM selector_planning_intent p
        WHERE p.tenant=in_tenant AND p.project=in_project
     $$;


ALTER FUNCTION public.read_selector_planning_intent(in_tenant text, in_project text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_session_attempt(in_secret_digest text) RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint, kind text, principal text, capabilities text[], credential_slot text, agent_reference text, system_prompt text, fork_from text, live boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              s.capabilities,s.credential_slot,s.agent_reference,s.system_prompt,
              (SELECT p.agent_reference FROM agent_session p
                WHERE p.tenant=s.tenant AND p.project=s.project
                  AND p.session=s.parent_session),
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$;


ALTER FUNCTION public.read_session_attempt(in_secret_digest text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_session_store(in_secret_digest text, in_generation bigint, in_stream text, in_after bigint, in_limit bigint) RETURNS TABLE(session text, batch bigint, digest text, bytes bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT b.session,b.batch,b.digest,b.bytes
         FROM session_attempt_binding(in_secret_digest,in_generation) k
         CROSS JOIN LATERAL (
       SELECT k.session AS session,NULL::bigint AS ceiling
       UNION ALL
       SELECT s.parent_session,
              (SELECT coalesce(max(t.batch_last),0) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.parent_session
                  AND t.state IN ('Answered','Failed'))
         FROM agent_session s
        WHERE s.tenant=k.tenant AND s.project=k.project AND s.session=k.session) readable
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=readable.session
        WHERE b.stream=in_stream AND b.batch>coalesce(in_after,0)
          AND (readable.ceiling IS NULL OR b.batch<=readable.ceiling)
        ORDER BY b.batch
        LIMIT least(coalesce(in_limit,8),
                    8)
     $$;


ALTER FUNCTION public.read_session_store(in_secret_digest text, in_generation bigint, in_stream text, in_after bigint, in_limit bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_session_store_batches(in_tenant text, in_project text, in_session text, in_stream text, in_after bigint, in_max bigint) RETURNS TABLE(stream text, batch bigint, digest text, bytes bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT b.stream,b.batch,b.digest,b.bytes
         FROM session_store_batch b
        WHERE b.tenant=in_tenant AND b.project=in_project AND b.session=in_session
          AND b.stream=in_stream AND b.batch>coalesce(in_after,0)
        ORDER BY b.batch
        LIMIT least(coalesce(in_max,8),
                    8)
     $$;


ALTER FUNCTION public.read_session_store_batches(in_tenant text, in_project text, in_session text, in_stream text, in_after bigint, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) RETURNS TABLE(ticket bigint, ticket_version bigint, reason text, selector_decision text, recorded_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT standing.ticket,standing.ticket_version,standing.reason,
              standing.selector_decision,standing.recorded_at
         FROM standing_agentic_refusals(in_tenant,in_project,in_max) standing
     $$;


ALTER FUNCTION public.read_standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_thread_standing(in_tenant text, in_project text, in_session text, in_before bigint, in_turns_max bigint) RETURNS TABLE(session text, principal text, session_state text, agent_reference text, turns bigint, first_message text, member_title text, opened_at timestamp with time zone, last_activity_at timestamp with time zone, hidden_at timestamp with time zone, next_before bigint, turn text, turn_ordinal bigint, input_kind text, turn_state text, input text, result text, failure text, model text, tokens bigint, cost_micros bigint, duration_ms bigint, tools text[], batch_first bigint, batch_last bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH page AS (
         SELECT t.turn,t.ordinal,t.input_kind,t.state,t.input,t.result,t.failure,
                t.model,t.tokens,t.cost_micros,t.duration_ms,t.tools,
                t.batch_first,t.batch_last
           FROM session_turn t
          WHERE t.tenant=in_tenant AND t.project=in_project AND t.session=in_session
            AND (in_before IS NULL OR t.ordinal<in_before)
          ORDER BY t.ordinal DESC
          LIMIT least(coalesce(in_turns_max,32),
                      32))
       SELECT s.session,s.principal,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              (SELECT left(CASE WHEN strpos(t.input,chr(10)||chr(10)||'# What your owner says'||chr(10)||chr(10))>0
                  THEN split_part(t.input,chr(10)||chr(10)||'# What your owner says'||chr(10)||chr(10),-1)
                  ELSE split_part(t.input,'- A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.'||chr(10)||chr(10),-1) END,80)
         FROM session_turn t
        WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
          AND t.input_kind='UserMessage'
        ORDER BY t.ordinal
        LIMIT 1),
              s.member_title,s.opened_at,moved.at,s.hidden_at,
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
         CROSS JOIN LATERAL (
           SELECT greatest(s.opened_at,s.closed_at,
                    (SELECT max(greatest(t.enqueued_at,t.ended_at))
                       FROM session_turn t
                      WHERE t.tenant=s.tenant AND t.project=s.project
                        AND t.session=s.session)) AS at) moved
         LEFT JOIN page ON true
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        ORDER BY page.ordinal
     $$;


ALTER FUNCTION public.read_thread_standing(in_tenant text, in_project text, in_session text, in_before bigint, in_turns_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION read_worker_attempt(in_secret_digest text) RETURNS TABLE(tenant text, project text, execution text, attempt text, generation bigint, task_kind text, manifest text, input_bundle text, input_bundle_digest text, live boolean, inputs jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,t.kind,a.manifest,
              q.input_bundle,q.input_bundle_digest,
              (a.state IN ('Placing','Running') AND e.status IN ('Launching','Running')),
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'ordinal',r.ordinal,'kind',r.reference_kind,'reference',r.reference_id,
                'digest',r.reference_digest) ORDER BY r.ordinal)
                FROM input_bundle_reference r
               WHERE r.tenant=a.tenant AND r.project=a.project
                 AND r.bundle=q.input_bundle),'[]'::jsonb)
         FROM execution_attempt a
         JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                         AND e.execution=a.execution
         JOIN execution_request q ON q.tenant=e.tenant AND q.project=e.project
                                 AND q.request=e.source_request
         JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
                                      AND t.request=e.source_request AND t.task=e.task
        WHERE a.capability_secret_digest=in_secret_digest
          AND ((a.state IN ('Placing','Running') AND e.status IN ('Launching','Running'))
            OR (a.state='Reported' AND e.status='Terminal'))
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1)
     $$;


ALTER FUNCTION public.read_worker_attempt(in_secret_digest text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION reap_idle_session_attempts(in_epoch text, in_idle_secs bigint, in_max bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE idled record; reaped bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       reaped:=0;
       FOR idled IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ('Placing','Running') AND a.recovery_epoch=in_epoch
              AND a.idle_since IS NOT NULL
              AND a.idle_since < now() - make_interval(
                    secs => in_idle_secs::double precision)
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence='SessionIdle',ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=idled.attempt;
         PERFORM release_session_attempt_turns(
           idled.tenant,idled.project,idled.session,idled.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$;


ALTER FUNCTION public.reap_idle_session_attempts(in_epoch text, in_idle_secs bigint, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION reap_lapsed_session_attempts(in_epoch text, in_max bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE lapsed record; reaped bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       reaped:=0;
       FOR lapsed IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ('Placing','Running') AND a.recovery_epoch=in_epoch
              AND a.lease_expires_at < now()
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence='LeaseExpired',ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=lapsed.attempt;
         PERFORM release_session_attempt_turns(
           lapsed.tenant,lapsed.project,lapsed.session,lapsed.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$;


ALTER FUNCTION public.reap_lapsed_session_attempts(in_epoch text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_agentic_refusals(in_tenant text, in_project text, in_decision text, in_refusals jsonb, in_lifts jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE entry jsonb; standing record;
     BEGIN
       IF coalesce(jsonb_array_length(in_refusals),0)=0
          AND coalesce(jsonb_array_length(in_lifts),0)=0 THEN
         RETURN 'Recorded';
       END IF;
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
     END $$;


ALTER FUNCTION public.record_agentic_refusals(in_tenant text, in_project text, in_decision text, in_refusals jsonb, in_lifts jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_forge_installation(in_forge text, in_app text, in_account text, in_account_kind text, in_installation_id text, in_tenant text, in_authority_kind text, in_authority_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE existing forge_installation%ROWTYPE;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended(
       format('forge-installation:%L/%L/%L',in_forge,in_app,in_account),0));
     SELECT * INTO existing FROM forge_installation
      WHERE forge=in_forge AND app=in_app AND account=in_account;
     IF NOT FOUND THEN
       INSERT INTO forge_installation
         (forge,app,account,account_kind,installation_id,tenant,
          authority_kind,authority_subject)
         VALUES(in_forge,in_app,in_account,in_account_kind,in_installation_id,
                in_tenant,in_authority_kind,in_authority_subject);
       RETURN 'Recorded';
     END IF;
     IF existing.tenant<>in_tenant THEN RETURN 'ClaimedElsewhere'; END IF;
     IF existing.installation_id=in_installation_id
        AND existing.account_kind=in_account_kind
       THEN RETURN 'AlreadyRecorded'; END IF;
     UPDATE forge_installation
        SET installation_id=in_installation_id,account_kind=in_account_kind,
            authority_kind=in_authority_kind,authority_subject=in_authority_subject,
            claimed_at=now()
      WHERE forge=in_forge AND app=in_app AND account=in_account;
     RETURN 'Reinstalled';
   END $$;


ALTER FUNCTION public.record_forge_installation(in_forge text, in_app text, in_account text, in_account_kind text, in_installation_id text, in_tenant text, in_authority_kind text, in_authority_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_session_store_batch(in_secret_digest text, in_generation bigint, in_stream text, in_batch bigint, in_digest text, in_bytes bigint, in_events bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE bound record; existing record; highest bigint; held bigint;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_digest !~ '^[0-9a-f]{64}$'
          OR length(in_stream) NOT BETWEEN 1 AND 256
          OR in_stream ~ '[[:cntrl:]]' OR in_stream ~ '[[:space:]]' THEN
         RETURN 'Conflict';
       END IF;
       IF in_batch NOT BETWEEN 1 AND 65536
          OR in_bytes NOT BETWEEN 0 AND 65536
          OR in_events NOT BETWEEN 0 AND 65536 THEN
         RETURN 'QuotaExceeded';
       END IF;
       SELECT b.digest,b.bytes INTO existing FROM session_store_batch b
        WHERE b.tenant=bound.tenant AND project=bound.project AND session=bound.session AND b.stream=in_stream AND b.batch=in_batch;
       IF FOUND THEN
         RETURN CASE WHEN existing.digest=in_digest AND existing.bytes=in_bytes
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       SELECT coalesce(max(b.batch),0) INTO highest FROM session_store_batch b
        WHERE b.tenant=bound.tenant AND project=bound.project AND session=bound.session AND b.stream=in_stream;
       IF in_batch<>highest+1 THEN RETURN 'OutOfOrder'; END IF;
       SELECT coalesce(sum(b.bytes),0) INTO held FROM session_store_batch b
        WHERE b.tenant=bound.tenant AND project=bound.project AND session=bound.session;
       IF held+in_bytes>1073741824 THEN RETURN 'QuotaExceeded'; END IF;
       INSERT INTO session_store_batch
         (tenant,project,session,stream,batch,digest,bytes,events)
       VALUES(bound.tenant,bound.project,bound.session,in_stream,in_batch,
              in_digest,in_bytes,in_events);
       RETURN 'Stored';
     END $_$;


ALTER FUNCTION public.record_session_store_batch(in_secret_digest text, in_generation bigint, in_stream text, in_batch bigint, in_digest text, in_bytes bigint, in_events bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_worker_run_configuration(in_secret_digest text, in_generation bigint, in_path text, in_digest text, in_bytes bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE bound record; existing record;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF NOT (length(in_path) BETWEEN 1 AND 256
     AND in_path !~ '^/' AND in_path !~ '//' AND in_path !~ '[\\\\]'
     AND in_path !~ '(^|/)[.][.]?(/|$)' AND in_path !~ '[[:cntrl:]]'
     AND in_path !~ '(^|/)[[:space:]]' AND in_path !~ '[[:space:]](/|$)')
          OR in_digest !~ '^[0-9a-f]{64}$' THEN
         RETURN 'Conflict';
       END IF;
       IF in_bytes NOT BETWEEN 0 AND 1048576 THEN
         RETURN 'QuotaExceeded';
       END IF;
       SELECT configuration_path,configuration_digest,configuration_bytes
         INTO existing FROM execution_run WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
       IF NOT FOUND THEN
         INSERT INTO execution_run (tenant,project,execution,attempt,configuration_path,
             configuration_digest,configuration_bytes,configuration_recorded_at)
           VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,
                  in_path,in_digest,in_bytes,now());
         RETURN 'Stored';
       END IF;
       IF existing.configuration_path IS NULL THEN
         UPDATE execution_run SET configuration_path=in_path,
                configuration_digest=in_digest,configuration_bytes=in_bytes,
                configuration_recorded_at=now() WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
         RETURN 'Stored';
       END IF;
       RETURN CASE WHEN existing.configuration_digest=in_digest
                    AND existing.configuration_bytes=in_bytes
                   THEN 'AlreadyStored' ELSE 'Conflict' END;
     END $_$;


ALTER FUNCTION public.record_worker_run_configuration(in_secret_digest text, in_generation bigint, in_path text, in_digest text, in_bytes bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_worker_run_total(in_secret_digest text, in_generation bigint, in_turns bigint, in_duration_ms bigint, in_duration_api_ms bigint, in_tokens_input bigint, in_tokens_output bigint, in_tokens_cache_creation bigint, in_tokens_cache_read bigint, in_cost_usd_micros bigint, in_cost_basis text, in_permission_denials bigint, in_result_subtype text, in_stop_reason text, in_models jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE bound record; stored record; kept jsonb; offered_usage jsonb;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF jsonb_typeof(in_models) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_models) > 100
          OR (SELECT count(DISTINCT offered->>'model')
                FROM jsonb_array_elements(in_models) x(offered))
             <> jsonb_array_length(in_models)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_models) x(offered)
               WHERE jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR length(coalesce(offered->>'model','')) NOT BETWEEN 1 AND 128
                  OR coalesce(offered->>'model','') ~ '[[:cntrl:]]'
                  OR NOT (coalesce(offered->>'costUsdMicros','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'costUsdMicros','') ~ '^[0-9]+$'
               THEN (offered->>'costUsdMicros')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
                  OR NOT ((coalesce(offered->>'tokensInput','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensInput','') ~ '^[0-9]+$'
               THEN (offered->>'tokensInput')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensOutput','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensOutput','') ~ '^[0-9]+$'
               THEN (offered->>'tokensOutput')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensCacheCreation','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensCacheCreation','') ~ '^[0-9]+$'
               THEN (offered->>'tokensCacheCreation')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensCacheRead','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensCacheRead','') ~ '^[0-9]+$'
               THEN (offered->>'tokensCacheRead')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991))) THEN
         RETURN 'Conflict';
       END IF;
       INSERT INTO execution_run (tenant,project,execution,attempt)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       SELECT turns,duration_ms,duration_api_ms,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros,cost_basis,permission_denials,result_subtype,stop_reason INTO stored FROM execution_run_total WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
       IF FOUND THEN
         SELECT coalesce(jsonb_agg(jsonb_build_object('model',model,'tokensInput',tokens_input,'tokensOutput',tokens_output,'tokensCacheCreation',tokens_cache_creation,'tokensCacheRead',tokens_cache_read,'costUsdMicros',cost_usd_micros)
                                   ORDER BY model),'[]'::jsonb)
           INTO kept FROM execution_run_model_usage WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
         SELECT coalesce(jsonb_agg(jsonb_build_object('model',offered->>'model','tokensInput',(offered->>'tokensInput')::bigint,'tokensOutput',(offered->>'tokensOutput')::bigint,'tokensCacheCreation',(offered->>'tokensCacheCreation')::bigint,'tokensCacheRead',(offered->>'tokensCacheRead')::bigint,'costUsdMicros',(offered->>'costUsdMicros')::bigint)
                                   ORDER BY offered->>'model'),'[]'::jsonb)
           INTO offered_usage FROM jsonb_array_elements(in_models) x(offered);
         RETURN CASE WHEN (stored.turns,stored.duration_ms,stored.duration_api_ms,stored.tokens_input,stored.tokens_output,stored.tokens_cache_creation,stored.tokens_cache_read,stored.cost_usd_micros,stored.cost_basis,stored.permission_denials,stored.result_subtype,stored.stop_reason)
                       IS NOT DISTINCT FROM (in_turns,in_duration_ms,in_duration_api_ms,in_tokens_input,in_tokens_output,in_tokens_cache_creation,in_tokens_cache_read,in_cost_usd_micros,in_cost_basis,in_permission_denials,in_result_subtype,in_stop_reason)
                      AND kept IS NOT DISTINCT FROM offered_usage
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       INSERT INTO execution_run_total (tenant,project,execution,attempt,turns,duration_ms,duration_api_ms,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros,cost_basis,permission_denials,result_subtype,stop_reason)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,in_turns,in_duration_ms,in_duration_api_ms,in_tokens_input,in_tokens_output,in_tokens_cache_creation,in_tokens_cache_read,in_cost_usd_micros,in_cost_basis,in_permission_denials,in_result_subtype,in_stop_reason);
       INSERT INTO execution_run_model_usage
           (tenant,project,execution,attempt,model,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros)
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                offered->>'model',
                (offered->>'tokensInput')::bigint,
                (offered->>'tokensOutput')::bigint,
                (offered->>'tokensCacheCreation')::bigint,
                (offered->>'tokensCacheRead')::bigint,
                (offered->>'costUsdMicros')::bigint
           FROM jsonb_array_elements(in_models) x(offered);
       RETURN 'Stored';
     END $_$;


ALTER FUNCTION public.record_worker_run_total(in_secret_digest text, in_generation bigint, in_turns bigint, in_duration_ms bigint, in_duration_api_ms bigint, in_tokens_input bigint, in_tokens_output bigint, in_tokens_cache_creation bigint, in_tokens_cache_read bigint, in_cost_usd_micros bigint, in_cost_basis text, in_permission_denials bigint, in_result_subtype text, in_stop_reason text, in_models jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_worker_run_transcript_batch(in_secret_digest text, in_generation bigint, in_batch bigint, in_path text, in_digest text, in_bytes bigint, in_events bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE bound record; existing record; highest bigint;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF NOT (length(in_path) BETWEEN 1 AND 256
     AND in_path !~ '^/' AND in_path !~ '//' AND in_path !~ '[\\\\]'
     AND in_path !~ '(^|/)[.][.]?(/|$)' AND in_path !~ '[[:cntrl:]]'
     AND in_path !~ '(^|/)[[:space:]]' AND in_path !~ '[[:space:]](/|$)')
          OR in_digest !~ '^[0-9a-f]{64}$' THEN
         RETURN 'Conflict';
       END IF;
       IF in_batch NOT BETWEEN 1 AND 4096
          OR in_bytes NOT BETWEEN 0 AND 65536
          OR in_events NOT BETWEEN 0 AND 65536 THEN
         RETURN 'QuotaExceeded';
       END IF;
       INSERT INTO execution_run (tenant,project,execution,attempt)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       SELECT digest,bytes INTO existing FROM execution_run_transcript_batch
        WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt AND batch=in_batch;
       IF FOUND THEN
         RETURN CASE WHEN existing.digest=in_digest AND existing.bytes=in_bytes
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       SELECT coalesce(max(batch),0) INTO highest
         FROM execution_run_transcript_batch WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
       IF in_batch<>highest+1 THEN RETURN 'OutOfOrder'; END IF;
       INSERT INTO execution_run_transcript_batch
           (tenant,project,execution,attempt,batch,path,digest,bytes,events)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,
                in_batch,in_path,in_digest,in_bytes,in_events);
       RETURN 'Stored';
     END $_$;


ALTER FUNCTION public.record_worker_run_transcript_batch(in_secret_digest text, in_generation bigint, in_batch bigint, in_path text, in_digest text, in_bytes bigint, in_events bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION record_worker_run_turns(in_secret_digest text, in_generation bigint, in_turns jsonb) RETURNS TABLE(recorded text, turns bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'Fenced'::text,0::bigint; RETURN;
       END IF;
       IF jsonb_typeof(in_turns) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_turns) NOT BETWEEN 1 AND 100
          OR (SELECT count(DISTINCT offered->>'ordinal')
                FROM jsonb_array_elements(in_turns) x(offered))
             <> jsonb_array_length(in_turns)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_turns) x(offered)
               WHERE jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR NOT (coalesce(offered->>'ordinal','') ~ '^[0-9]+$')
                  OR (CASE WHEN coalesce(offered->>'ordinal','') ~ '^[0-9]+$'
                           THEN (offered->>'ordinal')::numeric ELSE 0 END)
                     NOT BETWEEN 1 AND 1000
                  OR length(coalesce(offered->>'model','')) NOT BETWEEN 1 AND 128
                  OR coalesce(offered->>'model','') ~ '[[:cntrl:]]'
                  OR NOT ((coalesce(offered->>'tokensInput','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensInput','') ~ '^[0-9]+$'
               THEN (offered->>'tokensInput')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensOutput','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensOutput','') ~ '^[0-9]+$'
               THEN (offered->>'tokensOutput')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensCacheCreation','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensCacheCreation','') ~ '^[0-9]+$'
               THEN (offered->>'tokensCacheCreation')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensCacheRead','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensCacheRead','') ~ '^[0-9]+$'
               THEN (offered->>'tokensCacheRead')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991))) THEN
         RETURN QUERY SELECT 'Conflict'::text,0::bigint; RETURN;
       END IF;
       INSERT INTO execution_run (tenant,project,execution,attempt)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       IF EXISTS(SELECT 1 FROM jsonb_array_elements(in_turns) x(offered)
                 JOIN execution_run_turn t
                   ON t.tenant=bound.tenant AND t.project=bound.project
                  AND t.execution=bound.execution AND t.attempt=bound.attempt
                  AND t.ordinal=(offered->>'ordinal')::bigint
                 WHERE (t.model,t.tokens_input,t.tokens_output,t.tokens_cache_creation,t.tokens_cache_read)
                    IS DISTINCT FROM
                       (offered->>'model',(offered->>'tokensInput')::bigint,(offered->>'tokensOutput')::bigint,(offered->>'tokensCacheCreation')::bigint,(offered->>'tokensCacheRead')::bigint)) THEN
         RETURN QUERY SELECT 'Conflict'::text,0::bigint; RETURN;
       END IF;
       INSERT INTO execution_run_turn
           (tenant,project,execution,attempt,ordinal,model,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read)
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                (offered->>'ordinal')::bigint,offered->>'model',
                (offered->>'tokensInput')::bigint,
                (offered->>'tokensOutput')::bigint,
                (offered->>'tokensCacheCreation')::bigint,
                (offered->>'tokensCacheRead')::bigint
           FROM jsonb_array_elements(in_turns) x(offered)
         ON CONFLICT DO NOTHING;
       RETURN QUERY SELECT 'Recorded'::text,coalesce(max(ordinal),0)::bigint
         FROM execution_run_turn WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
     END $_$;


ALTER FUNCTION public.record_worker_run_turns(in_secret_digest text, in_generation bigint, in_turns jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION release_draft_fenced(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_digest text, in_commit boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT d.* INTO current FROM draft d JOIN configuration_revision c
         ON c.tenant=d.tenant AND c.project=d.project AND c.revision=d.configuration_revision
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket
          AND c.digest=in_digest FOR UPDATE OF d;
       IF NOT FOUND OR current.state <> 'Draft' OR current.authoring_version <> in_expected
          OR current.configuration_revision <> in_configuration THEN RETURN false; END IF;
       IF in_commit THEN UPDATE draft SET state='Released'
         WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket; END IF;
       RETURN true;
     END $$;


ALTER FUNCTION public.release_draft_fenced(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_digest text, in_commit boolean) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION release_session_attempt_turns(in_tenant text, in_project text, in_session text, in_attempt text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       UPDATE session_turn t
          SET attempts_spent=t.attempts_spent+1,
              attempt=NULL,claim_generation=NULL,claimed_at=NULL,
              state=CASE WHEN t.attempts_spent+1>=3
                         THEN 'Failed' ELSE 'Queued' END,
              failure=CASE WHEN t.attempts_spent+1>=3
                           THEN 'AttemptLost' ELSE NULL END,
              ended_at=CASE WHEN t.attempts_spent+1>=3
                            THEN now() ELSE NULL END
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.attempt=in_attempt AND t.state='Claimed';
     END $$;


ALTER FUNCTION public.release_session_attempt_turns(in_tenant text, in_project text, in_session text, in_attempt text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION rename_member_thread(in_tenant text, in_project text, in_session text, in_title text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM 1 FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoThread'; END IF;
       UPDATE agent_session s
          SET member_title=nullif(btrim(coalesce(in_title,''),E' \t\r\n'),'')
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session;
       RETURN 'Renamed';
     END $$;


ALTER FUNCTION public.rename_member_thread(in_tenant text, in_project text, in_session text, in_title text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION request_finalization_approval(in_tenant text, in_project text, in_attempt text, in_action text, in_recovery_epoch text) RETURNS TABLE(result text, action text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; standing record; requested text; current_epoch text;
     BEGIN
       SELECT a.ticket, a.outcome, a.approval_required,
              f.state AS request_state, f.recovery_epoch AS request_epoch,
              f.authorizing_seq, f.effect_position, t.phase
         INTO bound
         FROM finalization_attempt a
         JOIN finalization_request f
           ON f.tenant = a.tenant AND f.project = a.project AND f.request = a.request
         LEFT JOIN ticket_projection t
           ON t.tenant = a.tenant AND t.project = a.project AND t.ticket = a.ticket
        WHERE a.tenant = in_tenant AND a.project = in_project AND a.attempt = in_attempt
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownAttempt'::text, NULL::text; RETURN;
       END IF;
       SELECT n.action INTO requested FROM native_action n
        WHERE n.tenant = in_tenant AND n.project = in_project AND n.attempt = in_attempt;
       IF requested IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadyRequested'::text, requested; RETURN;
       END IF;
       SELECT n.action, n.kind INTO standing FROM native_action n
        WHERE n.tenant = in_tenant AND n.project = in_project
          AND n.ticket = bound.ticket AND n.state = 'Open';
       IF standing.action IS NOT NULL AND standing.kind <> 'FinalizationApproval' THEN
         RETURN QUERY SELECT 'TicketHasAnOpenAction'::text, standing.action; RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.outcome <> 'Prepared'
          OR bound.approval_required IS NOT TRUE
          OR bound.request_state NOT IN ('Open', 'Registered')
          OR bound.request_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR bound.phase IS DISTINCT FROM 'Finalizing'
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text; RETURN;
       END IF;
       IF standing.action IS NOT NULL THEN
         UPDATE native_action n SET state = 'Withdrawn'
          WHERE n.tenant = in_tenant AND n.project = in_project
            AND n.action = standing.action AND n.state = 'Open';
       END IF;
       INSERT INTO native_action
         (tenant, project, action, authorizing_seq, effect_position, ticket,
          action_version, kind, reason, required_capability, attempt)
       VALUES (in_tenant, in_project, in_action, bound.authorizing_seq,
          bound.effect_position, bound.ticket, bound.authorizing_seq,
          'FinalizationApproval', 'NoReason', 'ApproveFinalization', in_attempt);
       INSERT INTO native_action_resolution (tenant, project, action, resolution)
       SELECT in_tenant, in_project, in_action,
              unnest(ARRAY['Approve', 'Decline']);
       RETURN QUERY SELECT 'Requested'::text, in_action;
     END $$;


ALTER FUNCTION public.request_finalization_approval(in_tenant text, in_project text, in_attempt text, in_action text, in_recovery_epoch text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION reserve_worker_artifact(in_secret_digest text, in_path text, in_digest text, in_bytes bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
       DECLARE bound record; existing record; used record;
       BEGIN
         SELECT a.tenant,a.project,a.execution,a.attempt,a.state,a.recovery_epoch,e.status
           INTO bound FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
          WHERE a.capability_secret_digest=in_secret_digest FOR UPDATE OF a;
         IF NOT FOUND OR bound.state NOT IN ('Placing','Running')
            OR bound.status NOT IN ('Launching','Running')
            OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1) THEN
           RETURN 'Fenced';
         END IF;
         IF length(in_path) NOT BETWEEN 1 AND 256
            OR in_path ~ '^/' OR in_path ~ '//' OR in_path ~ '[\\\\]'
            OR in_path ~ '(^|/)[.][.]?(/|$)' OR in_path ~ '[[:cntrl:]]'
            OR in_path ~ '(^|/)[[:space:]]' OR in_path ~ '[[:space:]](/|$)'
            OR in_digest !~ '^[0-9a-f]{64}$'
            OR in_bytes NOT BETWEEN 0 AND 1073741824 THEN
           RETURN 'Conflict';
         END IF;
         SELECT digest,bytes INTO existing FROM worker_artifact_reservation
          WHERE tenant=bound.tenant AND project=bound.project
            AND execution=bound.execution AND attempt=bound.attempt AND path=in_path;
         IF FOUND THEN
           RETURN CASE WHEN existing.digest=in_digest AND existing.bytes=in_bytes
                       THEN 'Reserved' ELSE 'Conflict' END;
         END IF;
         SELECT count(*)::bigint AS artifacts,coalesce(sum(bytes),0)::bigint AS bytes
           INTO used FROM worker_artifact_reservation
          WHERE tenant=bound.tenant AND project=bound.project
            AND execution=bound.execution AND attempt=bound.attempt;
         IF used.artifacts+1>256
            OR used.bytes+in_bytes>5368709120 THEN
           RETURN 'QuotaExceeded';
         END IF;
         INSERT INTO worker_artifact_reservation
           (tenant,project,execution,attempt,path,digest,bytes)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,
                in_path,in_digest,in_bytes);
         RETURN 'Reserved';
       END $_$;


ALTER FUNCTION public.reserve_worker_artifact(in_secret_digest text, in_path text, in_digest text, in_bytes bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION result_digest_fold(in_digest text) RETURNS bigint
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
       SELECT ('x' || substr(in_digest, 1, 13))
              ::bit(52)::bigint + 1
     $$;


ALTER FUNCTION public.result_digest_fold(in_digest text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION retire_project_repository(in_tenant text, in_project text, in_repository text) RETURNS TABLE(outcome text, repository text, bound_at timestamp with time zone, landing_mode text, retired_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::timestamptz; RETURN;
     END IF;
     IF standing.retired_at IS NULL THEN
       UPDATE project_repository b SET retired_at=now()
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_repository
        RETURNING b.retired_at INTO standing.retired_at;
     END IF;
     RETURN QUERY SELECT 'Retired',standing.repository,standing.bound_at,
       standing.landing_mode,standing.retired_at;
   END $$;


ALTER FUNCTION public.retire_project_repository(in_tenant text, in_project text, in_repository text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION review_selector_proposal(in_decision text, in_tenant text, in_project text, in_review text, in_reviewer_kind text, in_reviewer_subject text, in_feedback text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           IF in_review='Approved' THEN
             UPDATE selector_proposal_delivery SET state='Pending',retry_at=now()
               WHERE selector_decision=in_decision AND tenant=in_tenant AND project=in_project
                 AND state='AwaitingApproval';
           ELSIF in_review='Rejected' THEN
             UPDATE selector_proposal_delivery SET state='Terminal',outcome=json_build_object(
                 'state','RejectedByUser','feedback',in_feedback)::text
               WHERE selector_decision=in_decision AND tenant=in_tenant AND project=in_project
                 AND state='AwaitingApproval';
           ELSE RAISE EXCEPTION 'invalid selector proposal review';
           END IF;
           IF FOUND THEN
             INSERT INTO selector_proposal_review
               (selector_decision,tenant,project,outcome,reviewer_kind,reviewer_subject,feedback)
             VALUES (in_decision,in_tenant,in_project,in_review,
               in_reviewer_kind,in_reviewer_subject,in_feedback);
           END IF;
           RETURN FOUND;
         END $$;


ALTER FUNCTION public.review_selector_proposal(in_decision text, in_tenant text, in_project text, in_review text, in_reviewer_kind text, in_reviewer_subject text, in_feedback text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) RETURNS TABLE(result text, authoring_version bigint, state text)
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
       IF in_authoring::jsonb->'value'->>'finalizer' = 'NoFinalizer' THEN
         IF in_finalization_mode IS NOT NULL OR in_finalization_target IS NOT NULL THEN
           RAISE EXCEPTION 'a ticket with no finalizer lands nothing'
             USING ERRCODE='check_violation';
         END IF;
       ELSE
         landing := coalesce(in_finalization_mode,
       (SELECT b.landing_mode FROM project_repository b
         WHERE b.tenant=in_tenant AND b.project=in_project
           AND b.repository=in_repository),
       'Push');
         target := in_finalization_target;
         IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
           RETURN QUERY SELECT 'LandingUnbranched',current.authoring_version,current.state; RETURN;
         END IF;
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
     END $$;


ALTER FUNCTION public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION selector_project_dispatch_mode(in_tenant text, in_project text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT coalesce(overrides.dispatch_mode,installation.dispatch_mode)
         FROM selector_runtime_settings installation
         LEFT JOIN selector_project_settings overrides
           ON overrides.tenant=in_tenant AND overrides.project=in_project
        WHERE installation.singleton=1
     $$;


ALTER FUNCTION public.selector_project_dispatch_mode(in_tenant text, in_project text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION selector_refusal_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM append_project_change(
         NEW.tenant,NEW.project,'AgenticRefusal',NEW.ticket::text,
         CASE NEW.event WHEN 'Refused' THEN 'TicketRefused'
                        WHEN 'Lifted' THEN 'RefusalLifted' END);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.selector_refusal_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION selector_refusal_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       RAISE EXCEPTION
         'refusal % of ticket % is written once, and a ledger that could be edited is not a record',
         OLD.ordinal, OLD.ticket USING ERRCODE = 'integrity_constraint_violation';
     END $$;


ALTER FUNCTION public.selector_refusal_is_immutable() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_attempt_binding(in_secret_digest text, in_generation bigint) RETURNS TABLE(tenant text, project text, session text, attempt text, kind text, principal text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,
              a.state AS attempt_state,a.recovery_epoch,s.state AS session_state,
              s.kind,s.principal
         INTO bound FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest FOR UPDATE OF a;
       IF NOT FOUND OR bound.attempt_state NOT IN ('Placing','Running')
          OR bound.session_state<>'Open' OR bound.generation<>in_generation
          OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN
         RETURN;
       END IF;
       RETURN QUERY SELECT bound.tenant,bound.project,bound.session,bound.attempt,
                           bound.kind,bound.principal;
     END $$;


ALTER FUNCTION public.session_attempt_binding(in_secret_digest text, in_generation bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_attempt_cleanup_completed(in_attempt text, in_generation bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       UPDATE session_attempt a SET cleanup_completed_at=now()
        WHERE a.attempt=in_attempt AND a.generation=in_generation
          AND a.state NOT IN ('Placing','Running') AND a.cleanup_completed_at IS NULL;
       RETURN FOUND;
     END $$;


ALTER FUNCTION public.session_attempt_cleanup_completed(in_attempt text, in_generation bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_attempt_is_fenced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF OLD.state NOT IN ('Placing','Running') THEN
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
     END $$;`,
  `CREATE FUNCTION session_attempt_turn_failure(in_attempt text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT (SELECT t.failure FROM session_turn t
     WHERE t.tenant=a.tenant AND t.project=a.project AND t.session=a.session
       AND t.state IN ('Answered','Failed') AND t.ended_at>=a.opened_at
     ORDER BY t.ended_at DESC,t.ordinal DESC LIMIT 1) FROM session_attempt a
        WHERE a.attempt=in_attempt
     $$;


ALTER FUNCTION public.session_attempt_turn_failure(in_attempt text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_attempts_awaiting_cleanup(in_max bigint) RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation FROM session_attempt a
        WHERE a.state NOT IN ('Placing','Running') AND a.placement IS NOT NULL
          AND a.cleanup_completed_at IS NULL
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$;


ALTER FUNCTION public.session_attempts_awaiting_cleanup(in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_attempts_awaiting_observation(in_epoch text, in_max bigint) RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation
         FROM session_attempt a
        WHERE a.state='Running' AND a.placement IS NOT NULL
          AND a.recovery_epoch=in_epoch AND in_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$;


ALTER FUNCTION public.session_attempts_awaiting_observation(in_epoch text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_state_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM append_project_change(NEW.tenant,NEW.project,'Session',
         jsonb_build_object('session',NEW.session,'kind',NEW.kind,
                           'state',NEW.state)::text);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.session_state_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_store_batch_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE named text;
     BEGIN
       SELECT s.kind INTO named FROM agent_session s
        WHERE s.tenant=NEW.tenant AND s.project=NEW.project
          AND s.session=NEW.session;
       PERFORM append_project_change(NEW.tenant,NEW.project,'Session',
         jsonb_build_object('session',NEW.session,'kind',named,
                           'stream',NEW.stream,'batch',NEW.batch)::text);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.session_store_batch_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION session_store_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       RAISE EXCEPTION
         'store batch % of stream % is written once, and a transcript that could be edited is not a memory',
         OLD.batch, OLD.stream USING ERRCODE = 'integrity_constraint_violation';
     END $$;`,
  `CREATE FUNCTION session_turn_appends_a_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE named text;
     BEGIN
       SELECT s.kind INTO named FROM agent_session s
        WHERE s.tenant=NEW.tenant AND s.project=NEW.project
          AND s.session=NEW.session;
       PERFORM append_project_change(NEW.tenant,NEW.project,'Session',
         jsonb_build_object('session',NEW.session,'kind',named,
                           'turn',NEW.turn)::text);
       RETURN NULL;
     END $$;


ALTER FUNCTION public.session_turn_appends_a_change() OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION sessions_awaiting_placement(in_epoch text, in_max bigint) RETURNS TABLE(tenant text, project text, session text, kind text, principal text, parent_session text, agent_reference text, capabilities text[], credential_slot text, account text, cluster text, state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.tenant,s.project,s.session,s.kind,s.principal,s.parent_session,
              s.agent_reference,s.capabilities,s.credential_slot,s.account,s.cluster,s.state
         FROM agent_session s
        WHERE s.state='Open'
          AND in_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM session_turn t
                      WHERE t.tenant=s.tenant AND t.project=s.project
                        AND t.session=s.session AND t.state='Queued')
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                      WHERE a.tenant=s.tenant AND a.project=s.project
                        AND a.session=s.session AND a.state IN ('Placing','Running'))
        ORDER BY s.tenant,s.project,s.session
        LIMIT in_max
     $$;


ALTER FUNCTION public.sessions_awaiting_placement(in_epoch text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION set_project_repository_landing(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text) RETURNS TABLE(outcome text, repository text, bound_at timestamp with time zone, landing_mode text, retired_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::timestamptz; RETURN;
     END IF;
     IF standing.landing_mode<>in_expected_mode AND standing.landing_mode<>in_mode THEN
       RETURN QUERY SELECT 'LandingMoved',standing.repository,standing.bound_at,
         standing.landing_mode,standing.retired_at; RETURN;
     END IF;
     UPDATE project_repository b SET landing_mode=in_mode
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     RETURN QUERY SELECT 'Written',standing.repository,standing.bound_at,in_mode,
       standing.retired_at;
   END $$;


ALTER FUNCTION public.set_project_repository_landing(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION set_selector_host_readiness(in_ready boolean) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
           UPDATE selector_runtime_readiness
             SET production_host=in_ready,checked_at=now() WHERE singleton=1
         $$;


ALTER FUNCTION public.set_selector_host_readiness(in_ready boolean) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION set_session_capabilities(in_tenant text, in_project text, in_session text, in_capabilities text[]) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
     END $$;


ALTER FUNCTION public.set_session_capabilities(in_tenant text, in_project text, in_session text, in_capabilities text[]) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION set_session_system_prompt(in_tenant text, in_project text, in_prompt text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record;
     BEGIN
       SELECT s.session,s.system_prompt INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead' AND candidate.state='Open')
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoLead'; END IF;
       IF held.system_prompt IS NOT DISTINCT FROM in_prompt THEN
         RETURN 'Unchanged';
       END IF;
       UPDATE agent_session s SET system_prompt=in_prompt
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=held.session;
       RETURN 'Set';
     END $$;


ALTER FUNCTION public.set_session_system_prompt(in_tenant text, in_project text, in_prompt text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) RETURNS TABLE(ticket bigint, ticket_version bigint, reason text, selector_decision text, recorded_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
        LIMIT least(coalesce(in_max,33),
                    33)
     $$;


ALTER FUNCTION public.standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION standing_agentic_refusals_among(in_tenant text, in_project text, in_tickets bigint[]) RETURNS TABLE(ticket bigint, ticket_version bigint, reason text, selector_decision text, recorded_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF coalesce(array_length(in_tickets,1),0)>100 THEN
         RAISE EXCEPTION 'a standing refusal read names at most % tickets',
           100 USING ERRCODE = 'invalid_parameter_value';
       END IF;
       RETURN QUERY
         SELECT latest.ticket,latest.ticket_version,latest.reason,
                latest.selector_decision,latest.recorded_at
           FROM (SELECT DISTINCT ON (r.ticket)
                        r.ticket,r.event,r.ticket_version,r.reason,
                        r.selector_decision,r.recorded_at
                   FROM selector_agentic_refusal r
                  WHERE r.tenant=in_tenant AND r.project=in_project
                    AND r.ticket=ANY(in_tickets)
                  ORDER BY r.ticket,r.ordinal DESC) latest
          WHERE latest.event='Refused'
          ORDER BY latest.ticket;
     END $$;


ALTER FUNCTION public.standing_agentic_refusals_among(in_tenant text, in_project text, in_tickets bigint[]) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION store_worker_result_report(in_secret_digest text, in_manifest text, in_report text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       BEGIN
         INSERT INTO execution_result_report(tenant,project,manifest,report)
           SELECT r.tenant,r.project,r.manifest,in_report
             FROM execution_attempt a
             JOIN execution_result r
               ON r.tenant=a.tenant AND r.project=a.project
              AND r.attempt=a.attempt AND r.manifest=in_manifest
            WHERE a.capability_secret_digest=in_secret_digest
              AND r.schema_version>=3
           ON CONFLICT DO NOTHING;
         IF FOUND THEN RETURN true; END IF;
         RETURN EXISTS(
           SELECT 1 FROM execution_attempt a
           JOIN execution_result_report r
             ON r.tenant=a.tenant AND r.project=a.project
            AND r.manifest=in_manifest AND r.report=in_report
           WHERE a.capability_secret_digest=in_secret_digest);
       END $$;


ALTER FUNCTION public.store_worker_result_report(in_secret_digest text, in_manifest text, in_report text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       IF in_outcome NOT IN ('FinalizationSucceeded', 'FinalizationFailed', 'PromotionAccepted', 'HandoffPublicationUnproven') THEN
         RAISE EXCEPTION 'finalization outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       scoped_digest := encode(sha256(convert_to('finalization:' || in_request, 'UTF8')), 'hex');
       SELECT f.ticket, f.state, f.request_generation, f.recovery_epoch, f.kind,
              a.attempt, a.outcome AS attempt_outcome, a.failure_kind,
              p.state AS permit_state, r.verdict
         INTO bound
         FROM finalization_request f
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
          OR bound.attempt IS NULL
          OR NOT (
            (in_outcome = 'FinalizationFailed'
              AND bound.kind IN ('RunFinalizer', 'PromoteForHandoff')
              AND bound.attempt_outcome = 'Failed'
              AND bound.failure_kind IS NOT DISTINCT FROM in_failure_kind)
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind IN ('RunFinalizer', 'PublishHandoff')
              AND in_failure_kind IS NULL
              AND bound.attempt_outcome = 'Prepared'
              AND bound.permit_state IS NOT DISTINCT FROM 'Concluded'
              AND bound.verdict IS NOT DISTINCT FROM 'Promoted')
            OR (in_outcome = 'PromotionAccepted'
              AND bound.kind = 'PromoteForHandoff'
              AND in_failure_kind IS NULL
              AND bound.attempt_outcome = 'Prepared'
              AND bound.permit_state IS NOT DISTINCT FROM 'Concluded'
              AND bound.verdict IS NOT DISTINCT FROM 'Promoted')
            OR (in_outcome = 'HandoffPublicationUnproven'
              AND bound.kind = 'PublishHandoff'
              AND in_failure_kind IS NULL
              AND ((bound.attempt_outcome = 'Failed')
                OR (bound.attempt_outcome = 'Prepared'
                  AND bound.permit_state IS NOT DISTINCT FROM 'Granted'
                  AND bound.verdict IS NOT DISTINCT FROM 'Unreadable'))))
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
         'attempt', in_attempt, 'requestGeneration', in_request_generation,
         'recoveryEpoch', in_recovery_epoch, 'outcome', in_outcome);
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
     END $$;


ALTER FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; command_tag text;
     BEGIN
       IF in_outcome NOT IN ('Passed', 'Failed', 'Blocked') THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict, r.manifest_ordinal, r.schema_version
         INTO bound
         FROM execution e
         JOIN execution_request q
           ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
         LEFT JOIN execution_result r
           ON r.tenant = e.tenant AND r.project = e.project AND r.execution = e.execution
        WHERE e.tenant = in_tenant AND e.project = in_project AND e.execution = in_execution
        FOR UPDATE OF e;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownExecution'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF bound.completion_operation IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, bound.completion_operation::text,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = bound.completion_operation);
         RETURN;
       END IF;
       IF bound.status IN ('Terminal', 'Cancelled')
          OR bound.ticket <> in_ticket OR bound.task <> in_task
          OR bound.effect_position <> in_source_effect
          OR (in_outcome = 'Blocked') <> (in_manifest IS NULL)
          OR (in_outcome = 'Blocked') <> (in_reason IS NOT NULL)
          OR (in_reason IS NOT NULL AND in_reason NOT IN ('ExecutionPolicyDenied', 'TicketConfigIncompatible', 'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported', 'RequiredCapabilityUnavailable'))
          OR (in_manifest IS NOT NULL
              AND (bound.manifest IS DISTINCT FROM in_manifest
                   OR bound.digest IS DISTINCT FROM in_manifest_digest))
          OR (in_outcome <> 'Blocked'
              AND (bound.verdict IS NULL
                   OR (in_outcome = 'Passed') <> (bound.verdict = 'Pass')))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF in_outcome = 'Blocked' THEN
         command_tag := 'ExecutionBlocked';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'ExecutionBlocked', 'value',
             jsonb_build_object('ticket', bound.ticket, 'reason', in_reason)));
       ELSE
         command_tag := 'TaskDone';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'TaskDone', 'value',
             jsonb_build_object('ticket', bound.ticket, 'tid', bound.task,
               'verdict', bound.verdict,
               'result', jsonb_build_object(
                 'manifest', bound.manifest_ordinal,
                 'digest', result_digest_fold(bound.digest),
                 'schema', bound.schema_version))));
       END IF;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the completion this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, 'ExecutionScheduler',
          in_authority_subject, 'CorrectnessReducing', 'scheduler-v1',
          encode(sha256(convert_to('execution:' || in_execution, 'UTF8')), 'hex'),
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, command_tag);
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       UPDATE execution
          SET status = 'Terminal', outcome = in_outcome, blocked_reason = in_reason,
              result_manifest = in_manifest, completion_operation = in_operation,
              terminal_at = now()
        WHERE tenant = in_tenant AND project = in_project AND execution = in_execution;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$;


ALTER FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_operation text) RETURNS TABLE(terminalized text, outcome text, operation text, incident text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
       DECLARE bound record; next_manifest bigint; submitted record; incident_id text;
         settled_outcome text; submitted_artifact jsonb; project_lifecycle text;
       BEGIN
         SELECT a.tenant,a.project,a.execution,e.source_request INTO bound
           FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
          WHERE a.capability_secret_digest=in_secret_digest;
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         PERFORM 1 FROM execution_request q
          WHERE q.tenant=bound.tenant AND q.project=bound.project
            AND q.request=bound.source_request FOR UPDATE;
         SELECT a.tenant,a.project,a.execution,a.attempt,a.manifest,a.state,a.recovery_epoch,
                e.status,e.outcome,e.result_manifest,e.completion_operation,e.ticket,e.task,
                e.source_request,q.effect_position
           INTO bound FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
           JOIN execution_request q ON q.tenant=e.tenant AND q.project=e.project
                                   AND q.request=e.source_request
          WHERE a.capability_secret_digest=in_secret_digest
          FOR UPDATE OF e;
         IF NOT FOUND OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch
                                                ORDER BY ordinal DESC LIMIT 1)
            OR bound.state NOT IN ('Placing','Running','Reported') THEN
           RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         IF bound.status='Cancelled' THEN
           RETURN QUERY SELECT 'Cancelled'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         IF bound.status='Terminal' THEN
           IF bound.result_manifest=in_manifest AND EXISTS(
             SELECT 1 FROM execution_result r WHERE r.tenant=bound.tenant
              AND r.project=bound.project AND r.manifest=in_manifest AND r.digest=in_digest) THEN
             RETURN QUERY SELECT 'AlreadyTerminal'::text,bound.outcome::text,
                                 bound.completion_operation::text,NULL::text; RETURN;
           END IF;
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ConflictingResult');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF bound.manifest<>in_manifest OR in_generation IS DISTINCT FROM (
              SELECT generation FROM execution_attempt WHERE capability_secret_digest=in_secret_digest)
            OR in_verdict NOT IN ('Pass','Fail') THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF jsonb_typeof(in_artifacts) IS DISTINCT FROM 'array' THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF jsonb_array_length(in_artifacts)>256
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
              WHERE jsonb_typeof(artifact) IS DISTINCT FROM 'object'
                 OR artifact->>'role' NOT IN ('Handoff','Diagnostic')
                 OR NOT (coalesce(artifact->>'ordinal','') ~ '^[0-9]+$')
                 OR CASE WHEN coalesce(artifact->>'ordinal','') ~ '^[0-9]+$'
                         THEN (artifact->>'ordinal')::numeric NOT BETWEEN 1 AND 256
                         ELSE true END
                 OR length(coalesce(artifact->>'path','')) NOT BETWEEN 1 AND 256
                 OR coalesce(artifact->>'path','') ~ '^/'
                 OR coalesce(artifact->>'path','') ~ '//'
                 OR coalesce(artifact->>'path','') ~ '[\\\\]'
                 OR coalesce(artifact->>'path','') ~ '(^|/)[.][.]?(/|$)'
                 OR coalesce(artifact->>'path','') ~ '[[:cntrl:]]'
                 OR coalesce(artifact->>'path','') ~ '(^|/)[[:space:]]'
                 OR coalesce(artifact->>'path','') ~ '[[:space:]](/|$)'
                 OR coalesce(artifact->>'digest','') !~ '^[0-9a-f]{64}$'
                 OR NOT (coalesce(artifact->>'bytes','') ~ '^[0-9]+$')
                 OR CASE WHEN coalesce(artifact->>'bytes','') ~ '^[0-9]+$'
                         THEN (artifact->>'bytes')::numeric NOT BETWEEN 0 AND 1073741824
                         ELSE true END)
            OR (SELECT count(DISTINCT artifact->>'ordinal')
                  FROM jsonb_array_elements(in_artifacts) x(artifact))
               <>jsonb_array_length(in_artifacts)
            OR (SELECT count(DISTINCT artifact->>'path')
                  FROM jsonb_array_elements(in_artifacts) x(artifact))
               <>jsonb_array_length(in_artifacts)
            OR (SELECT coalesce(sum(CASE
                    WHEN coalesce(artifact->>'bytes','') ~ '^[0-9]+$'
                    THEN (artifact->>'bytes')::numeric
                    ELSE 5368709121 END),0)
                  FROM jsonb_array_elements(in_artifacts) x(artifact))>5368709120 THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF EXISTS(SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
              WHERE NOT EXISTS(SELECT 1 FROM worker_artifact_reservation r
                WHERE r.tenant=bound.tenant AND r.project=bound.project
                  AND r.execution=bound.execution AND r.attempt=bound.attempt
                  AND r.path=artifact->>'path' AND r.digest=artifact->>'digest'
                  AND r.bytes=(artifact->>'bytes')::bigint)) THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         SELECT lifecycle INTO STRICT project_lifecycle FROM project
          WHERE tenant=bound.tenant AND project=bound.project FOR UPDATE;
         IF project_lifecycle='Retention' THEN
           RETURN QUERY SELECT 'NotAdmitted'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         UPDATE execution_attempt SET state='Reported',ended_at=now(),lease_owner=NULL,
              lease_expires_at=NULL WHERE capability_secret_digest=in_secret_digest
              AND state IN ('Placing','Running');
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         UPDATE project SET manifest_next=manifest_next+1
          WHERE tenant=bound.tenant AND project=bound.project
          RETURNING manifest_next-1 INTO next_manifest;
         INSERT INTO execution_result(tenant,project,manifest,execution,attempt,manifest_ordinal,
                                      schema_version,digest,verdict)
           VALUES(bound.tenant,bound.project,in_manifest,bound.execution,bound.attempt,next_manifest,
                  in_schema,in_digest,in_verdict);
         FOR submitted_artifact IN SELECT value FROM jsonb_array_elements(in_artifacts) LOOP
           INSERT INTO execution_result_artifact(tenant,project,manifest,ordinal,role,path,digest,bytes)
             VALUES(bound.tenant,bound.project,in_manifest,(submitted_artifact->>'ordinal')::integer,
                    submitted_artifact->>'role',submitted_artifact->>'path',submitted_artifact->>'digest',
                    (submitted_artifact->>'bytes')::bigint);
         END LOOP;
         settled_outcome=CASE in_verdict WHEN 'Pass' THEN 'Passed' ELSE 'Failed' END;
         SELECT result,s.operation INTO submitted FROM submit_task_completion(
           bound.tenant,bound.project,bound.execution,bound.ticket,bound.task,bound.effect_position,
           settled_outcome,in_manifest,in_digest,NULL,in_operation,'chuggy_worker_plane') s;
         IF submitted.result NOT IN ('Submitted','AlreadySubmitted') THEN
           RAISE EXCEPTION 'worker completion binding was refused: %',submitted.result
             USING ERRCODE='integrity_constraint_violation';
         END IF;
         UPDATE execution_request q SET state='Fulfilled'
          WHERE q.tenant=bound.tenant AND q.project=bound.project AND q.request=bound.source_request
            AND q.state='Registered' AND NOT EXISTS(SELECT 1 FROM execution e
              WHERE e.tenant=q.tenant AND e.project=q.project AND e.source_request=q.request
                AND e.status NOT IN ('Terminal','Cancelled'));
         RETURN QUERY SELECT CASE submitted.result WHEN 'Submitted' THEN 'Terminalized'
                           ELSE 'AlreadyTerminal' END,settled_outcome,submitted.operation,NULL::text;
       END $_$;


ALTER FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_operation text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_source jsonb, in_operation text) RETURNS TABLE(terminalized text, outcome text, operation text, incident text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
       DECLARE submitted record; bound record; incident_id text;
       BEGIN
         IF in_source IS NOT NULL AND (
              in_verdict<>'Pass'
              OR CASE WHEN jsonb_typeof(in_artifacts)='array' THEN EXISTS(
                   SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
                    WHERE artifact->>'role'='Handoff') ELSE true END
              OR jsonb_typeof(in_source) IS DISTINCT FROM 'object'
              OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(in_source) key)
                 IS DISTINCT FROM ARRAY['base','commit','ref','repository']::text[]
              OR length(coalesce(in_source->>'repository','')) NOT BETWEEN 1 AND 256
              OR length(coalesce(in_source->>'ref','')) NOT BETWEEN 1 AND 256
              OR coalesce(in_source->>'commit','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
              OR coalesce(in_source->>'base','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
              OR NOT EXISTS (
                SELECT 1 FROM execution_attempt a
                JOIN execution e
                  ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
                JOIN execution_request q
                  ON q.tenant=e.tenant AND q.project=e.project AND q.request=e.source_request
                JOIN input_bundle_reference b
                  ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                     AND b.reference_kind='TargetCommit'
               WHERE a.capability_secret_digest=in_secret_digest
                 AND b.reference_id=in_source->>'base')) THEN
           SELECT a.tenant,a.project,a.execution,a.attempt INTO bound
             FROM execution_attempt a WHERE a.capability_secret_digest=in_secret_digest;
           IF NOT FOUND THEN
             RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
           END IF;
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         SELECT * INTO submitted FROM submit_worker_result(
           in_secret_digest,in_generation,in_manifest,in_schema,in_digest,in_verdict,
           in_artifacts,in_operation);
         IF submitted.terminalized='Terminalized' AND in_source IS NOT NULL THEN
           SELECT a.tenant,a.project,a.execution INTO STRICT bound FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest;
           INSERT INTO execution_result_source
             (tenant,project,manifest,repository,ref,commit,base,expected_base)
             SELECT bound.tenant,bound.project,in_manifest,in_source->>'repository',
                    in_source->>'ref',in_source->>'commit',in_source->>'base',b.reference_id
               FROM execution e
               JOIN execution_request q
                 ON q.tenant=e.tenant AND q.project=e.project AND q.request=e.source_request
               JOIN input_bundle_reference b
                 ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                    AND b.reference_kind='TargetCommit'
              WHERE e.tenant=bound.tenant AND e.project=bound.project
                AND e.execution=bound.execution;
         END IF;
         RETURN QUERY SELECT submitted.terminalized,submitted.outcome,
                             submitted.operation,submitted.incident;
       END $_$;


ALTER FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_source jsonb, in_operation text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION sweep_project_change(in_limit bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE removed bigint; cutoff bigint;
       retention_max constant bigint := 100000;
     BEGIN
       IF in_limit IS NULL OR in_limit < 1 THEN
         RAISE EXCEPTION 'a change sweep removes at least one row or is not a sweep'
           USING ERRCODE = 'invalid_parameter_value';
       END IF;
       SELECT sequence INTO cutoff FROM project_change
        ORDER BY sequence DESC OFFSET retention_max LIMIT 1;
       IF cutoff IS NULL THEN RETURN 0; END IF;
       DELETE FROM project_change
        WHERE sequence IN (SELECT stale.sequence FROM project_change AS stale
                            WHERE stale.sequence <= cutoff
                            ORDER BY stale.sequence LIMIT in_limit);
       GET DIAGNOSTICS removed = ROW_COUNT;
       RETURN removed;
     END $$;


ALTER FUNCTION public.sweep_project_change(in_limit bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION thread_wake_candidates(in_after bigint, in_max bigint) RETURNS TABLE(sequence bigint, tenant text, project text, kind text, resource text, reason text, principal text, session text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT c.sequence,c.tenant,c.project,c.kind,c.resource,c.wake_reason,
              s.principal,s.session
         FROM project_change c
         JOIN agent_session s
           ON s.tenant=c.tenant AND s.project=c.project
          AND s.kind='Thread' AND s.state='Open'
          AND c.sequence>s.opened_after_sequence
        WHERE c.sequence>coalesce(in_after,0)
          AND c.wake_reason IS NOT NULL
          AND EXISTS(SELECT 1 FROM draft_revision r
                      WHERE r.tenant=c.tenant AND r.project=c.project
                        AND r.ticket::text=c.resource
                        AND r.authority_kind='Member'
                        AND r.authority_subject=s.principal)
        ORDER BY c.sequence,s.session
        LIMIT least(coalesce(in_max,64),
                    64)
     $$;


ALTER FUNCTION public.thread_wake_candidates(in_after bigint, in_max bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION ticket_command_is_valid(command jsonb) RETURNS boolean
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
             AND jsonb_typeof(command->'attempt') = 'string'
             AND length(command->>'attempt') BETWEEN 1 AND 256
             AND command_integer(command->'requestGeneration')
             AND (command->>'requestGeneration')::numeric >= 1
             AND jsonb_typeof(command->'recoveryEpoch') = 'string'
             AND length(command->>'recoveryEpoch') BETWEEN 1 AND 256
             AND command->>'outcome' IN ('FinalizationSucceeded', 'FinalizationFailed', 'PromotionAccepted', 'HandoffPublicationUnproven');
         END IF;
         RETURN public_ticket_command_is_valid(command)
           AND (command->>'command' <> 'Decide'
             OR command->'event'->>'type' NOT IN ('FinalizationResult', 'AbandonHandoff'));
       END $$;


ALTER FUNCTION public.ticket_command_is_valid(command jsonb) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION update_selector_project_settings(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text) RETURNS TABLE(revision bigint, north_star text, thread_standing_rules text, mode text, dispatch_mode text, base_prompt text, model_allowlist text, tool_allowlist text, tokens_per_decision bigint, milliseconds_per_decision bigint, tool_calls_per_decision bigint, dispatches_per_decision bigint, input_bytes_per_decision bigint, candidate_pages_per_decision bigint, operational_context_max_age_ms bigint, installation_revision bigint, installation_mode text, installation_dispatch_mode text, installation_base_prompt text, installation_controls text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE written bigint; standing bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'selector-settings:'||length(in_tenant)||':'||in_tenant||in_project,0));
       SELECT settings.revision INTO standing FROM selector_project_settings settings
         WHERE settings.tenant=in_tenant AND settings.project=in_project;
       IF coalesce(standing,0)<>expected_revision THEN RETURN; END IF;
       IF expected_revision=0 THEN
         INSERT INTO selector_project_settings
           (tenant,project,revision,north_star,thread_standing_rules,mode,dispatch_mode,
            base_prompt,model_allowlist,tool_allowlist,tokens_per_decision,
            milliseconds_per_decision,tool_calls_per_decision,
            dispatches_per_decision,input_bytes_per_decision,
            candidate_pages_per_decision,operational_context_max_age_ms)
           VALUES (in_tenant,in_project,1,new_north_star,new_thread_standing_rules,
            new_mode,new_dispatch_mode,
            new_base_prompt,new_model_allowlist,new_tool_allowlist,
            new_tokens_per_decision,new_milliseconds_per_decision,
            new_tool_calls_per_decision,new_dispatches_per_decision,
            new_input_bytes_per_decision,
            new_candidate_pages_per_decision,new_operational_context_max_age_ms)
           RETURNING selector_project_settings.revision INTO written;
       ELSE
         UPDATE selector_project_settings SET revision=selector_project_settings.revision+1,
           north_star=new_north_star,thread_standing_rules=new_thread_standing_rules,
           mode=new_mode,dispatch_mode=new_dispatch_mode,
           base_prompt=new_base_prompt,model_allowlist=new_model_allowlist,
           tool_allowlist=new_tool_allowlist,tokens_per_decision=new_tokens_per_decision,
           milliseconds_per_decision=new_milliseconds_per_decision,
           tool_calls_per_decision=new_tool_calls_per_decision,
           dispatches_per_decision=new_dispatches_per_decision,
           input_bytes_per_decision=new_input_bytes_per_decision,
           candidate_pages_per_decision=new_candidate_pages_per_decision,
           operational_context_max_age_ms=new_operational_context_max_age_ms,
           updated_at=now()
         WHERE tenant=in_tenant AND project=in_project
           AND selector_project_settings.revision=expected_revision
         RETURNING selector_project_settings.revision INTO written;
       END IF;
       IF written IS NULL THEN RETURN; END IF;
       INSERT INTO selector_project_settings_history
         (tenant,project,revision,north_star,thread_standing_rules,mode,dispatch_mode,
          base_prompt,model_allowlist,tool_allowlist,tokens_per_decision,
          milliseconds_per_decision,tool_calls_per_decision,
          dispatches_per_decision,input_bytes_per_decision,
          candidate_pages_per_decision,operational_context_max_age_ms,
          administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.thread_standing_rules,
           settings.mode,settings.dispatch_mode,settings.base_prompt,
           settings.model_allowlist,settings.tool_allowlist,settings.tokens_per_decision,
           settings.milliseconds_per_decision,settings.tool_calls_per_decision,
           settings.dispatches_per_decision,settings.input_bytes_per_decision,
           settings.candidate_pages_per_decision,
           settings.operational_context_max_age_ms,in_administrator_kind,
           in_administrator_subject
           FROM selector_project_settings settings
          WHERE settings.tenant=in_tenant AND settings.project=in_project;
       RETURN QUERY 
  SELECT settings.revision,settings.north_star,settings.thread_standing_rules,
         settings.mode,settings.dispatch_mode,
         settings.base_prompt,settings.model_allowlist,settings.tool_allowlist,
         settings.tokens_per_decision,settings.milliseconds_per_decision,
         settings.tool_calls_per_decision,settings.dispatches_per_decision,
         settings.input_bytes_per_decision,
         settings.candidate_pages_per_decision,
         settings.operational_context_max_age_ms,installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls
    FROM selector_project_settings settings
    CROSS JOIN selector_runtime_settings installation
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written AND installation.singleton=1;
     END $$;


ALTER FUNCTION public.update_selector_project_settings(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION update_selector_runtime_settings(expected_revision bigint, new_mode text, new_dispatch_mode text, new_base_prompt text, new_controls text, in_administrator_kind text, in_administrator_subject text) RETURNS TABLE(revision bigint, mode text, dispatch_mode text, base_prompt text, controls text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           RETURN QUERY WITH updated AS (
             UPDATE selector_runtime_settings current SET
               revision=current.revision+1,
               mode=coalesce(new_mode,current.mode),
               dispatch_mode=coalesce(new_dispatch_mode,current.dispatch_mode),
               base_prompt=coalesce(new_base_prompt,current.base_prompt),
               controls=coalesce(new_controls,current.controls),updated_at=now()
             WHERE singleton=1 AND current.revision=expected_revision
             RETURNING current.revision,current.mode,current.dispatch_mode,
               current.base_prompt,current.controls
           ), recorded AS (
             INSERT INTO selector_runtime_settings_history
               (revision,mode,dispatch_mode,base_prompt,controls,
                administrator_kind,administrator_subject)
             SELECT updated.revision,updated.mode,updated.dispatch_mode,
               updated.base_prompt,updated.controls,in_administrator_kind,
               in_administrator_subject FROM updated
           ) SELECT updated.revision,updated.mode,updated.dispatch_mode,
               updated.base_prompt,updated.controls FROM updated;
         END $$;


ALTER FUNCTION public.update_selector_runtime_settings(expected_revision bigint, new_mode text, new_dispatch_mode text, new_base_prompt text, new_controls text, in_administrator_kind text, in_administrator_subject text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION wake_member_thread(in_tenant text, in_project text, in_principal text, in_turn text, in_input text) RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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
         in_tenant,in_project,held.session,in_turn,'Wake',in_input);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN 'Woken'
                             WHEN 'AlreadyEnqueued' THEN 'AlreadyWoken'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$;


ALTER FUNCTION public.wake_member_thread(in_tenant text, in_project text, in_principal text, in_turn text, in_input text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION withdraw_lead_turn(in_turn text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record;
     BEGIN
       SELECT t.state,t.tenant,t.project,t.session INTO held FROM session_turn t
         JOIN agent_session s ON s.tenant=t.tenant AND s.project=t.project
                             AND s.session=t.session
        WHERE s.kind='Lead' AND t.turn=in_turn FOR UPDATE OF t;
       IF NOT FOUND THEN RETURN 'NoTurn'; END IF;
       IF held.state NOT IN ('Queued','Claimed') THEN RETURN 'AlreadyEnded'; END IF;
       UPDATE session_turn t
          SET state='Abandoned',failure='TurnWithdrawn',ended_at=now(),
              attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=held.tenant AND t.project=held.project
          AND t.session=held.session AND t.turn=in_turn;
       RETURN 'Withdrawn';
     END $$;


ALTER FUNCTION public.withdraw_lead_turn(in_turn text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION withdraw_session_attempt(in_secret_digest text, in_generation bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.session,a.attempt INTO bound
         FROM session_attempt a
        WHERE a.bearer_secret_digest=in_secret_digest FOR UPDATE;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Withdrawn',evidence='AgentRateLimited',ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=bound.attempt AND a.generation=in_generation
          AND a.state IN ('Placing','Running')
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_turn t
          SET state='Queued',attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.attempt=bound.attempt
          AND t.state='Claimed';
       RETURN true;
     END $$;


ALTER FUNCTION public.withdraw_session_attempt(in_secret_digest text, in_generation bigint) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION withdraw_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.execution INTO bound
         FROM execution_attempt a
        WHERE a.capability_secret_digest=in_secret_digest;
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM 1 FROM execution e
        WHERE e.tenant=bound.tenant AND e.project=bound.project
          AND e.execution=bound.execution FOR UPDATE;
       UPDATE execution_attempt a
          SET state='Withdrawn',evidence=in_evidence,ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL
        WHERE a.capability_secret_digest=in_secret_digest
          AND a.generation=in_generation AND a.state IN ('Placing','Running')
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE execution e SET placement_backoff_from=now()
        WHERE e.tenant=bound.tenant AND e.project=bound.project
          AND e.execution=bound.execution
          AND e.status NOT IN ('Terminal','Cancelled');
       RETURN FOUND;
     END $$;


ALTER FUNCTION public.withdraw_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) OWNER TO chuggy_boundary_owner;`,
  `CREATE FUNCTION worker_run_binding(in_secret_digest text, in_generation bigint) RETURNS TABLE(tenant text, project text, execution text, attempt text, ticket bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,a.state,
              a.recovery_epoch,e.status,e.ticket INTO bound
         FROM execution_attempt a
         JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                         AND e.execution=a.execution
        WHERE a.capability_secret_digest=in_secret_digest FOR UPDATE OF a;
       IF NOT FOUND OR bound.state NOT IN ('Placing','Running')
          OR bound.status NOT IN ('Launching','Running')
          OR bound.generation<>in_generation
          OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch
                                     ORDER BY ordinal DESC LIMIT 1) THEN
         RETURN;
       END IF;
       RETURN QUERY SELECT bound.tenant,bound.project,bound.execution,
                           bound.attempt,bound.ticket;
     END $$;


ALTER FUNCTION public.worker_run_binding(in_secret_digest text, in_generation bigint) OWNER TO chuggy_boundary_owner;`,
];
