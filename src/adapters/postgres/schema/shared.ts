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
export const selectorReviewFunction = "review_selector_proposal";
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
export const continuationFunction = "publish_continuation";
export const configurationCreateFunction = "create_configuration_revision";
export const repositoryConfigurationImportFunction =
  "import_repository_configuration";
export const repositoryBindingReadFunction = "read_project_repository_binding";
export const repositoryActivationFunction = "activate_project_repository";
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
export const configurationImporterRole = "chuggy_configuration_importer";
export const workerAttemptReadFunction = "read_worker_attempt";
export const workerAttemptHeartbeatFunction = "heartbeat_worker_attempt";
export const workerAttemptLostFunction = "lose_worker_attempt";
export const workerResultSubmitFunction = "submit_worker_result";
export const workerResultReportFunction = "store_worker_result_report";
export const workerArtifactReserveFunction = "reserve_worker_artifact";
export const finalizerRole = "chuggy_finalizer";
export const completionFunction = "submit_task_completion";
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

/** A closed set of text values as the SQL list a CHECK compares against. */
export function schemaTextSet(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}
