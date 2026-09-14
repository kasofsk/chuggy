export const baselinePrivileges: readonly string[] = [
  `GRANT USAGE ON SCHEMA public TO chuggy_boundary_owner;
GRANT USAGE ON SCHEMA public TO chuggy_scheduler;
GRANT USAGE ON SCHEMA public TO chuggy_finalizer;
GRANT USAGE ON SCHEMA public TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.accept_dispatch_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_dispatch_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.accept_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.advance_selector_attempt(in_attempt text, in_transition text, in_evidence text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_selector_attempt(in_attempt text, in_transition text, in_evidence text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.advance_selector_delivery(in_decision text, in_ticket bigint, in_transition text, in_outcome text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_selector_delivery(in_decision text, in_ticket bigint, in_transition text, in_outcome text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.advance_thread_wake_cursor(in_sequence bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_thread_wake_cursor(in_sequence bigint) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.agent_session_is_written_once() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.allocate_selector_attempt(in_attempt text, in_tenant text, in_project text, concurrent_limit integer, rate_limit integer, decision_milliseconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_selector_attempt(in_attempt text, in_tenant text, in_project text, concurrent_limit integer, rate_limit integer, decision_milliseconds integer) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.answer_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.answer_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[]) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.append_project_change(in_tenant text, in_project text, in_kind text, in_resource text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.append_project_change(in_tenant text, in_project text, in_kind text, in_resource text) TO chuggy_scheduler;
GRANT ALL ON FUNCTION public.append_project_change(in_tenant text, in_project text, in_kind text, in_resource text) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.append_project_change(in_tenant text, in_project text, in_kind text, in_resource text, in_wake_reason text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.authenticate_session_bearer(in_secret_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.authenticate_session_bearer(in_secret_digest text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.bind_project_repository(in_tenant text, in_project text, in_repository text, in_recovery_epoch text, in_operation text, in_authority_kind text, in_authority_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bind_project_repository(in_tenant text, in_project text, in_repository text, in_recovery_epoch text, in_operation text, in_authority_kind text, in_authority_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.bind_session_reference(in_secret_digest text, in_generation bigint, in_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bind_session_reference(in_secret_digest text, in_generation bigint, in_reference text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.cancel_pending_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_pending_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.claim_selector_attempt_reconciliation(attempt_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_selector_attempt_reconciliation(attempt_limit integer) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.claim_selector_deliveries(delivery_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_selector_deliveries(delivery_limit integer) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.claim_selector_proposal_reconciliation(delivery_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_selector_proposal_reconciliation(delivery_limit integer) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.claim_session_turn(in_secret_digest text, in_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_session_turn(in_secret_digest text, in_generation bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.close_agent_session(in_tenant text, in_project text, in_session text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.close_member_thread(in_tenant text, in_project text, in_session text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_member_thread(in_tenant text, in_project text, in_session text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.command_integer(value jsonb) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.commit_permit_concludes_once() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.create_configuration_revision(in_tenant text, in_project text, in_revision text, in_parent text, in_canonical text, in_digest text, in_kind text, in_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_configuration_revision(in_tenant text, in_project text, in_revision text, in_parent text, in_canonical text, in_digest text, in_kind text, in_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_draft(in_tenant text, in_project text, in_configuration text, in_configuration_digest text, in_expected_head bigint, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.decision_event_is_valid(event jsonb) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.delete_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_kind text, in_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_kind text, in_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.durable_row_is_written_once() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.end_session_attempt(in_attempt text, in_generation bigint, in_evidence text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.end_session_attempt(in_attempt text, in_generation bigint, in_evidence text) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.enforce_selector_automatic_readiness() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.enforce_selector_proposal_attempt() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.enforce_selector_proposal_initial_state() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.enqueue_lead_turn(in_tenant text, in_project text, in_turn text, in_input text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_lead_turn(in_tenant text, in_project text, in_turn text, in_input text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.enqueue_session_turn(in_tenant text, in_project text, in_session text, in_turn text, in_input_kind text, in_input text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.enqueue_thread_message(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_thread_message(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.execution_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_attempt_is_fenced() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_backlog(in_tenant text, in_project text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.execution_backlog(in_tenant text, in_project text) TO chuggy_api;
GRANT ALL ON FUNCTION public.execution_backlog(in_tenant text, in_project text) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.execution_moves_legally() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_result_artifact_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_result_is_immutable() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_result_reporter_is_unfenced() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_run_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_run_evidence_is_immutable() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_run_is_written_once() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.execution_status_move_is_legal(before text, after text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.execution_status_move_is_legal(before text, after text) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.fail_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_failure text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_session_turn(in_secret_digest text, in_generation bigint, in_turn text, in_failure text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.fence_old_epoch_session_attempts(in_epoch text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fence_old_epoch_session_attempts(in_epoch text, in_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.finalization_change_proposal_is_written_once() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.finalization_reconciliation_concludes_once() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.heartbeat_session_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.heartbeat_session_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.heartbeat_worker_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.heartbeat_worker_attempt(in_secret_digest text, in_generation bigint, in_lease_secs bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.hide_member_thread(in_tenant text, in_project text, in_session text, in_hidden boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hide_member_thread(in_tenant text, in_project text, in_session text, in_hidden boolean) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.import_repository_configuration(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_kind text, in_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.import_repository_configuration(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_kind text, in_subject text) TO chuggy_api;
GRANT ALL ON FUNCTION public.import_repository_configuration(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_kind text, in_subject text) TO chuggy_configuration_importer;`,
  `REVOKE ALL ON FUNCTION public.inquiry_closes_with_its_turn() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.inquiry_writes_no_store_batch() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.lead_session(in_tenant text, in_project text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lead_session(in_tenant text, in_project text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.legacy_event(command text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.list_project_repository_bindings(in_tenant text, in_project text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_project_repository_bindings(in_tenant text, in_project text, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.list_repository_bindings(in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_repository_bindings(in_max bigint) TO chuggy_configuration_importer;`,
  `REVOKE ALL ON FUNCTION public.list_session_store_streams(in_tenant text, in_project text, in_session text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_session_store_streams(in_tenant text, in_project text, in_session text, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.list_session_streams(in_secret_digest text, in_generation bigint, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_session_streams(in_secret_digest text, in_generation bigint, in_max bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.lose_session_attempt(in_secret_digest text, in_generation bigint, in_evidence text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lose_session_attempt(in_secret_digest text, in_generation bigint, in_evidence text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.lose_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lose_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.materialize_legacy_execution_requirement() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.native_action_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.native_action_resolution_pairs_with_its_kind() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.open_agent_session(in_tenant text, in_project text, in_session text, in_kind text, in_principal text, in_parent text, in_capabilities text[], in_credential_slot text, in_system_prompt text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.open_lead_inquiry(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_lead_inquiry(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.open_member_thread(in_tenant text, in_project text, in_principal text, in_session text, in_credential_slot text, in_system_prompt text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_member_thread(in_tenant text, in_project text, in_principal text, in_session text, in_credential_slot text, in_system_prompt text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.open_project_lead(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_project_lead(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.open_session_attempt(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_session_attempt(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.place_session_attempt(in_attempt text, in_generation bigint, in_placement text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_session_attempt(in_attempt text, in_generation bigint, in_placement text) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.project_active_work(in_tenant text, in_project text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.project_active_work(in_tenant text, in_project text) TO chuggy_api;
GRANT ALL ON FUNCTION public.project_active_work(in_tenant text, in_project text) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.project_capacity_account(in_tenant text, in_project text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.project_capacity_account(in_tenant text, in_project text) TO chuggy_ticket_service;
GRANT ALL ON FUNCTION public.project_capacity_account(in_tenant text, in_project text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.project_change_retains(in_cursor bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.project_change_retains(in_cursor bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.project_draws_a_capacity_account() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.project_notification_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.public_ticket_command_is_valid(command jsonb) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.publish_continuation(in_tenant text, in_project text, in_ordinal bigint, in_continuation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_continuation(in_tenant text, in_project text, in_ordinal bigint, in_continuation text) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.publish_project_notification(in_tenant text, in_project text, in_kind text, in_resource text, in_project_seq bigint, in_authoring_version bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_project_notification(in_tenant text, in_project text, in_kind text, in_resource text, in_project_seq bigint, in_authoring_version bigint) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.read_agentic_refusals(in_tenant text, in_project text, in_ticket bigint, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_agentic_refusals(in_tenant text, in_project text, in_ticket bigint, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_lead_inquiries(in_tenant text, in_project text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_lead_inquiries(in_tenant text, in_project text, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_lead_inquiry(in_tenant text, in_project text, in_session text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_lead_inquiry(in_tenant text, in_project text, in_session text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_lead_standing(in_tenant text, in_project text, in_turns_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_lead_standing(in_tenant text, in_project text, in_turns_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_lead_turn(in_turn text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_lead_turn(in_turn text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_project_drafts(in_tenant text, in_project text, in_after bigint, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) TO chuggy_api;
GRANT ALL ON FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) TO chuggy_ticket_service;
GRANT ALL ON FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) TO chuggy_scheduler;
GRANT ALL ON FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) TO chuggy_configuration_importer;
GRANT ALL ON FUNCTION public.read_project_repository_binding(in_tenant text, in_project text, in_repository text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.read_project_repository_landing(in_tenant text, in_project text, in_repository text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_project_repository_landing(in_tenant text, in_project text, in_repository text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_project_threads(in_tenant text, in_project text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_project_threads(in_tenant text, in_project text, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_selector_interactions(in_tenant text, in_project text, in_after bigint, in_max bigint, in_newest_first boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_selector_interactions(in_tenant text, in_project text, in_after bigint, in_max bigint, in_newest_first boolean) TO chuggy_api;
GRANT ALL ON FUNCTION public.read_selector_interactions(in_tenant text, in_project text, in_after bigint, in_max bigint, in_newest_first boolean) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.read_selector_planning_intent(in_tenant text, in_project text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_selector_planning_intent(in_tenant text, in_project text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_session_attempt(in_secret_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_session_attempt(in_secret_digest text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.read_session_store(in_secret_digest text, in_generation bigint, in_stream text, in_after bigint, in_limit bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_session_store(in_secret_digest text, in_generation bigint, in_stream text, in_after bigint, in_limit bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.read_session_store_batches(in_tenant text, in_project text, in_session text, in_stream text, in_after bigint, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_session_store_batches(in_tenant text, in_project text, in_session text, in_stream text, in_after bigint, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_thread_standing(in_tenant text, in_project text, in_session text, in_before bigint, in_turns_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_thread_standing(in_tenant text, in_project text, in_session text, in_before bigint, in_turns_max bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.read_worker_attempt(in_secret_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_worker_attempt(in_secret_digest text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.reap_idle_session_attempts(in_epoch text, in_idle_secs bigint, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reap_idle_session_attempts(in_epoch text, in_idle_secs bigint, in_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.reap_lapsed_session_attempts(in_epoch text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reap_lapsed_session_attempts(in_epoch text, in_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.record_agentic_refusals(in_tenant text, in_project text, in_decision text, in_refusals jsonb, in_lifts jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_agentic_refusals(in_tenant text, in_project text, in_decision text, in_refusals jsonb, in_lifts jsonb) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.record_forge_installation(in_forge text, in_app text, in_account text, in_account_kind text, in_installation_id text, in_tenant text, in_authority_kind text, in_authority_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_forge_installation(in_forge text, in_app text, in_account text, in_account_kind text, in_installation_id text, in_tenant text, in_authority_kind text, in_authority_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.record_session_store_batch(in_secret_digest text, in_generation bigint, in_stream text, in_batch bigint, in_digest text, in_bytes bigint, in_events bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_session_store_batch(in_secret_digest text, in_generation bigint, in_stream text, in_batch bigint, in_digest text, in_bytes bigint, in_events bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.record_worker_run_configuration(in_secret_digest text, in_generation bigint, in_path text, in_digest text, in_bytes bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_worker_run_configuration(in_secret_digest text, in_generation bigint, in_path text, in_digest text, in_bytes bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.record_worker_run_total(in_secret_digest text, in_generation bigint, in_turns bigint, in_duration_ms bigint, in_duration_api_ms bigint, in_tokens_input bigint, in_tokens_output bigint, in_tokens_cache_creation bigint, in_tokens_cache_read bigint, in_cost_usd_micros bigint, in_cost_basis text, in_permission_denials bigint, in_result_subtype text, in_stop_reason text, in_models jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_worker_run_total(in_secret_digest text, in_generation bigint, in_turns bigint, in_duration_ms bigint, in_duration_api_ms bigint, in_tokens_input bigint, in_tokens_output bigint, in_tokens_cache_creation bigint, in_tokens_cache_read bigint, in_cost_usd_micros bigint, in_cost_basis text, in_permission_denials bigint, in_result_subtype text, in_stop_reason text, in_models jsonb) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.record_worker_run_transcript_batch(in_secret_digest text, in_generation bigint, in_batch bigint, in_path text, in_digest text, in_bytes bigint, in_events bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_worker_run_transcript_batch(in_secret_digest text, in_generation bigint, in_batch bigint, in_path text, in_digest text, in_bytes bigint, in_events bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.record_worker_run_turns(in_secret_digest text, in_generation bigint, in_turns jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_worker_run_turns(in_secret_digest text, in_generation bigint, in_turns jsonb) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.release_draft_fenced(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_digest text, in_commit boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_draft_fenced(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_digest text, in_commit boolean) TO chuggy_ticket_service;`,
  `REVOKE ALL ON FUNCTION public.release_session_attempt_turns(in_tenant text, in_project text, in_session text, in_attempt text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.rename_member_thread(in_tenant text, in_project text, in_session text, in_title text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rename_member_thread(in_tenant text, in_project text, in_session text, in_title text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.request_finalization_approval(in_tenant text, in_project text, in_attempt text, in_action text, in_recovery_epoch text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_finalization_approval(in_tenant text, in_project text, in_attempt text, in_action text, in_recovery_epoch text) TO chuggy_finalizer;`,
  `REVOKE ALL ON FUNCTION public.reserve_worker_artifact(in_secret_digest text, in_path text, in_digest text, in_bytes bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_worker_artifact(in_secret_digest text, in_path text, in_digest text, in_bytes bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.result_digest_fold(in_digest text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.retire_project_repository(in_tenant text, in_project text, in_repository text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retire_project_repository(in_tenant text, in_project text, in_repository text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.review_selector_proposal(in_decision text, in_tenant text, in_project text, in_review text, in_reviewer_kind text, in_reviewer_subject text, in_feedback text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_selector_proposal(in_decision text, in_tenant text, in_project text, in_review text, in_reviewer_kind text, in_reviewer_subject text, in_feedback text) TO chuggy_selector_review;`,
  `REVOKE ALL ON FUNCTION public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.selector_project_dispatch_mode(in_tenant text, in_project text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.selector_refusal_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.selector_refusal_is_immutable() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.session_attempt_binding(in_secret_digest text, in_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.session_attempt_binding(in_secret_digest text, in_generation bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.session_attempt_cleanup_completed(in_attempt text, in_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.session_attempt_cleanup_completed(in_attempt text, in_generation bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.session_attempt_is_fenced() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.session_attempt_turn_failure(in_attempt text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.session_attempt_turn_failure(in_attempt text) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.session_attempts_awaiting_cleanup(in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.session_attempts_awaiting_cleanup(in_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.session_attempts_awaiting_observation(in_epoch text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.session_attempts_awaiting_observation(in_epoch text, in_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.session_state_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.session_store_batch_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.session_store_is_immutable() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.session_turn_appends_a_change() FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.sessions_awaiting_placement(in_epoch text, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sessions_awaiting_placement(in_epoch text, in_max bigint) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.set_project_repository_landing(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_project_repository_landing(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.set_selector_host_readiness(in_ready boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_selector_host_readiness(in_ready boolean) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.set_session_capabilities(in_tenant text, in_project text, in_session text, in_capabilities text[]) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.set_session_system_prompt(in_tenant text, in_project text, in_prompt text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_session_system_prompt(in_tenant text, in_project text, in_prompt text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.standing_agentic_refusals(in_tenant text, in_project text, in_max bigint) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.standing_agentic_refusals_among(in_tenant text, in_project text, in_tickets bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.standing_agentic_refusals_among(in_tenant text, in_project text, in_tickets bigint[]) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.store_worker_result_report(in_secret_digest text, in_manifest text, in_report text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_worker_result_report(in_secret_digest text, in_manifest text, in_report text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) TO chuggy_finalizer;`,
  `REVOKE ALL ON FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) TO chuggy_scheduler;`,
  `REVOKE ALL ON FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_operation text) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_source jsonb, in_operation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_source jsonb, in_operation text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.sweep_project_change(in_limit bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sweep_project_change(in_limit bigint) TO chuggy_api;`,
  `REVOKE ALL ON FUNCTION public.thread_wake_candidates(in_after bigint, in_max bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.thread_wake_candidates(in_after bigint, in_max bigint) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.ticket_command_is_valid(command jsonb) FROM PUBLIC;`,
  `REVOKE ALL ON FUNCTION public.update_selector_project_settings(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_selector_project_settings(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text) TO chuggy_api;
GRANT ALL ON FUNCTION public.update_selector_project_settings(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text) TO chuggy_selector_control;`,
  `REVOKE ALL ON FUNCTION public.update_selector_runtime_settings(expected_revision bigint, new_mode text, new_dispatch_mode text, new_base_prompt text, new_controls text, in_administrator_kind text, in_administrator_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_selector_runtime_settings(expected_revision bigint, new_mode text, new_dispatch_mode text, new_base_prompt text, new_controls text, in_administrator_kind text, in_administrator_subject text) TO chuggy_selector_control;`,
  `REVOKE ALL ON FUNCTION public.wake_member_thread(in_tenant text, in_project text, in_principal text, in_turn text, in_input text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wake_member_thread(in_tenant text, in_project text, in_principal text, in_turn text, in_input text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.withdraw_lead_turn(in_turn text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.withdraw_lead_turn(in_turn text) TO chuggy_selector_service;`,
  `REVOKE ALL ON FUNCTION public.withdraw_session_attempt(in_secret_digest text, in_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.withdraw_session_attempt(in_secret_digest text, in_generation bigint) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.withdraw_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.withdraw_worker_attempt(in_secret_digest text, in_generation bigint, in_evidence text) TO chuggy_worker_plane;`,
  `REVOKE ALL ON FUNCTION public.worker_run_binding(in_secret_digest text, in_generation bigint) FROM PUBLIC;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.admitted_worker TO chuggy_scheduler;
GRANT SELECT ON TABLE public.admitted_worker TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(agent_reference) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(capabilities) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(state) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(turn_next) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(attempt_next) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(closed_at) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(system_prompt) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(member_title) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT UPDATE(hidden_at) ON TABLE public.agent_session TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.capacity_account TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.capacity_account TO chuggy_scheduler;`,
  `GRANT SELECT ON TABLE public.commit_permit TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.commit_permit TO chuggy_finalizer;`,
  `GRANT UPDATE(state) ON TABLE public.commit_permit TO chuggy_finalizer;`,
  `GRANT UPDATE(concluded_at) ON TABLE public.commit_permit TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT ON TABLE public.configuration_revision TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.configuration_revision TO chuggy_api;
GRANT SELECT ON TABLE public.configuration_revision TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.configuration_revision TO chuggy_scheduler;
GRANT SELECT ON TABLE public.configuration_revision TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT ON TABLE public.decision_input TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.decision_input TO chuggy_ticket_service;`,
  `GRANT SELECT(tenant) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT SELECT(ordinal) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT SELECT(input_kind) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT SELECT(input_id) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT SELECT(lifecycle_generation) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT UPDATE(state) ON TABLE public.decision_input TO chuggy_boundary_owner;
GRANT UPDATE(state) ON TABLE public.decision_input TO chuggy_ticket_service;
GRANT SELECT(state) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT UPDATE(decided_seq) ON TABLE public.decision_input TO chuggy_ticket_service;
GRANT SELECT(decided_seq) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT UPDATE(outcome_code) ON TABLE public.decision_input TO chuggy_ticket_service;
GRANT SELECT(outcome_code) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT UPDATE(refused_head) ON TABLE public.decision_input TO chuggy_ticket_service;
GRANT SELECT(refused_head) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT UPDATE(refused_lifecycle_generation) ON TABLE public.decision_input TO chuggy_ticket_service;
GRANT SELECT(refused_lifecycle_generation) ON TABLE public.decision_input TO chuggy_api;`,
  `GRANT UPDATE(terminal_at) ON TABLE public.decision_input TO chuggy_boundary_owner;
GRANT UPDATE(terminal_at) ON TABLE public.decision_input TO chuggy_ticket_service;`,
  `GRANT UPDATE(settled_authority_kind) ON TABLE public.decision_input TO chuggy_boundary_owner;
GRANT UPDATE(settled_authority_kind) ON TABLE public.decision_input TO chuggy_ticket_service;`,
  `GRANT UPDATE(settled_authority_subject) ON TABLE public.decision_input TO chuggy_boundary_owner;
GRANT UPDATE(settled_authority_subject) ON TABLE public.decision_input TO chuggy_ticket_service;`,
  `GRANT SELECT ON TABLE public.deployment_authoring_policy TO chuggy_api;
GRANT SELECT,INSERT ON TABLE public.deployment_authoring_policy TO chuggy_ticket_service;`,
  `GRANT UPDATE(domain_configuration) ON TABLE public.deployment_authoring_policy TO chuggy_ticket_service;`,
  `GRANT SELECT ON TABLE public.dispatch_candidate TO chuggy_api;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dispatch_candidate TO chuggy_ticket_service;`,
  `GRANT SELECT ON TABLE public.dispatch_candidate_dependency TO chuggy_api;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dispatch_candidate_dependency TO chuggy_ticket_service;`,
  `GRANT SELECT ON TABLE public.dispatch_view TO chuggy_api;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dispatch_view TO chuggy_ticket_service;`,
  `GRANT SELECT,INSERT ON TABLE public.draft TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.draft TO chuggy_api;
GRANT SELECT ON TABLE public.draft TO chuggy_ticket_service;`,
  `GRANT UPDATE(authoring_version) ON TABLE public.draft TO chuggy_boundary_owner;`,
  `GRANT UPDATE(state) ON TABLE public.draft TO chuggy_boundary_owner;`,
  `GRANT UPDATE(configuration_revision) ON TABLE public.draft TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.draft_brief TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.draft_brief TO chuggy_api;
GRANT SELECT ON TABLE public.draft_brief TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.draft_brief TO chuggy_scheduler;
GRANT SELECT ON TABLE public.draft_brief TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT,DELETE ON TABLE public.draft_brief_check TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.draft_brief_check TO chuggy_api;
GRANT SELECT ON TABLE public.draft_brief_check TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.draft_brief_check TO chuggy_scheduler;
GRANT SELECT ON TABLE public.draft_brief_check TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT,DELETE ON TABLE public.draft_brief_link TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.draft_brief_link TO chuggy_api;
GRANT SELECT ON TABLE public.draft_brief_link TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.draft_brief_link TO chuggy_scheduler;
GRANT SELECT ON TABLE public.draft_brief_link TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT ON TABLE public.draft_revision TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.draft_revision TO chuggy_api;
GRANT SELECT ON TABLE public.draft_revision TO chuggy_ticket_service;`,
  `GRANT SELECT ON TABLE public.execution TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT ON TABLE public.execution TO chuggy_finalizer;`,
  `GRANT INSERT(tenant) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(tenant) ON TABLE public.execution TO chuggy_api;
GRANT SELECT(tenant) ON TABLE public.execution TO chuggy_ticket_service;`,
  `GRANT INSERT(project) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(project) ON TABLE public.execution TO chuggy_api;
GRANT SELECT(project) ON TABLE public.execution TO chuggy_ticket_service;`,
  `GRANT INSERT(execution) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(execution) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(ticket) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(ticket) ON TABLE public.execution TO chuggy_api;
GRANT SELECT(ticket) ON TABLE public.execution TO chuggy_ticket_service;`,
  `GRANT INSERT(task) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(task) ON TABLE public.execution TO chuggy_api;
GRANT SELECT(task) ON TABLE public.execution TO chuggy_ticket_service;`,
  `GRANT INSERT(source_request) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(source_request) ON TABLE public.execution TO chuggy_api;
GRANT SELECT(source_request) ON TABLE public.execution TO chuggy_ticket_service;`,
  `GRANT INSERT(account) ON TABLE public.execution TO chuggy_scheduler;`,
  `GRANT INSERT(cluster) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(cluster) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(configuration_revision) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(configuration_revision) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(configuration_digest) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(configuration_digest) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(requirement_identity) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(requirement_identity) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(requirement_value) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(requirement_value) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(requirement_digest) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(requirement_digest) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(requirement_source) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(requirement_source) ON TABLE public.execution TO chuggy_api;`,
  `GRANT INSERT(platform_default_version) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(platform_default_version) ON TABLE public.execution TO chuggy_api;`,
  `GRANT UPDATE(status) ON TABLE public.execution TO chuggy_boundary_owner;
GRANT UPDATE(status) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(status) ON TABLE public.execution TO chuggy_api;`,
  `GRANT UPDATE(outcome) ON TABLE public.execution TO chuggy_boundary_owner;
GRANT SELECT(outcome) ON TABLE public.execution TO chuggy_api;`,
  `GRANT UPDATE(blocked_reason) ON TABLE public.execution TO chuggy_boundary_owner;`,
  `GRANT UPDATE(result_manifest) ON TABLE public.execution TO chuggy_boundary_owner;
GRANT SELECT(result_manifest) ON TABLE public.execution TO chuggy_api;
GRANT SELECT(result_manifest) ON TABLE public.execution TO chuggy_ticket_service;`,
  `GRANT UPDATE(completion_operation) ON TABLE public.execution TO chuggy_boundary_owner;`,
  `GRANT UPDATE(attempt_next) ON TABLE public.execution TO chuggy_scheduler;`,
  `GRANT UPDATE(retries_spent) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(retries_spent) ON TABLE public.execution TO chuggy_api;
GRANT UPDATE(retries_spent) ON TABLE public.execution TO chuggy_boundary_owner;`,
  `GRANT UPDATE(placement_backoff_from) ON TABLE public.execution TO chuggy_scheduler;
GRANT UPDATE(placement_backoff_from) ON TABLE public.execution TO chuggy_boundary_owner;`,
  `GRANT SELECT(registered_at) ON TABLE public.execution TO chuggy_api;`,
  `GRANT UPDATE(terminal_at) ON TABLE public.execution TO chuggy_boundary_owner;
GRANT UPDATE(terminal_at) ON TABLE public.execution TO chuggy_scheduler;
GRANT SELECT(terminal_at) ON TABLE public.execution TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT SELECT ON TABLE public.execution_attempt TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT SELECT(execution) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT SELECT(attempt_number) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT UPDATE(generation) ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT SELECT(generation) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT UPDATE(state) ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT SELECT(state) ON TABLE public.execution_attempt TO chuggy_api;
GRANT UPDATE(state) ON TABLE public.execution_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(lease_owner) ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT UPDATE(lease_owner) ON TABLE public.execution_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(lease_expires_at) ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT UPDATE(lease_expires_at) ON TABLE public.execution_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(workload) ON TABLE public.execution_attempt TO chuggy_scheduler;`,
  `GRANT UPDATE(evidence) ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT UPDATE(evidence) ON TABLE public.execution_attempt TO chuggy_boundary_owner;
GRANT SELECT(evidence) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT SELECT(opened_at) ON TABLE public.execution_attempt TO chuggy_api;`,
  `GRANT UPDATE(ended_at) ON TABLE public.execution_attempt TO chuggy_scheduler;
GRANT SELECT(ended_at) ON TABLE public.execution_attempt TO chuggy_api;
GRANT UPDATE(ended_at) ON TABLE public.execution_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(cleanup_completed_at) ON TABLE public.execution_attempt TO chuggy_scheduler;`,
  `GRANT SELECT ON TABLE public.execution_cluster TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.execution_cluster TO chuggy_scheduler;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_request TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.execution_request TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.execution_request TO chuggy_scheduler;`,
  `GRANT UPDATE(state) ON TABLE public.execution_request TO chuggy_scheduler;
GRANT UPDATE(state) ON TABLE public.execution_request TO chuggy_boundary_owner;`,
  `GRANT UPDATE(claim_owner) ON TABLE public.execution_request TO chuggy_scheduler;`,
  `GRANT UPDATE(claim_generation) ON TABLE public.execution_request TO chuggy_scheduler;`,
  `GRANT UPDATE(claim_expires_at) ON TABLE public.execution_request TO chuggy_scheduler;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_request_task TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.execution_request_task TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.execution_request_task TO chuggy_scheduler;
GRANT SELECT ON TABLE public.execution_request_task TO chuggy_finalizer;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_request_task TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_request_task TO chuggy_api;`,
  `GRANT SELECT(request) ON TABLE public.execution_request_task TO chuggy_api;`,
  `GRANT SELECT(task) ON TABLE public.execution_request_task TO chuggy_api;`,
  `GRANT SELECT(kind) ON TABLE public.execution_request_task TO chuggy_api;`,
  `GRANT SELECT(stage) ON TABLE public.execution_request_task TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_result TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.execution_result TO chuggy_scheduler;
GRANT SELECT ON TABLE public.execution_result TO chuggy_finalizer;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(manifest) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(schema_version) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(digest) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(verdict) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT(recorded_at) ON TABLE public.execution_result TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_result_artifact TO chuggy_scheduler;
GRANT SELECT ON TABLE public.execution_result_artifact TO chuggy_finalizer;
GRANT INSERT ON TABLE public.execution_result_artifact TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(manifest) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(ordinal) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(role) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(path) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(digest) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT(bytes) ON TABLE public.execution_result_artifact TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_result_report TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.execution_result_report TO chuggy_scheduler;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_result_report TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_result_report TO chuggy_api;`,
  `GRANT SELECT(manifest) ON TABLE public.execution_result_report TO chuggy_api;`,
  `GRANT SELECT(report) ON TABLE public.execution_result_report TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_result_source TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.execution_result_source TO chuggy_scheduler;
GRANT SELECT ON TABLE public.execution_result_source TO chuggy_finalizer;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_result_source TO chuggy_ticket_service;`,
  `GRANT SELECT(project) ON TABLE public.execution_result_source TO chuggy_ticket_service;`,
  `GRANT SELECT(manifest) ON TABLE public.execution_result_source TO chuggy_ticket_service;`,
  `GRANT SELECT(commit) ON TABLE public.execution_result_source TO chuggy_ticket_service;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_run TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT SELECT(execution) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT SELECT(started_at) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT UPDATE(configuration_path) ON TABLE public.execution_run TO chuggy_boundary_owner;
GRANT SELECT(configuration_path) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT UPDATE(configuration_digest) ON TABLE public.execution_run TO chuggy_boundary_owner;
GRANT SELECT(configuration_digest) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT UPDATE(configuration_bytes) ON TABLE public.execution_run TO chuggy_boundary_owner;
GRANT SELECT(configuration_bytes) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT UPDATE(configuration_recorded_at) ON TABLE public.execution_run TO chuggy_boundary_owner;
GRANT SELECT(configuration_recorded_at) ON TABLE public.execution_run TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_run_model_usage TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(execution) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(model) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(tokens_input) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(tokens_output) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(tokens_cache_creation) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(tokens_cache_read) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT(cost_usd_micros) ON TABLE public.execution_run_model_usage TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_run_total TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(execution) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(turns) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(duration_ms) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(duration_api_ms) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(tokens_input) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(tokens_output) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(tokens_cache_creation) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(tokens_cache_read) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(cost_usd_micros) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(cost_basis) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(permission_denials) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(result_subtype) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(stop_reason) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT(recorded_at) ON TABLE public.execution_run_total TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_run_transcript_batch TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(execution) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(batch) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(path) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(digest) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(bytes) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(events) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT(recorded_at) ON TABLE public.execution_run_transcript_batch TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.execution_run_turn TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(execution) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(attempt) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(ordinal) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(model) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(tokens_input) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(tokens_output) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(tokens_cache_creation) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(tokens_cache_read) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT(recorded_at) ON TABLE public.execution_run_turn TO chuggy_api;`,
  `GRANT SELECT ON TABLE public.finalization_attempt TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.finalization_attempt TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.finalization_attempt TO chuggy_finalizer;`,
  `GRANT SELECT ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(tenant) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(project) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(request) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(permit) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(proposal_request) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(head_ref) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(head_commit) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(base_ref) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(base_commit) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(title) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(body) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(creation) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(creation_contradiction) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(creation_evidence) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(reconciliation) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(reconciliation_contradiction) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(reconciliation_evidence) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT INSERT(attempts),UPDATE(attempts) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(refusals) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(declines) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(reconciliations) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_reason) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_commit) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_reading) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_reading_contradiction) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_reading_evidence) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_attempts) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_refusals) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_declines) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT UPDATE(merge_readings) ON TABLE public.finalization_change_proposal TO chuggy_finalizer;`,
  `GRANT SELECT ON TABLE public.finalization_reconciliation TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.finalization_reconciliation TO chuggy_finalizer;`,
  `GRANT UPDATE(verdict) ON TABLE public.finalization_reconciliation TO chuggy_finalizer;`,
  `GRANT UPDATE(observed_commit) ON TABLE public.finalization_reconciliation TO chuggy_finalizer;`,
  `GRANT UPDATE(reconciled_at) ON TABLE public.finalization_reconciliation TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT ON TABLE public.finalization_request TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.finalization_request TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.finalization_request TO chuggy_finalizer;`,
  `GRANT UPDATE(state) ON TABLE public.finalization_request TO chuggy_ticket_service;
GRANT UPDATE(state) ON TABLE public.finalization_request TO chuggy_boundary_owner;
GRANT UPDATE(state) ON TABLE public.finalization_request TO chuggy_finalizer;`,
  `GRANT UPDATE(claim_owner) ON TABLE public.finalization_request TO chuggy_finalizer;`,
  `GRANT UPDATE(claim_generation) ON TABLE public.finalization_request TO chuggy_finalizer;`,
  `GRANT UPDATE(claim_expires_at) ON TABLE public.finalization_request TO chuggy_finalizer;`,
  `GRANT UPDATE(recovery_epoch) ON TABLE public.finalization_request TO chuggy_finalizer;`,
  `GRANT INSERT ON TABLE public.finalization_request_configuration TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.finalization_request_configuration TO chuggy_finalizer;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.forge_installation TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.forge_installation TO chuggy_api;
GRANT SELECT ON TABLE public.forge_installation TO chuggy_worker_plane;
GRANT SELECT ON TABLE public.forge_installation TO chuggy_finalizer;
GRANT SELECT ON TABLE public.forge_installation TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.forge_installation TO chuggy_configuration_importer;`,
  `GRANT SELECT,INSERT ON TABLE public.input_bundle TO chuggy_ticket_service;
GRANT SELECT,INSERT ON TABLE public.input_bundle TO chuggy_finalizer;
GRANT SELECT ON TABLE public.input_bundle TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.input_bundle_reference TO chuggy_ticket_service;
GRANT SELECT,INSERT ON TABLE public.input_bundle_reference TO chuggy_finalizer;
GRANT SELECT ON TABLE public.input_bundle_reference TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.input_bundle_reference TO chuggy_scheduler;`,
  `GRANT SELECT ON TABLE public.installation_authority TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.journal_entry TO chuggy_ticket_service;`,
  `GRANT SELECT(tenant) ON TABLE public.journal_entry TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.journal_entry TO chuggy_api;`,
  `GRANT SELECT(seq) ON TABLE public.journal_entry TO chuggy_api;`,
  `GRANT SELECT(entry) ON TABLE public.journal_entry TO chuggy_api;`,
  `GRANT SELECT(committed_at) ON TABLE public.journal_entry TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.native_action TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.native_action TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.native_action TO chuggy_finalizer;`,
  `GRANT SELECT(tenant) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT SELECT(action) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT SELECT(authorizing_seq) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT SELECT(ticket) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT SELECT(kind) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT UPDATE(state) ON TABLE public.native_action TO chuggy_boundary_owner;
GRANT UPDATE(state) ON TABLE public.native_action TO chuggy_ticket_service;
GRANT SELECT(state) ON TABLE public.native_action TO chuggy_api;`,
  `GRANT UPDATE(resolution) ON TABLE public.native_action TO chuggy_ticket_service;`,
  `GRANT SELECT,INSERT ON TABLE public.native_action_resolution TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.native_action_resolution TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.native_action_resolution TO chuggy_finalizer;`,
  `GRANT SELECT(tenant) ON TABLE public.native_action_resolution TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.native_action_resolution TO chuggy_api;`,
  `GRANT SELECT(action) ON TABLE public.native_action_resolution TO chuggy_api;`,
  `GRANT SELECT(resolution) ON TABLE public.native_action_resolution TO chuggy_api;`,
  `GRANT SELECT ON TABLE public.operation TO chuggy_ticket_service;
GRANT SELECT,INSERT ON TABLE public.operation TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.operation TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.operation TO chuggy_api;`,
  `GRANT SELECT(operation) ON TABLE public.operation TO chuggy_api;`,
  `GRANT SELECT(authority_kind) ON TABLE public.operation TO chuggy_api;`,
  `GRANT SELECT(admission) ON TABLE public.operation TO chuggy_api;`,
  `GRANT UPDATE(command) ON TABLE public.operation TO chuggy_boundary_owner;`,
  `GRANT SELECT(accepted_at) ON TABLE public.operation TO chuggy_api;`,
  `GRANT UPDATE(command_tag) ON TABLE public.operation TO chuggy_boundary_owner;`,
  `GRANT SELECT(via_session) ON TABLE public.operation TO chuggy_api;`,
  `GRANT SELECT ON TABLE public.project TO chuggy_ticket_service;
GRANT SELECT,INSERT ON TABLE public.project TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.project TO chuggy_api;
GRANT SELECT(tenant) ON TABLE public.project TO chuggy_scheduler;
GRANT SELECT(tenant) ON TABLE public.project TO chuggy_finalizer;`,
  `GRANT SELECT(project) ON TABLE public.project TO chuggy_api;
GRANT SELECT(project) ON TABLE public.project TO chuggy_scheduler;
GRANT SELECT(project) ON TABLE public.project TO chuggy_finalizer;`,
  `GRANT SELECT(lifecycle) ON TABLE public.project TO chuggy_api;
GRANT SELECT(lifecycle) ON TABLE public.project TO chuggy_scheduler;
GRANT SELECT(lifecycle) ON TABLE public.project TO chuggy_finalizer;`,
  `GRANT SELECT(lifecycle_generation) ON TABLE public.project TO chuggy_api;
GRANT SELECT(lifecycle_generation) ON TABLE public.project TO chuggy_scheduler;
GRANT SELECT(lifecycle_generation) ON TABLE public.project TO chuggy_finalizer;`,
  `GRANT UPDATE(fencing_epoch) ON TABLE public.project TO chuggy_ticket_service;
GRANT SELECT(fencing_epoch) ON TABLE public.project TO chuggy_api;`,
  `GRANT UPDATE(head) ON TABLE public.project TO chuggy_ticket_service;
GRANT SELECT(head) ON TABLE public.project TO chuggy_api;`,
  `GRANT UPDATE(owner) ON TABLE public.project TO chuggy_ticket_service;`,
  `GRANT UPDATE(lease_expires_at) ON TABLE public.project TO chuggy_ticket_service;`,
  `GRANT UPDATE(recovery_epoch) ON TABLE public.project TO chuggy_ticket_service;`,
  `GRANT UPDATE(ingress_next) ON TABLE public.project TO chuggy_ticket_service;
GRANT UPDATE(ingress_next) ON TABLE public.project TO chuggy_boundary_owner;`,
  `GRANT UPDATE(ticket_next) ON TABLE public.project TO chuggy_boundary_owner;
GRANT UPDATE(ticket_next) ON TABLE public.project TO chuggy_ticket_service;`,
  `GRANT UPDATE(notification_next) ON TABLE public.project TO chuggy_boundary_owner;
GRANT SELECT(notification_next) ON TABLE public.project TO chuggy_api;`,
  `GRANT SELECT(manifest_next),UPDATE(manifest_next) ON TABLE public.project TO chuggy_scheduler;
GRANT UPDATE(manifest_next) ON TABLE public.project TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT,DELETE ON TABLE public.project_change TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.project_change TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.project_continuation TO chuggy_ticket_service;`,
  `GRANT SELECT,INSERT,DELETE ON TABLE public.project_notification TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.project_notification TO chuggy_api;`,
  `GRANT SELECT ON TABLE public.project_readiness TO chuggy_api;
GRANT SELECT ON TABLE public.project_readiness TO chuggy_ticket_service;
GRANT SELECT,INSERT ON TABLE public.project_readiness TO chuggy_boundary_owner;`,
  `GRANT UPDATE(ready) ON TABLE public.project_readiness TO chuggy_ticket_service;
GRANT UPDATE(ready) ON TABLE public.project_readiness TO chuggy_boundary_owner;`,
  `GRANT UPDATE(generation) ON TABLE public.project_readiness TO chuggy_boundary_owner;`,
  `GRANT SELECT ON TABLE public.project_repository TO chuggy_finalizer;
GRANT SELECT,INSERT ON TABLE public.project_repository TO chuggy_boundary_owner;`,
  `GRANT UPDATE(recovery_epoch) ON TABLE public.project_repository TO chuggy_boundary_owner;`,
  `GRANT UPDATE(landing_mode) ON TABLE public.project_repository TO chuggy_boundary_owner;`,
  `GRANT UPDATE(retired_at) ON TABLE public.project_repository TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.project_repository_bind_operation TO chuggy_boundary_owner;`,
  `GRANT SELECT ON TABLE public.recovery_epoch TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.recovery_epoch TO chuggy_scheduler;
GRANT SELECT ON TABLE public.recovery_epoch TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.recovery_epoch TO chuggy_finalizer;`,
  `GRANT SELECT(ordinal) ON TABLE public.recovery_epoch TO chuggy_api;`,
  `GRANT SELECT(epoch) ON TABLE public.recovery_epoch TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.repository_configuration_provenance TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.repository_configuration_provenance TO chuggy_api;
GRANT SELECT ON TABLE public.repository_configuration_provenance TO chuggy_ticket_service;`,
  `GRANT SELECT,INSERT ON TABLE public.repository_configuration_version TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.repository_configuration_version TO chuggy_api;`,
  `GRANT SELECT,INSERT ON TABLE public.scheduler_incident TO chuggy_scheduler;
GRANT INSERT ON TABLE public.scheduler_incident TO chuggy_boundary_owner;`,
  `GRANT SELECT ON TABLE public.schema_migration TO chuggy_api;
GRANT SELECT ON TABLE public.schema_migration TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.schema_migration TO chuggy_selector_service;
GRANT SELECT ON TABLE public.schema_migration TO chuggy_scheduler;
GRANT SELECT ON TABLE public.schema_migration TO chuggy_finalizer;
GRANT SELECT ON TABLE public.schema_migration TO chuggy_selector_review;
GRANT SELECT ON TABLE public.schema_migration TO chuggy_configuration_importer;`,
  `GRANT SELECT,INSERT ON TABLE public.selector_agentic_refusal TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.selector_attempt TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.selector_attempt TO chuggy_selector_service;`,
  `GRANT UPDATE(settings_revision) ON TABLE public.selector_attempt TO chuggy_selector_service;`,
  `GRANT UPDATE(observation_digest) ON TABLE public.selector_attempt TO chuggy_selector_service;`,
  `GRANT UPDATE(project_settings_revision) ON TABLE public.selector_attempt TO chuggy_selector_service;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.selector_decision_permit TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.selector_decision_permit TO chuggy_selector_service;`,
  `GRANT SELECT,INSERT ON TABLE public.selector_interaction TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_interaction TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.selector_interaction_resource TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_interaction_resource TO chuggy_boundary_owner;`,
  `GRANT SELECT,UPDATE ON TABLE public.selector_inventory_state TO chuggy_selector_service;`,
  `GRANT SELECT,INSERT ON TABLE public.selector_observation TO chuggy_boundary_owner;
GRANT SELECT,INSERT ON TABLE public.selector_observation TO chuggy_selector_service;`,
  `GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.selector_planning_intent TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_planning_intent TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.selector_project_settings TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.selector_project_settings TO chuggy_api;
GRANT SELECT ON TABLE public.selector_project_settings TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_project_settings TO chuggy_selector_control;`,
  `GRANT INSERT ON TABLE public.selector_project_settings_history TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.selector_project_settings_history TO chuggy_api;
GRANT SELECT ON TABLE public.selector_project_settings_history TO chuggy_selector_control;`,
  `GRANT SELECT,INSERT,UPDATE ON TABLE public.selector_project_state TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_project_state TO chuggy_boundary_owner;`,
  `GRANT SELECT,UPDATE ON TABLE public.selector_proposal_delivery TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.selector_proposal_delivery TO chuggy_selector_control;
GRANT SELECT,INSERT ON TABLE public.selector_proposal_delivery TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_proposal_delivery TO chuggy_selector_review;`,
  `GRANT INSERT ON TABLE public.selector_proposal_review TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.selector_proposal_review TO chuggy_selector_review;`,
  `GRANT SELECT,UPDATE ON TABLE public.selector_runtime_readiness TO chuggy_boundary_owner;`,
  `GRANT SELECT,UPDATE ON TABLE public.selector_runtime_settings TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.selector_runtime_settings TO chuggy_selector_service;
GRANT SELECT ON TABLE public.selector_runtime_settings TO chuggy_selector_control;
GRANT SELECT ON TABLE public.selector_runtime_settings TO chuggy_api;`,
  `GRANT INSERT ON TABLE public.selector_runtime_settings_history TO chuggy_boundary_owner;
GRANT SELECT ON TABLE public.selector_runtime_settings_history TO chuggy_selector_control;`,
  `GRANT SELECT,INSERT ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(generation) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(state) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(lease_owner) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(lease_expires_at) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(placement) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(evidence) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(idle_since) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(ended_at) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT UPDATE(cleanup_completed_at) ON TABLE public.session_attempt TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.session_store_batch TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(state) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(attempt) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(claim_generation) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(attempts_spent) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(result) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(failure) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(batch_first) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(batch_last) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(claimed_at) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(ended_at) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(model) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(tokens) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(cost_micros) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(duration_ms) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT UPDATE(tools) ON TABLE public.session_turn TO chuggy_boundary_owner;`,
  `GRANT SELECT ON TABLE public.thread_wake_cursor TO chuggy_selector_service;
GRANT SELECT ON TABLE public.thread_wake_cursor TO chuggy_boundary_owner;`,
  `GRANT UPDATE(sequence) ON TABLE public.thread_wake_cursor TO chuggy_boundary_owner;`,
  `GRANT SELECT,INSERT ON TABLE public.ticket_projection TO chuggy_ticket_service;
GRANT SELECT ON TABLE public.ticket_projection TO chuggy_boundary_owner;`,
  `GRANT SELECT(tenant) ON TABLE public.ticket_projection TO chuggy_api;`,
  `GRANT SELECT(project) ON TABLE public.ticket_projection TO chuggy_api;`,
  `GRANT SELECT(ticket) ON TABLE public.ticket_projection TO chuggy_api;`,
  `GRANT UPDATE(phase) ON TABLE public.ticket_projection TO chuggy_ticket_service;
GRANT SELECT(phase) ON TABLE public.ticket_projection TO chuggy_api;`,
  `GRANT UPDATE(seq) ON TABLE public.ticket_projection TO chuggy_ticket_service;
GRANT SELECT(seq) ON TABLE public.ticket_projection TO chuggy_api;`,
  `GRANT SELECT(dependable) ON TABLE public.ticket_projection TO chuggy_api;
GRANT UPDATE(dependable) ON TABLE public.ticket_projection TO chuggy_ticket_service;`,
  `GRANT SELECT(reason) ON TABLE public.ticket_projection TO chuggy_api;
GRANT UPDATE(reason) ON TABLE public.ticket_projection TO chuggy_ticket_service;`,
  `GRANT SELECT(resume_at) ON TABLE public.ticket_projection TO chuggy_api;
GRANT UPDATE(resume_at) ON TABLE public.ticket_projection TO chuggy_ticket_service;`,
  `GRANT SELECT(gas_left) ON TABLE public.ticket_projection TO chuggy_api;
GRANT UPDATE(gas_left) ON TABLE public.ticket_projection TO chuggy_ticket_service;`,
  `GRANT SELECT(rework_left) ON TABLE public.ticket_projection TO chuggy_api;
GRANT UPDATE(rework_left) ON TABLE public.ticket_projection TO chuggy_ticket_service;`,
  `GRANT SELECT(finalization_left) ON TABLE public.ticket_projection TO chuggy_api;
GRANT UPDATE(finalization_left) ON TABLE public.ticket_projection TO chuggy_ticket_service;`,
  `GRANT SELECT,INSERT ON TABLE public.worker_artifact_reservation TO chuggy_boundary_owner;`,
];
