/** One migration: the version that orders it, the name that reports it, and the statements it applies. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const ticketServiceRole = "chuggy_ticket_service";
export const apiRole = "chuggy_api";
export const selectorServiceRole = "chuggy_selector_service";
export const selectorControlRole = "chuggy_selector_control";
export const selectorReviewRole = "chuggy_selector_review";
export const selectorSettingsFunction = "update_selector_runtime_settings";
export const selectorProjectSettingsFunction =
  "update_selector_project_settings";
/** The durable resolution of one project's dispatch mode over the installation default. */
export const selectorProjectDispatchModeFunction =
  "selector_project_dispatch_mode";
/** The trigger that stamps a delivery with the state its project resolves to. */
export const selectorProposalInitialStateFunction =
  "enforce_selector_proposal_initial_state";
/** The SQLSTATE the automatic-dispatch readiness trigger refuses under. */
export const selectorAutomaticReadinessErrorCode = "CHG01";

export const selectorReviewFunction = "review_selector_proposal";
/** Ends every held decision of a project naming a ticket moved past the version its command was fenced at. */
export const selectorProposalRetireFunction = "retire_moved_selector_proposals";
export const selectorReconcileClaimFunction =
  "claim_selector_proposal_reconciliation";
export const selectorClaimFunction = "claim_selector_deliveries";
export const selectorDeliveryFunction = "advance_selector_delivery";
export const selectorAttemptAllocateFunction = "allocate_selector_attempt";
export const selectorAttemptAdvanceFunction = "advance_selector_attempt";
export const selectorAttemptReconcileFunction =
  "claim_selector_attempt_reconciliation";
export const selectorHostReadinessFunction = "set_selector_host_readiness";
export const cancellationFunction = "cancel_pending_operation";
export const acceptanceFunction = "accept_operation";
export const dispatchAcceptanceFunction = "accept_dispatch_operation";
export const configurationCreateFunction = "create_configuration_revision";
export const repositoryConfigurationImportFunction =
  "import_repository_configuration";
export const repositoryActionImportFunction = "import_repository_actions";
export const actionObservationRecordFunction = "record_action_observation";
export const projectCreateFunction = "create_project";
export const projectCreationGrantsFunction = "record_project_creation_grants";
export const repositoryBindingReadFunction = "read_project_repository_binding";
export const repositoryActivationFunction = "activate_project_repository";
export const repositoryBindingWriteFunction = "bind_project_repository";
export const repositoryBindingListFunction = "list_project_repository_bindings";
export const repositoryBindingListAllFunction = "list_repository_bindings";
export const repositoryLandingReadFunction = "read_project_repository_landing";
export const repositoryLandingWriteFunction = "set_project_repository_landing";
export const repositoryRetirementWriteFunction = "retire_project_repository";
export const executionPlacementSetFunction = "set_project_execution_placement";
export const sessionPlacementSetFunction = "set_project_session_placement";
/** The one resolution of where a session kind runs for one project. */
export const sessionRouteFunction = "session_route";
export const sessionRunnerStandingFunction = "session_runner_standing";
/** The route a session's oldest queued turn was admitted on, which is the only one that may run next. */
export const sessionWaitingRouteFunction = "session_waiting_route";
export const forgeInstallationRecordFunction = "record_forge_installation";
export const draftCreateFunction = "create_draft";
export const draftReviseFunction = "revise_draft";
export const draftDeleteFunction = "delete_draft";
export const draftReleaseFunction = "release_draft_fenced";
export const notificationPublishFunction = "publish_project_notification";
export const projectChangeAppendFunction = "append_project_change";
export const projectChangeSweepFunction = "sweep_project_change";
export const projectChangeRetainedFunction = "project_change_retains";
export const projectChangeBridgeFunction =
  "project_notification_appends_a_change";
export const projectChangeExecutionFunction = "execution_appends_a_change";
export const projectChangeArtifactFunction =
  "execution_result_artifact_appends_a_change";
export const projectChangeNativeActionFunction =
  "native_action_appends_a_change";
export const boundaryOwnerRole = "chuggy_boundary_owner";
export const projectAuthorizationFunction = "authorize_project_access";
export const schedulerRole = "chuggy_scheduler";
export const workerPlaneRole = "chuggy_worker_plane";
export const poolPlaneRole = "chuggy_pool_plane";
export const workerPoolFenceFunction = "fence_worker_pool_attempts";
export const workerPoolReleaseFunction = "release_worker_pool_assignment";
export const poolSessionsAwaitingFunction = "pool_sessions_awaiting_claim";
export const poolSessionOpenFunction = "open_pool_session_attempt";
export const poolSessionAssignmentsFunction = "pool_session_assignments";
export const poolSessionHoldingFunction = "pool_session_attempt_holding";
export const poolSessionRenewFunction = "renew_pool_session_attempt";
export const poolSessionHeldFunction = "pool_session_attempt_held";
export const poolSessionRefuseFunction = "refuse_pool_session_attempt";
export const poolSessionReleaseFunction = "release_pool_session_attempt";
export const poolSessionImagesFunction = "pool_session_images";
/** When a session's oldest queued turn could first be claimed: its enqueue, the end of the turn before it, or its return to the queue by an attempt that had claimed it. */
export const sessionClaimableSinceFunction = "session_turn_claimable_since";
export const configurationImporterRole = "chuggy_configuration_importer";
export const workerAttemptReadFunction = "read_worker_attempt";
export const workerTaskReadFunction = "read_worker_task";
export const workerAttemptHeartbeatFunction = "heartbeat_worker_attempt";
export const workerAttemptLostFunction = "lose_worker_attempt";
export const workerAttemptWithdrawFunction = "withdraw_worker_attempt";
export const workerResultSubmitFunction = "submit_worker_result";
export const workerResultReportFunction = "store_worker_result_report";
export const workerArtifactReserveFunction = "reserve_worker_artifact";
export const workerRunBindingFunction = "worker_run_binding";
export const workerRunConfigurationFunction = "record_worker_run_configuration";
export const workerRunTranscriptFunction = "record_worker_run_transcript_batch";
export const workerRunTurnsFunction = "record_worker_run_turns";
export const workerRunTotalFunction = "record_worker_run_total";
export const runEvidenceImmutableFunction =
  "execution_run_evidence_is_immutable";
export const runConfigurationImmutableFunction =
  "execution_run_is_written_once";
export const projectChangeRunFunction = "execution_run_appends_a_change";
export const sessionOpenFunction = "open_agent_session";
export const sessionCloseFunction = "close_agent_session";
export const sessionTurnEnqueueFunction = "enqueue_session_turn";
export const sessionsAwaitingPlacementFunction = "sessions_awaiting_placement";
export const sessionAttemptOpenFunction = "open_session_attempt";
export const sessionAttemptPlaceFunction = "place_session_attempt";
export const sessionAttemptEndFunction = "end_session_attempt";
export const sessionAttemptReapLapsedFunction = "reap_lapsed_session_attempts";
export const sessionAttemptReapIdleFunction = "reap_idle_session_attempts";
export const sessionPoolTurnWithdrawFunction = "withdraw_unserved_pool_turns";
export const sessionAttemptFenceFunction = "fence_old_epoch_session_attempts";
export const sessionAttemptCleanupFunction =
  "session_attempts_awaiting_cleanup";
export const sessionAttemptObservationFunction =
  "session_attempts_awaiting_observation";
export const sessionAttemptTurnFailureFunction = "session_attempt_turn_failure";
export const sessionAttemptCleanupCompletedFunction =
  "session_attempt_cleanup_completed";
export const sessionAttemptBindingFunction = "session_attempt_binding";
export const sessionAttemptReadFunction = "read_session_attempt";
export const sessionTaskReadFunction = "read_session_task";
export const sessionAttemptHeartbeatFunction = "heartbeat_session_attempt";
export const sessionAttemptLoseFunction = "lose_session_attempt";
export const sessionBearerTurnFailureFunction = "session_bearer_turn_failure";
export const sessionAttemptWithdrawFunction = "withdraw_session_attempt";
export const sessionReferenceBindFunction = "bind_session_reference";
export const sessionTurnClaimFunction = "claim_session_turn";
export const sessionTurnAnswerFunction = "answer_session_turn";
export const sessionTurnFailFunction = "fail_session_turn";
export const sessionStoreBatchRecordFunction = "record_session_store_batch";
export const sessionStoreReadFunction = "read_session_store";
export const sessionStreamListFunction = "list_session_streams";
export const sessionBearerAuthenticateFunction = "authenticate_session_bearer";
export const sessionAttemptFencedFunction = "session_attempt_is_fenced";
export const sessionTurnReleaseFunction = "release_session_attempt_turns";
export const sessionStoreImmutableFunction = "session_store_is_immutable";
export const sessionReferenceWrittenOnceFunction =
  "agent_session_is_written_once";
export const sessionSystemPromptSetFunction = "set_session_system_prompt";
export const projectDraftsReadFunction = "read_project_drafts";
export const agenticRefusalRecordFunction = "record_agentic_refusals";
export const agenticRefusalStandingFunction = "standing_agentic_refusals";
export const agenticRefusalStandingAmongFunction =
  "standing_agentic_refusals_among";
export const leadOpenFunction = "open_project_lead";
export const leadSessionFunction = "lead_session";
export const leadTurnEnqueueFunction = "enqueue_lead_turn";
export const leadTurnReadFunction = "read_lead_turn";
export const leadTurnWithdrawFunction = "withdraw_lead_turn";
export const agenticRefusalLedgerReadFunction = "read_agentic_refusals";
export const agenticRefusalStandingReadFunction =
  "read_standing_agentic_refusals";
export const selectorInteractionsReadFunction = "read_selector_interactions";
export const selectorPlanningIntentReadFunction =
  "read_selector_planning_intent";
export const leadStandingReadFunction = "read_lead_standing";
export const leadStoreReadFunction = "read_lead_store";
export const leadStreamListFunction = "list_lead_store_streams";
export const sessionStoreBatchesReadFunction = "read_session_store_batches";
export const sessionStoreStreamListFunction = "list_session_store_streams";
export const sessionCapabilitiesSetFunction = "set_session_capabilities";
export const threadOpenFunction = "open_member_thread";
export const threadMessageEnqueueFunction = "enqueue_thread_message";
export const threadCloseFunction = "close_member_thread";
export const threadRenameFunction = "rename_member_thread";
export const threadHideFunction = "hide_member_thread";
export const threadTurnStopFunction = "stop_thread_turn";
export const sessionTurnStoppedFunction = "session_turn_stopped";
export const sessionLivePublishFunction = "publish_session_live";
export const threadWakeFunction = "wake_member_thread";
export const projectThreadsReadFunction = "read_project_threads";
export const threadStandingReadFunction = "read_thread_standing";
export const threadWakeCandidatesFunction = "thread_wake_candidates";
export const threadWakeCursorAdvanceFunction = "advance_thread_wake_cursor";
export const leadInquiryOpenFunction = "open_lead_inquiry";
export const leadInquiriesReadFunction = "read_lead_inquiries";
export const leadInquiryReadFunction = "read_lead_inquiry";
export const inquiryStoreRefusalFunction = "inquiry_writes_no_store_batch";
export const inquiryCloseFunction = "inquiry_closes_with_its_turn";
export const agenticRefusalImmutableFunction = "selector_refusal_is_immutable";
export const projectChangeAgenticRefusalFunction = "selector_refusal_change";
export const projectChangeSessionTurnFunction = "session_turn_appends_a_change";
export const projectChangeSessionStoreFunction =
  "session_store_batch_appends_a_change";
export const projectChangeSessionStateFunction =
  "session_state_appends_a_change";
export const finalizerRole = "chuggy_finalizer";
export const completionFunction = "submit_task_completion";
/**
 * What that function answers a passed work result whose commit no source row
 * records. The ticket's next spawn would have nowhere to run, so the door
 * settles nothing and the scheduler names it rather than reading it as a
 * binding it built wrong.
 */
export const sourceUnrecordedResult = "SourceUnrecorded";
/**
 * What it answers an evaluator's report whose cycle records no passed work
 * result. A judgement is asked under the reference the work reported, so with
 * no such row there is no context to build the obligation from and the door
 * settles nothing.
 */
export const workResultUnrecordedResult = "WorkResultUnrecorded";
export const finalizationFunction = "submit_finalization_result";
export const approvalRequestFunction = "request_finalization_approval";
export const activeWorkFunction = "project_active_work";
export const backlogFunction = "execution_backlog";
export const statusMoveFunction = "execution_status_move_is_legal";
export const digestFoldFunction = "result_digest_fold";
export const accountProvisionFunction = "project_draws_a_capacity_account";
export const accountIdentityFunction = "project_capacity_account";

/** Creates a runtime role if this cluster has never seen it. */
export function roleStatement(role: string): string {
  return `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
      CREATE ROLE ${role} NOLOGIN;
    END IF;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END
  $$
`;
}
