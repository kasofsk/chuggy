export const baselineConstraints: readonly string[] = [
  `ALTER TABLE public.project_change ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.project_change_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);`,
  `ALTER TABLE public.recovery_epoch ALTER COLUMN ordinal ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.recovery_epoch_ordinal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);`,
  `ALTER TABLE public.selector_agentic_refusal ALTER COLUMN ordinal ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.selector_agentic_refusal_ordinal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);`,
  `ALTER TABLE public.selector_interaction ALTER COLUMN ordinal ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.selector_interaction_ordinal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);`,
  `ALTER TABLE public.selector_proposal_review ALTER COLUMN ordinal ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.selector_proposal_review_ordinal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);`,
  `ALTER TABLE ONLY public.admitted_worker
    ADD CONSTRAINT admitted_worker_pkey PRIMARY KEY (image);`,
  `ALTER TABLE ONLY public.agent_session
    ADD CONSTRAINT agent_session_pkey PRIMARY KEY (tenant, project, session);`,
  `ALTER TABLE ONLY public.agent_session
    ADD CONSTRAINT agent_session_identity_is_never_reused UNIQUE (session);`,
  `ALTER TABLE ONLY public.capacity_account
    ADD CONSTRAINT capacity_account_draws_from_one_cluster UNIQUE (account, cluster);`,
  `ALTER TABLE ONLY public.capacity_account
    ADD CONSTRAINT capacity_account_pkey PRIMARY KEY (account);`,
  `ALTER TABLE ONLY public.commit_permit
    ADD CONSTRAINT commit_permit_identity_is_never_reused UNIQUE (permit);`,
  `ALTER TABLE ONLY public.commit_permit
    ADD CONSTRAINT commit_permit_is_one_per_attempt UNIQUE (tenant, project, attempt);`,
  `ALTER TABLE ONLY public.commit_permit
    ADD CONSTRAINT commit_permit_pkey PRIMARY KEY (tenant, project, permit);`,
  `ALTER TABLE ONLY public.configuration_revision
    ADD CONSTRAINT configuration_revision_digest_identity UNIQUE (tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.configuration_revision
    ADD CONSTRAINT configuration_revision_pkey PRIMARY KEY (tenant, project, revision);`,
  `ALTER TABLE ONLY public.decision_input
    ADD CONSTRAINT decision_input_decision_tuple_is_unique UNIQUE (tenant, project, input_kind, input_id, decided_seq);`,
  `ALTER TABLE ONLY public.decision_input
    ADD CONSTRAINT decision_input_identity_is_unique UNIQUE (tenant, project, input_kind, input_id);`,
  `ALTER TABLE ONLY public.decision_input
    ADD CONSTRAINT decision_input_pkey PRIMARY KEY (tenant, project, ordinal);`,
  `ALTER TABLE ONLY public.deployment_authoring_policy
    ADD CONSTRAINT deployment_authoring_policy_pkey PRIMARY KEY (singleton);`,
  `ALTER TABLE ONLY public.dispatch_candidate_dependency
    ADD CONSTRAINT dispatch_candidate_dependency_pkey PRIMARY KEY (tenant, project, ticket, dependency);`,
  `ALTER TABLE ONLY public.dispatch_candidate
    ADD CONSTRAINT dispatch_candidate_pkey PRIMARY KEY (tenant, project, ticket);`,
  `ALTER TABLE ONLY public.dispatch_view
    ADD CONSTRAINT dispatch_view_pkey PRIMARY KEY (tenant, project);`,
  `ALTER TABLE ONLY public.draft_brief_check
    ADD CONSTRAINT draft_brief_check_pkey PRIMARY KEY (tenant, project, ticket, ordinal);`,
  `ALTER TABLE ONLY public.draft_brief_link
    ADD CONSTRAINT draft_brief_link_pkey PRIMARY KEY (tenant, project, ticket, ordinal);`,
  `ALTER TABLE ONLY public.draft_brief
    ADD CONSTRAINT draft_brief_pkey PRIMARY KEY (tenant, project, ticket);`,
  `ALTER TABLE ONLY public.draft
    ADD CONSTRAINT draft_pkey PRIMARY KEY (tenant, project, ticket);`,
  `ALTER TABLE ONLY public.draft_revision
    ADD CONSTRAINT draft_revision_pkey PRIMARY KEY (tenant, project, ticket, authoring_version);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_capability_is_unique UNIQUE (capability);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_identity_is_local UNIQUE (tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_identity_is_never_reused UNIQUE (attempt);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_manifest_is_unique UNIQUE (manifest);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_pkey PRIMARY KEY (tenant, project, execution, attempt_number);`,
  `ALTER TABLE ONLY public.execution_cluster
    ADD CONSTRAINT execution_cluster_pkey PRIMARY KEY (cluster);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_completion_is_its_own UNIQUE (tenant, project, completion_operation);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_identity_is_never_reused UNIQUE (execution);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_names_one_logical_task UNIQUE (tenant, project, ticket, task);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_pkey PRIMARY KEY (tenant, project, execution);`,
  `ALTER TABLE ONLY public.execution_request
    ADD CONSTRAINT execution_request_pkey PRIMARY KEY (tenant, project, request);`,
  `ALTER TABLE ONLY public.execution_request_task
    ADD CONSTRAINT execution_request_task_pkey PRIMARY KEY (tenant, project, request, task);`,
  `ALTER TABLE ONLY public.execution_request
    ADD CONSTRAINT execution_request_tenant_project_authorizing_seq_effect_pos_key UNIQUE (tenant, project, authorizing_seq, effect_position, kind);`,
  `ALTER TABLE ONLY public.execution_request
    ADD CONSTRAINT execution_request_ticket_is_referenceable UNIQUE (tenant, project, request, ticket);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_requirement_identity_unique UNIQUE (requirement_identity);`,
  `ALTER TABLE ONLY public.execution_result_artifact
    ADD CONSTRAINT execution_result_artifact_path_is_declared_once UNIQUE (tenant, project, manifest, path);`,
  `ALTER TABLE ONLY public.execution_result_artifact
    ADD CONSTRAINT execution_result_artifact_pkey PRIMARY KEY (tenant, project, manifest, ordinal);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_identity_is_never_reused UNIQUE (manifest);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_is_one_per_attempt UNIQUE (tenant, project, attempt);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_is_one_per_execution UNIQUE (tenant, project, execution);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_is_referenceable UNIQUE (tenant, project, execution, manifest);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_ordinal_is_project_local UNIQUE (tenant, project, manifest_ordinal);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_pkey PRIMARY KEY (tenant, project, manifest);`,
  `ALTER TABLE ONLY public.execution_result_report
    ADD CONSTRAINT execution_result_report_pkey PRIMARY KEY (tenant, project, manifest);`,
  `ALTER TABLE ONLY public.execution_result_source
    ADD CONSTRAINT execution_result_source_pkey PRIMARY KEY (tenant, project, manifest);`,
  `ALTER TABLE ONLY public.execution_run_model_usage
    ADD CONSTRAINT execution_run_model_usage_pkey PRIMARY KEY (tenant, project, execution, attempt, model);`,
  `ALTER TABLE ONLY public.execution_run
    ADD CONSTRAINT execution_run_pkey PRIMARY KEY (tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_run_total
    ADD CONSTRAINT execution_run_total_pkey PRIMARY KEY (tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_run_transcript_batch
    ADD CONSTRAINT execution_run_transcript_batch_pkey PRIMARY KEY (tenant, project, execution, attempt, batch);`,
  `ALTER TABLE ONLY public.execution_run_turn
    ADD CONSTRAINT execution_run_turn_pkey PRIMARY KEY (tenant, project, execution, attempt, ordinal);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_identity_is_never_reused UNIQUE (attempt);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_pkey PRIMARY KEY (tenant, project, attempt);`,
  `ALTER TABLE ONLY public.finalization_change_proposal
    ADD CONSTRAINT finalization_change_proposal_identity_is_never_reused UNIQUE (proposal_request);`,
  `ALTER TABLE ONLY public.finalization_change_proposal
    ADD CONSTRAINT finalization_change_proposal_pkey PRIMARY KEY (tenant, project, request);`,
  `ALTER TABLE ONLY public.finalization_reconciliation
    ADD CONSTRAINT finalization_reconciliation_pkey PRIMARY KEY (tenant, project, permit);`,
  `ALTER TABLE ONLY public.finalization_request_configuration
    ADD CONSTRAINT finalization_request_configuration_pkey PRIMARY KEY (tenant, project, request);`,
  `ALTER TABLE ONLY public.finalization_request
    ADD CONSTRAINT finalization_request_pkey PRIMARY KEY (tenant, project, request);`,
  `ALTER TABLE ONLY public.finalization_request
    ADD CONSTRAINT finalization_request_tenant_project_authorizing_seq_effect__key UNIQUE (tenant, project, authorizing_seq, effect_position);`,
  `ALTER TABLE ONLY public.forge_installation
    ADD CONSTRAINT forge_installation_pkey PRIMARY KEY (forge, app, account);`,
  `ALTER TABLE ONLY public.input_bundle
    ADD CONSTRAINT input_bundle_is_referenceable UNIQUE (tenant, project, bundle, digest);`,
  `ALTER TABLE ONLY public.input_bundle
    ADD CONSTRAINT input_bundle_pkey PRIMARY KEY (tenant, project, bundle);`,
  `ALTER TABLE ONLY public.input_bundle_reference
    ADD CONSTRAINT input_bundle_reference_is_declared_once UNIQUE (tenant, project, bundle, reference_kind, reference_id);`,
  `ALTER TABLE ONLY public.input_bundle_reference
    ADD CONSTRAINT input_bundle_reference_pkey PRIMARY KEY (tenant, project, bundle, ordinal);`,
  `ALTER TABLE ONLY public.installation_authority
    ADD CONSTRAINT installation_authority_installation_id_key UNIQUE (installation_id);`,
  `ALTER TABLE ONLY public.installation_authority
    ADD CONSTRAINT installation_authority_pkey PRIMARY KEY (singleton);`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_cause_is_effective UNIQUE (tenant, project, cause_kind, cause_id);`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_input_sequence_is_unique UNIQUE (tenant, project, cause_kind, cause_id, seq);`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_pkey PRIMARY KEY (tenant, project, seq);`,
  `ALTER TABLE ONLY public.native_action
    ADD CONSTRAINT native_action_pkey PRIMARY KEY (tenant, project, action);`,
  `ALTER TABLE ONLY public.native_action_resolution
    ADD CONSTRAINT native_action_resolution_pkey PRIMARY KEY (tenant, project, action, resolution);`,
  `ALTER TABLE public.operation
    ADD CONSTRAINT operation_completion_authority_is_its_boundary CHECK (
CASE command_tag
    WHEN 'TaskDone'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'ExecutionBlocked'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'FinalizationResult'::text THEN (authority_kind = 'Finalizer'::text)
    ELSE true
END) NOT VALID;`,
  `ALTER TABLE ONLY public.operation
    ADD CONSTRAINT operation_idempotency_is_scoped UNIQUE (tenant, project, authority_kind, key_digest);`,
  `ALTER TABLE ONLY public.operation
    ADD CONSTRAINT operation_identity_is_never_reused UNIQUE (operation);`,
  `ALTER TABLE ONLY public.operation
    ADD CONSTRAINT operation_pkey PRIMARY KEY (tenant, project, operation);`,
  `ALTER TABLE ONLY public.project_change
    ADD CONSTRAINT project_change_pkey PRIMARY KEY (sequence);`,
  `ALTER TABLE ONLY public.project_continuation
    ADD CONSTRAINT project_continuation_pkey PRIMARY KEY (tenant, project, continuation);`,
  `ALTER TABLE ONLY public.project_continuation
    ADD CONSTRAINT project_continuation_tenant_project_authorizing_seq_effect__key UNIQUE (tenant, project, authorizing_seq, effect_position, kind);`,
  `ALTER TABLE ONLY public.project_notification
    ADD CONSTRAINT project_notification_pkey PRIMARY KEY (tenant, project, ordinal);`,
  `ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (tenant, project);`,
  `ALTER TABLE ONLY public.project_readiness
    ADD CONSTRAINT project_readiness_pkey PRIMARY KEY (tenant, project);`,
  `ALTER TABLE ONLY public.project_repository_bind_operation
    ADD CONSTRAINT project_repository_bind_operation_pkey PRIMARY KEY (operation);`,
  `ALTER TABLE ONLY public.project_repository
    ADD CONSTRAINT project_repository_is_exclusive UNIQUE (repository);`,
  `ALTER TABLE ONLY public.project_repository
    ADD CONSTRAINT project_repository_is_referenceable UNIQUE (tenant, project, repository);`,
  `ALTER TABLE ONLY public.project_repository
    ADD CONSTRAINT project_repository_pkey PRIMARY KEY (tenant, project, repository);`,
  `ALTER TABLE ONLY public.recovery_epoch
    ADD CONSTRAINT recovery_epoch_epoch_key UNIQUE (epoch);`,
  `ALTER TABLE ONLY public.recovery_epoch
    ADD CONSTRAINT recovery_epoch_pkey PRIMARY KEY (ordinal);`,
  `ALTER TABLE ONLY public.repository_configuration_provenance
    ADD CONSTRAINT repository_configuration_name_is_unique UNIQUE (tenant, project, repository, repository_commit, name);`,
  `ALTER TABLE ONLY public.repository_configuration_provenance
    ADD CONSTRAINT repository_configuration_path_is_unique UNIQUE (tenant, project, repository, repository_commit, path);`,
  `ALTER TABLE ONLY public.repository_configuration_provenance
    ADD CONSTRAINT repository_configuration_provenance_pkey PRIMARY KEY (tenant, project, revision);`,
  `ALTER TABLE ONLY public.repository_configuration_version
    ADD CONSTRAINT repository_configuration_version_is_unique UNIQUE (tenant, project, name, number);`,
  `ALTER TABLE ONLY public.repository_configuration_version
    ADD CONSTRAINT repository_configuration_version_pkey PRIMARY KEY (tenant, project, name, digest);`,
  `ALTER TABLE ONLY public.scheduler_incident
    ADD CONSTRAINT scheduler_incident_identity_is_never_reused UNIQUE (incident);`,
  `ALTER TABLE ONLY public.scheduler_incident
    ADD CONSTRAINT scheduler_incident_pkey PRIMARY KEY (tenant, project, incident);`,
  `ALTER TABLE ONLY public.selector_agentic_refusal
    ADD CONSTRAINT selector_agentic_refusal_pkey PRIMARY KEY (ordinal);`,
  `ALTER TABLE ONLY public.selector_attempt
    ADD CONSTRAINT selector_attempt_pkey PRIMARY KEY (attempt);`,
  `ALTER TABLE ONLY public.selector_decision_permit
    ADD CONSTRAINT selector_decision_permit_pkey PRIMARY KEY (attempt);`,
  `ALTER TABLE ONLY public.selector_interaction
    ADD CONSTRAINT selector_interaction_ordinal_key UNIQUE (ordinal);`,
  `ALTER TABLE ONLY public.selector_interaction
    ADD CONSTRAINT selector_interaction_pkey PRIMARY KEY (selector_decision);`,
  `ALTER TABLE ONLY public.selector_interaction_resource
    ADD CONSTRAINT selector_interaction_resource_pkey PRIMARY KEY (selector_decision, kind, ordinal);`,
  `ALTER TABLE ONLY public.selector_interaction
    ADD CONSTRAINT selector_interaction_selector_decision_tenant_project_key UNIQUE (selector_decision, tenant, project);`,
  `ALTER TABLE ONLY public.selector_inventory_state
    ADD CONSTRAINT selector_inventory_state_pkey PRIMARY KEY (singleton);`,
  `ALTER TABLE ONLY public.selector_observation
    ADD CONSTRAINT selector_observation_pkey PRIMARY KEY (attempt);`,
  `ALTER TABLE ONLY public.selector_planning_intent
    ADD CONSTRAINT selector_planning_intent_pkey PRIMARY KEY (tenant, project);`,
  `ALTER TABLE ONLY public.selector_project_settings_history
    ADD CONSTRAINT selector_project_settings_history_pkey PRIMARY KEY (tenant, project, revision);`,
  `ALTER TABLE ONLY public.selector_project_settings
    ADD CONSTRAINT selector_project_settings_pkey PRIMARY KEY (tenant, project);`,
  `ALTER TABLE ONLY public.selector_project_state
    ADD CONSTRAINT selector_project_state_pkey PRIMARY KEY (tenant, project);`,
  `ALTER TABLE ONLY public.selector_proposal_delivery
    ADD CONSTRAINT selector_proposal_delivery_operation_key UNIQUE (operation);`,
  `ALTER TABLE ONLY public.selector_proposal_delivery
    ADD CONSTRAINT selector_proposal_delivery_pkey PRIMARY KEY (selector_decision, ticket);`,
  `ALTER TABLE ONLY public.selector_proposal_review
    ADD CONSTRAINT selector_proposal_review_pkey PRIMARY KEY (ordinal);`,
  `ALTER TABLE ONLY public.selector_proposal_review
    ADD CONSTRAINT selector_proposal_review_selector_decision_key UNIQUE (selector_decision);`,
  `ALTER TABLE ONLY public.selector_agentic_refusal
    ADD CONSTRAINT selector_refusal_is_one_per_decision UNIQUE (selector_decision, ticket);`,
  `ALTER TABLE ONLY public.selector_runtime_readiness
    ADD CONSTRAINT selector_runtime_readiness_pkey PRIMARY KEY (singleton);`,
  `ALTER TABLE ONLY public.selector_runtime_settings_history
    ADD CONSTRAINT selector_runtime_settings_history_pkey PRIMARY KEY (revision);`,
  `ALTER TABLE ONLY public.selector_runtime_settings
    ADD CONSTRAINT selector_runtime_settings_pkey PRIMARY KEY (singleton);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_bearer_is_unique UNIQUE (bearer);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_identity_is_local UNIQUE (tenant, project, session, attempt);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_identity_is_never_reused UNIQUE (attempt);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_pkey PRIMARY KEY (tenant, project, session, attempt_number);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_secret_is_unique UNIQUE (bearer_secret_digest);`,
  `ALTER TABLE ONLY public.session_store_batch
    ADD CONSTRAINT session_store_batch_pkey PRIMARY KEY (tenant, project, session, stream, batch);`,
  `ALTER TABLE ONLY public.session_turn
    ADD CONSTRAINT session_turn_identity_is_never_reused UNIQUE (turn);`,
  `ALTER TABLE ONLY public.session_turn
    ADD CONSTRAINT session_turn_pkey PRIMARY KEY (tenant, project, session, ordinal);`,
  `ALTER TABLE ONLY public.thread_wake_cursor
    ADD CONSTRAINT thread_wake_cursor_pkey PRIMARY KEY (singleton);`,
  `ALTER TABLE ONLY public.ticket_projection
    ADD CONSTRAINT ticket_projection_pkey PRIMARY KEY (tenant, project, ticket);`,
  `ALTER TABLE ONLY public.worker_artifact_reservation
    ADD CONSTRAINT worker_artifact_reservation_pkey PRIMARY KEY (tenant, project, execution, attempt, path);`,
  `CREATE UNIQUE INDEX agent_session_one_lead_per_project ON public.agent_session USING btree (tenant, project) WHERE ((kind = 'Lead'::text) AND (state = 'Open'::text));`,
  `CREATE UNIQUE INDEX agent_session_one_thread_per_member ON public.agent_session USING btree (tenant, project, principal) WHERE ((kind = 'Thread'::text) AND (state = 'Open'::text));`,
  `CREATE UNIQUE INDEX commit_permit_one_live ON public.commit_permit USING btree (tenant, project) WHERE (state = 'Granted'::text);`,
  `CREATE INDEX commit_permit_unconcluded ON public.commit_permit USING btree (granted_at) WHERE (state = 'Granted'::text);`,
  `CREATE INDEX decision_input_completion_head ON public.decision_input USING btree (tenant, project, ordinal) WHERE ((state = 'Pending'::text) AND (base_priority = 'Completion'::text));`,
  `CREATE INDEX decision_input_continuation_head ON public.decision_input USING btree (tenant, project, ordinal) WHERE ((state = 'Pending'::text) AND (base_priority = 'Continuation'::text));`,
  `CREATE INDEX decision_input_ordinary_head ON public.decision_input USING btree (tenant, project, ordinal) WHERE ((state = 'Pending'::text) AND (base_priority = 'Ordinary'::text));`,
  `CREATE INDEX decision_input_safety_head ON public.decision_input USING btree (tenant, project, ordinal) WHERE ((state = 'Pending'::text) AND (base_priority = 'Safety'::text));`,
  `CREATE INDEX execution_active_by_account ON public.execution USING btree (account) WHERE (status = ANY (ARRAY['Admitted'::text, 'Launching'::text, 'Running'::text]));`,
  `CREATE INDEX execution_active_by_cluster ON public.execution USING btree (cluster) WHERE (status = ANY (ARRAY['Admitted'::text, 'Launching'::text, 'Running'::text]));`,
  `CREATE INDEX execution_attempt_epoch ON public.execution_attempt USING btree (recovery_epoch) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE INDEX execution_attempt_lease_expiry ON public.execution_attempt USING btree (lease_expires_at) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE UNIQUE INDEX execution_attempt_one_authoritative ON public.execution_attempt USING btree (tenant, project, execution) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE INDEX execution_by_request ON public.execution USING btree (tenant, project, source_request);`,
  `CREATE INDEX execution_live_by_project ON public.execution USING btree (tenant, project, status) WHERE (status <> ALL (ARRAY['Terminal'::text, 'Cancelled'::text]));`,
  `CREATE INDEX execution_queued ON public.execution USING btree (cluster, registered_at) WHERE (status = 'Queued'::text);`,
  `CREATE INDEX execution_request_claimable ON public.execution_request USING btree (kind, authorizing_seq) WHERE (state = 'Open'::text);`,
  `CREATE INDEX finalization_attempt_by_request ON public.finalization_attempt USING btree (tenant, project, request, prepared_at);`,
  `CREATE INDEX finalization_reconciliation_held ON public.finalization_reconciliation USING btree (reconciled_at) WHERE (verdict = 'Unreadable'::text);`,
  `CREATE INDEX finalization_request_claim_expiry ON public.finalization_request USING btree (claim_expires_at) WHERE (claim_owner IS NOT NULL);`,
  `CREATE INDEX finalization_request_claimable ON public.finalization_request USING btree (authorizing_seq) WHERE (state = 'Open'::text);`,
  `CREATE INDEX finalization_request_epoch ON public.finalization_request USING btree (recovery_epoch) WHERE (claim_owner IS NOT NULL);`,
  `CREATE UNIQUE INDEX finalization_request_one_live ON public.finalization_request USING btree (tenant, project, ticket) WHERE (state = ANY (ARRAY['Open'::text, 'Registered'::text]));`,
  `CREATE INDEX journal_entry_release_ticket ON public.journal_entry USING btree (tenant, project, (
CASE
    WHEN (entry IS JSON OBJECT) THEN ((((entry)::jsonb -> 'event'::text) -> 'value'::text) -> 'ticket'::text)
    ELSE NULL::jsonb
END)) WHERE (
CASE
    WHEN (entry IS JSON OBJECT) THEN (((entry)::jsonb -> 'event'::text) ->> 'type'::text)
    ELSE NULL::text
END = 'ReleaseTicket'::text);`,
  `CREATE UNIQUE INDEX native_action_approves_an_attempt_once ON public.native_action USING btree (tenant, project, attempt) WHERE (attempt IS NOT NULL);`,
  `CREATE UNIQUE INDEX native_action_effect_is_materialized_once ON public.native_action USING btree (tenant, project, authorizing_seq, effect_position) WHERE (attempt IS NULL);`,
  `CREATE UNIQUE INDEX native_action_one_open ON public.native_action USING btree (tenant, project, ticket) WHERE (state = 'Open'::text);`,
  `CREATE INDEX project_change_by_project ON public.project_change USING btree (tenant, project, sequence);`,
  `CREATE INDEX project_lease_expiry ON public.project USING btree (lease_expires_at) WHERE ((lifecycle = 'Active'::text) AND (owner IS NOT NULL));`,
  `CREATE INDEX project_readiness_ready ON public.project_readiness USING btree (tenant, project) WHERE ready;`,
  `CREATE INDEX scheduler_incident_recent ON public.scheduler_incident USING btree (tenant, project, observed_at DESC);`,
  `CREATE INDEX selector_refusal_by_ticket ON public.selector_agentic_refusal USING btree (tenant, project, ticket, ordinal);`,
  `CREATE INDEX session_attempt_active_by_account ON public.session_attempt USING btree (tenant, project) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE INDEX session_attempt_epoch ON public.session_attempt USING btree (recovery_epoch) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE INDEX session_attempt_lease_expiry ON public.session_attempt USING btree (lease_expires_at) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE UNIQUE INDEX session_attempt_one_live ON public.session_attempt USING btree (tenant, project, session) WHERE (state = ANY (ARRAY['Placing'::text, 'Running'::text]));`,
  `CREATE UNIQUE INDEX session_turn_one_claimed ON public.session_turn USING btree (tenant, project, session) WHERE (state = 'Claimed'::text);`,
  `CREATE INDEX session_turn_queued ON public.session_turn USING btree (tenant, project, session, ordinal) WHERE (state = 'Queued'::text);`,
  `CREATE TRIGGER agent_session_is_written_once BEFORE UPDATE ON public.agent_session FOR EACH ROW EXECUTE FUNCTION public.agent_session_is_written_once();`,
  `CREATE TRIGGER agent_session_member_view_appends_a_change AFTER UPDATE OF member_title, hidden_at ON public.agent_session FOR EACH ROW WHEN (((old.member_title IS DISTINCT FROM new.member_title) OR (old.hidden_at IS DISTINCT FROM new.hidden_at))) EXECUTE FUNCTION public.session_state_appends_a_change();`,
  `CREATE TRIGGER agent_session_move_appends_a_change AFTER UPDATE OF state ON public.agent_session FOR EACH ROW WHEN ((old.state IS DISTINCT FROM new.state)) EXECUTE FUNCTION public.session_state_appends_a_change();`,
  `CREATE TRIGGER commit_permit_concludes_once BEFORE UPDATE ON public.commit_permit FOR EACH ROW EXECUTE FUNCTION public.commit_permit_concludes_once();`,
  `CREATE TRIGGER execution_artifact_appends_a_change AFTER INSERT ON public.execution_result_artifact FOR EACH ROW EXECUTE FUNCTION public.execution_result_artifact_appends_a_change();`,
  `CREATE TRIGGER execution_attempt_is_fenced BEFORE UPDATE ON public.execution_attempt FOR EACH ROW EXECUTE FUNCTION public.execution_attempt_is_fenced();`,
  `CREATE TRIGGER execution_attempt_move_appends_a_change AFTER UPDATE OF state, ended_at ON public.execution_attempt FOR EACH ROW WHEN (((old.state IS DISTINCT FROM new.state) OR (old.ended_at IS DISTINCT FROM new.ended_at))) EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_attempt_opening_appends_a_change AFTER INSERT ON public.execution_attempt FOR EACH ROW EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_materializes_legacy_requirement BEFORE INSERT ON public.execution FOR EACH ROW EXECUTE FUNCTION public.materialize_legacy_execution_requirement();`,
  `CREATE TRIGGER execution_move_appends_a_change AFTER UPDATE OF status, outcome, result_manifest, terminal_at ON public.execution FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.outcome IS DISTINCT FROM new.outcome) OR (old.result_manifest IS DISTINCT FROM new.result_manifest) OR (old.terminal_at IS DISTINCT FROM new.terminal_at))) EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_registration_appends_a_change AFTER INSERT ON public.execution FOR EACH ROW EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_result_appends_a_change AFTER INSERT ON public.execution_result FOR EACH ROW EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_result_artifact_is_written_once BEFORE DELETE OR UPDATE ON public.execution_result_artifact FOR EACH ROW EXECUTE FUNCTION public.execution_result_is_immutable();`,
  `CREATE TRIGGER execution_result_comes_from_an_unfenced_attempt BEFORE INSERT ON public.execution_result FOR EACH ROW EXECUTE FUNCTION public.execution_result_reporter_is_unfenced();`,
  `CREATE TRIGGER execution_result_is_written_once BEFORE DELETE OR UPDATE ON public.execution_result FOR EACH ROW EXECUTE FUNCTION public.execution_result_is_immutable();`,
  `CREATE TRIGGER execution_result_report_is_written_once BEFORE DELETE OR UPDATE ON public.execution_result_report FOR EACH ROW EXECUTE FUNCTION public.execution_result_is_immutable();`,
  `CREATE TRIGGER execution_result_source_is_written_once BEFORE DELETE OR UPDATE ON public.execution_result_source FOR EACH ROW EXECUTE FUNCTION public.execution_result_is_immutable();`,
  `CREATE TRIGGER execution_run_batch_appends_a_change AFTER INSERT ON public.execution_run_transcript_batch FOR EACH ROW EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_run_is_written_once BEFORE DELETE OR UPDATE ON public.execution_run FOR EACH ROW EXECUTE FUNCTION public.execution_run_is_written_once();`,
  `CREATE TRIGGER execution_run_model_usage_is_written_once BEFORE DELETE OR UPDATE ON public.execution_run_model_usage FOR EACH ROW EXECUTE FUNCTION public.execution_run_evidence_is_immutable();`,
  `CREATE TRIGGER execution_run_opening_appends_a_change AFTER INSERT ON public.execution_run FOR EACH ROW EXECUTE FUNCTION public.execution_appends_a_change();`,
  `CREATE TRIGGER execution_run_total_appends_a_change AFTER INSERT ON public.execution_run_total FOR EACH ROW EXECUTE FUNCTION public.execution_run_appends_a_change();`,
  `CREATE TRIGGER execution_run_total_is_written_once BEFORE DELETE OR UPDATE ON public.execution_run_total FOR EACH ROW EXECUTE FUNCTION public.execution_run_evidence_is_immutable();`,
  `CREATE TRIGGER execution_run_transcript_batch_is_written_once BEFORE DELETE OR UPDATE ON public.execution_run_transcript_batch FOR EACH ROW EXECUTE FUNCTION public.execution_run_evidence_is_immutable();`,
  `CREATE TRIGGER execution_run_turn_is_written_once BEFORE DELETE OR UPDATE ON public.execution_run_turn FOR EACH ROW EXECUTE FUNCTION public.execution_run_evidence_is_immutable();`,
  `CREATE TRIGGER execution_status_moves_legally BEFORE UPDATE ON public.execution FOR EACH ROW EXECUTE FUNCTION public.execution_moves_legally();`,
  `CREATE TRIGGER finalization_attempt_is_written_once BEFORE DELETE OR UPDATE ON public.finalization_attempt FOR EACH ROW EXECUTE FUNCTION public.durable_row_is_written_once();`,
  `CREATE TRIGGER finalization_change_proposal_is_written_once BEFORE DELETE OR UPDATE ON public.finalization_change_proposal FOR EACH ROW EXECUTE FUNCTION public.finalization_change_proposal_is_written_once();`,
  `CREATE TRIGGER finalization_reconciliation_concludes_once BEFORE UPDATE ON public.finalization_reconciliation FOR EACH ROW EXECUTE FUNCTION public.finalization_reconciliation_concludes_once();`,
  `CREATE TRIGGER finalization_request_configuration_is_written_once BEFORE DELETE OR UPDATE ON public.finalization_request_configuration FOR EACH ROW EXECUTE FUNCTION public.finalization_request_configuration_is_written_once();`,
  `CREATE TRIGGER forge_installation_keeps_its_claim BEFORE DELETE OR UPDATE ON public.forge_installation FOR EACH ROW EXECUTE FUNCTION public.forge_installation_keeps_its_claim();`,
  `CREATE TRIGGER input_bundle_is_written_once BEFORE DELETE OR UPDATE ON public.input_bundle FOR EACH ROW EXECUTE FUNCTION public.durable_row_is_written_once();`,
  `CREATE TRIGGER input_bundle_reference_is_written_once BEFORE DELETE OR UPDATE ON public.input_bundle_reference FOR EACH ROW EXECUTE FUNCTION public.durable_row_is_written_once();`,
  `CREATE TRIGGER inquiry_closes_when_its_turn_ends AFTER UPDATE OF state ON public.session_turn FOR EACH ROW WHEN ((new.state = ANY (ARRAY['Answered'::text, 'Failed'::text, 'Abandoned'::text]))) EXECUTE FUNCTION public.inquiry_closes_with_its_turn();`,
  `CREATE TRIGGER native_action_opening_appends_a_change AFTER INSERT ON public.native_action FOR EACH ROW EXECUTE FUNCTION public.native_action_appends_a_change();`,
  `CREATE TRIGGER native_action_resolution_pairs_with_its_kind BEFORE INSERT OR UPDATE ON public.native_action_resolution FOR EACH ROW EXECUTE FUNCTION public.native_action_resolution_pairs_with_its_kind();`,
  `CREATE TRIGGER native_action_settlement_appends_a_change AFTER UPDATE OF state ON public.native_action FOR EACH ROW WHEN ((old.state IS DISTINCT FROM new.state)) EXECUTE FUNCTION public.native_action_appends_a_change();`,
  `CREATE TRIGGER project_has_a_capacity_account AFTER INSERT ON public.project FOR EACH ROW EXECUTE FUNCTION public.project_draws_a_capacity_account();`,
  `CREATE TRIGGER project_notification_appends_a_change AFTER INSERT ON public.project_notification FOR EACH ROW EXECUTE FUNCTION public.project_notification_appends_a_change();`,
  `CREATE TRIGGER project_repository_bind_operation_is_immutable BEFORE DELETE OR UPDATE ON public.project_repository_bind_operation FOR EACH ROW EXECUTE FUNCTION public.project_repository_bind_operation_is_immutable();`,
  `CREATE TRIGGER project_repository_is_immutable BEFORE DELETE OR UPDATE ON public.project_repository FOR EACH ROW EXECUTE FUNCTION public.project_repository_is_immutable();`,
  `CREATE TRIGGER project_tenure_is_fenced BEFORE UPDATE ON public.project FOR EACH ROW EXECUTE FUNCTION public.project_tenure_is_fenced();`,
  `CREATE TRIGGER selector_automatic_readiness BEFORE INSERT OR UPDATE OF dispatch_mode ON public.selector_runtime_settings FOR EACH ROW EXECUTE FUNCTION public.enforce_selector_automatic_readiness();`,
  `CREATE TRIGGER selector_project_automatic_readiness BEFORE INSERT OR UPDATE OF dispatch_mode ON public.selector_project_settings FOR EACH ROW EXECUTE FUNCTION public.enforce_selector_automatic_readiness();`,
  `CREATE TRIGGER selector_proposal_attempt BEFORE INSERT ON public.selector_proposal_delivery FOR EACH ROW EXECUTE FUNCTION public.enforce_selector_proposal_attempt();`,
  `CREATE TRIGGER selector_proposal_initial_state BEFORE INSERT ON public.selector_proposal_delivery FOR EACH ROW EXECUTE FUNCTION public.enforce_selector_proposal_initial_state();`,
  `CREATE TRIGGER selector_refusal_appends_a_change AFTER INSERT ON public.selector_agentic_refusal FOR EACH ROW EXECUTE FUNCTION public.selector_refusal_change();`,
  `CREATE TRIGGER selector_refusal_is_written_once BEFORE DELETE OR UPDATE ON public.selector_agentic_refusal FOR EACH ROW EXECUTE FUNCTION public.selector_refusal_is_immutable();`,
  `CREATE TRIGGER session_attempt_is_fenced BEFORE UPDATE ON public.session_attempt FOR EACH ROW EXECUTE FUNCTION public.session_attempt_is_fenced();`,
  `CREATE TRIGGER session_store_batch_appends_a_change AFTER INSERT ON public.session_store_batch FOR EACH ROW EXECUTE FUNCTION public.session_store_batch_appends_a_change();`,
  `CREATE TRIGGER session_store_batch_is_never_an_inquiry_s BEFORE INSERT ON public.session_store_batch FOR EACH ROW EXECUTE FUNCTION public.inquiry_writes_no_store_batch();`,
  `CREATE TRIGGER session_store_batch_is_written_once BEFORE DELETE OR UPDATE ON public.session_store_batch FOR EACH ROW EXECUTE FUNCTION public.session_store_is_immutable();`,
  `CREATE TRIGGER session_turn_enqueue_appends_a_change AFTER INSERT ON public.session_turn FOR EACH ROW EXECUTE FUNCTION public.session_turn_appends_a_change();`,
  `CREATE TRIGGER session_turn_move_appends_a_change AFTER UPDATE OF state ON public.session_turn FOR EACH ROW WHEN ((old.state IS DISTINCT FROM new.state)) EXECUTE FUNCTION public.session_turn_appends_a_change();`,
  `ALTER TABLE ONLY public.agent_session
    ADD CONSTRAINT agent_session_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.agent_session
    ADD CONSTRAINT agent_session_draws_its_cluster FOREIGN KEY (account, cluster) REFERENCES public.capacity_account(account, cluster);`,
  `ALTER TABLE ONLY public.agent_session
    ADD CONSTRAINT agent_session_forks_a_session FOREIGN KEY (tenant, project, parent_session) REFERENCES public.agent_session(tenant, project, session);`,
  `ALTER TABLE ONLY public.capacity_account
    ADD CONSTRAINT capacity_account_cluster_fkey FOREIGN KEY (cluster) REFERENCES public.execution_cluster(cluster);`,
  `ALTER TABLE ONLY public.commit_permit
    ADD CONSTRAINT commit_permit_has_its_attempt FOREIGN KEY (tenant, project, attempt) REFERENCES public.finalization_attempt(tenant, project, attempt);`,
  `ALTER TABLE ONLY public.commit_permit
    ADD CONSTRAINT commit_permit_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.configuration_revision
    ADD CONSTRAINT configuration_revision_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.configuration_revision
    ADD CONSTRAINT configuration_revision_parent_is_local FOREIGN KEY (tenant, project, parent) REFERENCES public.configuration_revision(tenant, project, revision);`,
  `ALTER TABLE ONLY public.decision_input
    ADD CONSTRAINT decision_input_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.decision_input
    ADD CONSTRAINT decision_input_has_its_entry FOREIGN KEY (tenant, project, input_kind, input_id, decided_seq) REFERENCES public.journal_entry(tenant, project, cause_kind, cause_id, seq) DEFERRABLE INITIALLY DEFERRED;`,
  `ALTER TABLE ONLY public.dispatch_candidate_dependency
    ADD CONSTRAINT dispatch_candidate_dependency_tenant_project_ticket_fkey FOREIGN KEY (tenant, project, ticket) REFERENCES public.dispatch_candidate(tenant, project, ticket) ON DELETE CASCADE;`,
  `ALTER TABLE ONLY public.dispatch_candidate
    ADD CONSTRAINT dispatch_candidate_tenant_project_configuration_revision_c_fkey FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.dispatch_candidate
    ADD CONSTRAINT dispatch_candidate_tenant_project_fkey FOREIGN KEY (tenant, project) REFERENCES public.dispatch_view(tenant, project) ON DELETE CASCADE;`,
  `ALTER TABLE ONLY public.dispatch_view
    ADD CONSTRAINT dispatch_view_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.dispatch_view
    ADD CONSTRAINT dispatch_view_tenant_project_fkey FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.draft
    ADD CONSTRAINT draft_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.draft_brief
    ADD CONSTRAINT draft_brief_belongs_to_draft FOREIGN KEY (tenant, project, ticket) REFERENCES public.draft(tenant, project, ticket);`,
  `ALTER TABLE ONLY public.draft_brief_check
    ADD CONSTRAINT draft_brief_check_belongs_to_brief FOREIGN KEY (tenant, project, ticket) REFERENCES public.draft_brief(tenant, project, ticket);`,
  `ALTER TABLE ONLY public.draft_brief_link
    ADD CONSTRAINT draft_brief_link_belongs_to_brief FOREIGN KEY (tenant, project, ticket) REFERENCES public.draft_brief(tenant, project, ticket);`,
  `ALTER TABLE ONLY public.draft_brief
    ADD CONSTRAINT draft_brief_repository_is_bound FOREIGN KEY (tenant, project, repository) REFERENCES public.project_repository(tenant, project, repository);`,
  `ALTER TABLE ONLY public.draft
    ADD CONSTRAINT draft_configuration_is_local FOREIGN KEY (tenant, project, configuration_revision) REFERENCES public.configuration_revision(tenant, project, revision);`,
  `ALTER TABLE ONLY public.draft_revision
    ADD CONSTRAINT draft_revision_belongs_to_draft FOREIGN KEY (tenant, project, ticket) REFERENCES public.draft(tenant, project, ticket);`,
  `ALTER TABLE ONLY public.draft_revision
    ADD CONSTRAINT draft_revision_configuration_is_local FOREIGN KEY (tenant, project, configuration_revision) REFERENCES public.configuration_revision(tenant, project, revision);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_account_draws_its_cluster FOREIGN KEY (account, cluster) REFERENCES public.capacity_account(account, cluster);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_has_its_execution FOREIGN KEY (tenant, project, execution) REFERENCES public.execution(tenant, project, execution);`,
  `ALTER TABLE ONLY public.execution_attempt
    ADD CONSTRAINT execution_attempt_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_completion_is_an_operation FOREIGN KEY (tenant, project, completion_operation) REFERENCES public.operation(tenant, project, operation);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_configuration_is_retained FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_has_its_authorized_task FOREIGN KEY (tenant, project, source_request, task) REFERENCES public.execution_request_task(tenant, project, request, task);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_has_its_authorized_ticket FOREIGN KEY (tenant, project, source_request, ticket) REFERENCES public.execution_request(tenant, project, request, ticket);`,
  `ALTER TABLE ONLY public.execution_request
    ADD CONSTRAINT execution_request_bundle_is_retained FOREIGN KEY (tenant, project, input_bundle, input_bundle_digest) REFERENCES public.input_bundle(tenant, project, bundle, digest);`,
  `ALTER TABLE ONLY public.execution_request
    ADD CONSTRAINT execution_request_configuration_is_retained FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.execution_request_task
    ADD CONSTRAINT execution_request_task_tenant_project_request_fkey FOREIGN KEY (tenant, project, request) REFERENCES public.execution_request(tenant, project, request);`,
  `ALTER TABLE ONLY public.execution_request
    ADD CONSTRAINT execution_request_tenant_project_authorizing_seq_fkey FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES public.journal_entry(tenant, project, seq);`,
  `ALTER TABLE ONLY public.execution_result_artifact
    ADD CONSTRAINT execution_result_artifact_has_its_manifest FOREIGN KEY (tenant, project, manifest) REFERENCES public.execution_result(tenant, project, manifest);`,
  `ALTER TABLE ONLY public.execution_result
    ADD CONSTRAINT execution_result_has_its_attempt FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_attempt(tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_result_is_its_own FOREIGN KEY (tenant, project, execution, result_manifest) REFERENCES public.execution_result(tenant, project, execution, manifest);`,
  `ALTER TABLE ONLY public.execution_result_report
    ADD CONSTRAINT execution_result_report_tenant_project_manifest_fkey FOREIGN KEY (tenant, project, manifest) REFERENCES public.execution_result(tenant, project, manifest);`,
  `ALTER TABLE ONLY public.execution_result_source
    ADD CONSTRAINT execution_result_source_tenant_project_manifest_fkey FOREIGN KEY (tenant, project, manifest) REFERENCES public.execution_result(tenant, project, manifest);`,
  `ALTER TABLE ONLY public.execution_run_model_usage
    ADD CONSTRAINT execution_run_model_usage_tenant_project_execution_attempt_fkey FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_run_total(tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_run
    ADD CONSTRAINT execution_run_tenant_project_execution_attempt_fkey FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_attempt(tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_run_total
    ADD CONSTRAINT execution_run_total_tenant_project_execution_attempt_fkey FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_run(tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_run_transcript_batch
    ADD CONSTRAINT execution_run_transcript_batc_tenant_project_execution_att_fkey FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_run(tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.execution_run_turn
    ADD CONSTRAINT execution_run_turn_tenant_project_execution_attempt_fkey FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_run(tenant, project, execution, attempt);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_configuration_is_retained FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_has_its_bundle FOREIGN KEY (tenant, project, input_bundle, input_bundle_digest) REFERENCES public.input_bundle(tenant, project, bundle, digest);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_has_its_repository FOREIGN KEY (tenant, project, repository) REFERENCES public.project_repository(tenant, project, repository);`,
  `ALTER TABLE ONLY public.finalization_attempt
    ADD CONSTRAINT finalization_attempt_has_its_request FOREIGN KEY (tenant, project, request) REFERENCES public.finalization_request(tenant, project, request);`,
  `ALTER TABLE ONLY public.finalization_change_proposal
    ADD CONSTRAINT finalization_change_proposal_has_its_permit FOREIGN KEY (tenant, project, permit) REFERENCES public.commit_permit(tenant, project, permit);`,
  `ALTER TABLE ONLY public.finalization_change_proposal
    ADD CONSTRAINT finalization_change_proposal_has_its_request FOREIGN KEY (tenant, project, request) REFERENCES public.finalization_request(tenant, project, request);`,
  `ALTER TABLE ONLY public.finalization_reconciliation
    ADD CONSTRAINT finalization_reconciliation_has_its_permit FOREIGN KEY (tenant, project, permit) REFERENCES public.commit_permit(tenant, project, permit);`,
  `ALTER TABLE ONLY public.finalization_request_configuration
    ADD CONSTRAINT finalization_request_configuration_has_request FOREIGN KEY (tenant, project, request) REFERENCES public.finalization_request(tenant, project, request);`,
  `ALTER TABLE ONLY public.finalization_request_configuration
    ADD CONSTRAINT finalization_request_configuration_is_pinned FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.finalization_request
    ADD CONSTRAINT finalization_request_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.finalization_request
    ADD CONSTRAINT finalization_request_tenant_project_authorizing_seq_fkey FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES public.journal_entry(tenant, project, seq);`,
  `ALTER TABLE ONLY public.input_bundle
    ADD CONSTRAINT input_bundle_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.input_bundle_reference
    ADD CONSTRAINT input_bundle_reference_has_its_bundle FOREIGN KEY (tenant, project, bundle) REFERENCES public.input_bundle(tenant, project, bundle);`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_configuration_is_retained FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_has_its_input FOREIGN KEY (tenant, project, cause_kind, cause_id, seq) REFERENCES public.decision_input(tenant, project, input_kind, input_id, decided_seq) DEFERRABLE INITIALLY DEFERRED;`,
  `ALTER TABLE ONLY public.journal_entry
    ADD CONSTRAINT journal_entry_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.native_action
    ADD CONSTRAINT native_action_answers_with_one_it_offered FOREIGN KEY (tenant, project, action, resolution) REFERENCES public.native_action_resolution(tenant, project, action, resolution);`,
  `ALTER TABLE ONLY public.native_action
    ADD CONSTRAINT native_action_attempt_is_its_own FOREIGN KEY (tenant, project, attempt) REFERENCES public.finalization_attempt(tenant, project, attempt);`,
  `ALTER TABLE ONLY public.native_action_resolution
    ADD CONSTRAINT native_action_resolution_tenant_project_action_fkey FOREIGN KEY (tenant, project, action) REFERENCES public.native_action(tenant, project, action);`,
  `ALTER TABLE ONLY public.native_action
    ADD CONSTRAINT native_action_tenant_project_authorizing_seq_fkey FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES public.journal_entry(tenant, project, seq);`,
  `ALTER TABLE ONLY public.operation
    ADD CONSTRAINT operation_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.operation
    ADD CONSTRAINT operation_via_session_is_a_session FOREIGN KEY (tenant, project, via_session) REFERENCES public.agent_session(tenant, project, session);`,
  `ALTER TABLE ONLY public.project_continuation
    ADD CONSTRAINT project_continuation_tenant_project_authorizing_seq_fkey FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES public.journal_entry(tenant, project, seq);`,
  `ALTER TABLE ONLY public.project_notification
    ADD CONSTRAINT project_notification_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.project_readiness
    ADD CONSTRAINT project_readiness_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.project_repository
    ADD CONSTRAINT project_repository_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.project_repository_bind_operation
    ADD CONSTRAINT project_repository_bind_operation_names_a_binding FOREIGN KEY (tenant, project, repository) REFERENCES public.project_repository(tenant, project, repository);`,
  `ALTER TABLE ONLY public.project_repository_bind_operation
    ADD CONSTRAINT project_repository_bind_operation_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.project_repository
    ADD CONSTRAINT project_repository_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.repository_configuration_provenance
    ADD CONSTRAINT repository_configuration_revision_is_retained FOREIGN KEY (tenant, project, revision, digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.scheduler_incident
    ADD CONSTRAINT scheduler_incident_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.selector_attempt
    ADD CONSTRAINT selector_attempt_tenant_project_fkey FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.selector_decision_permit
    ADD CONSTRAINT selector_decision_permit_attempt_fkey FOREIGN KEY (attempt) REFERENCES public.selector_attempt(attempt);`,
  `ALTER TABLE ONLY public.selector_interaction_resource
    ADD CONSTRAINT selector_interaction_resource_selector_decision_fkey FOREIGN KEY (selector_decision) REFERENCES public.selector_interaction(selector_decision) ON DELETE CASCADE;`,
  `ALTER TABLE ONLY public.selector_interaction
    ADD CONSTRAINT selector_interaction_selector_decision_fkey FOREIGN KEY (selector_decision) REFERENCES public.selector_attempt(attempt);`,
  `ALTER TABLE ONLY public.selector_observation
    ADD CONSTRAINT selector_observation_attempt_fkey FOREIGN KEY (attempt) REFERENCES public.selector_attempt(attempt);`,
  `ALTER TABLE ONLY public.selector_planning_intent
    ADD CONSTRAINT selector_planning_intent_selector_decision_tenant_project_fkey FOREIGN KEY (selector_decision, tenant, project) REFERENCES public.selector_interaction(selector_decision, tenant, project);`,
  `ALTER TABLE ONLY public.selector_project_settings
    ADD CONSTRAINT selector_project_settings_tenant_project_fkey FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.selector_proposal_delivery
    ADD CONSTRAINT selector_proposal_delivery_selector_decision_tenant_projec_fkey FOREIGN KEY (selector_decision, tenant, project) REFERENCES public.selector_interaction(selector_decision, tenant, project);`,
  `ALTER TABLE ONLY public.selector_proposal_review
    ADD CONSTRAINT selector_proposal_review_selector_decision_tenant_project_fkey FOREIGN KEY (selector_decision, tenant, project) REFERENCES public.selector_interaction(selector_decision, tenant, project);`,
  `ALTER TABLE ONLY public.selector_agentic_refusal
    ADD CONSTRAINT selector_refusal_has_its_decision FOREIGN KEY (selector_decision, tenant, project) REFERENCES public.selector_interaction(selector_decision, tenant, project);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_has_its_session FOREIGN KEY (tenant, project, session) REFERENCES public.agent_session(tenant, project, session);`,
  `ALTER TABLE ONLY public.session_attempt
    ADD CONSTRAINT session_attempt_recovery_epoch_fkey FOREIGN KEY (recovery_epoch) REFERENCES public.recovery_epoch(epoch);`,
  `ALTER TABLE ONLY public.session_store_batch
    ADD CONSTRAINT session_store_has_its_session FOREIGN KEY (tenant, project, session) REFERENCES public.agent_session(tenant, project, session);`,
  `ALTER TABLE ONLY public.session_turn
    ADD CONSTRAINT session_turn_has_its_session FOREIGN KEY (tenant, project, session) REFERENCES public.agent_session(tenant, project, session);`,
  `ALTER TABLE ONLY public.ticket_projection
    ADD CONSTRAINT ticket_projection_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project);`,
  `ALTER TABLE ONLY public.ticket_projection
    ADD CONSTRAINT ticket_projection_configuration_is_retained FOREIGN KEY (tenant, project, configuration_revision, configuration_digest) REFERENCES public.configuration_revision(tenant, project, revision, digest);`,
  `ALTER TABLE ONLY public.worker_artifact_reservation
    ADD CONSTRAINT worker_artifact_reservation_tenant_project_execution_attem_fkey FOREIGN KEY (tenant, project, execution, attempt) REFERENCES public.execution_attempt(tenant, project, execution, attempt);`,
];
