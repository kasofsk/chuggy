-- Every ticket the rig has ever run, removed, so the machine starts from an
-- empty journal.
--
-- WHAT THIS IS FOR. The rig is a rehearsal box and its tickets are disposable.
-- A migration that changes what a journal row means (the first was
-- `src/adapters/postgres/schema/migrations/008-escalation-sum.ts`) refuses to
-- apply while any `journal_entry` row exists, because the image that carries it
-- replays no journal written before it: a row left behind would come up with a
-- ticket the actor cannot replay, under a schema that looks migrated. This file
-- is what makes that refusal answerable. It is a release step and not a repair
-- one, and each such migration names it because nothing else can.
--
-- WHAT IT KEEPS is everything a project IS rather than everything it has DONE:
-- the project rows and their lifecycles, configuration revisions and the
-- repository configurations drawn from them, bound repositories and the
-- operations that bound them, forge installations and the authority that
-- claimed them, the deployment authoring policy, the selector's project and
-- runtime settings with their histories, worker pools and their registration
-- tokens, the execution cluster, the capacity entitlements drawn on it,
-- admitted workers and the recovery epochs. Re-onboarding a project is not part
-- of the release, so none of that is in the list below.
--
-- WHY THE SEEDED SINGLETONS ARE NOT IN IT. `thread_wake_cursor`,
-- `selector_inventory_state` and `selector_runtime_readiness` hold one row
-- each, written by the baseline install, and no role holds INSERT on any of
-- them — a truncated one is a row nothing can put back. They carry no ticket,
-- so keeping them is also what they deserve. The cursor is the exception that
-- needs a value rather than a row: it is a position in `project_change`, which
-- the truncate below empties and restarts, so a cursor left where it was would
-- sit past every change the wiped rig is about to produce.
--
-- WHY ONE TRUNCATE AND NO CASCADE. Naming every relation in one statement makes
-- foreign-key order moot, and leaving CASCADE off is what makes the list
-- checkable: a relation that points at one of these and is not named here fails
-- the statement instead of being emptied behind the operator's back.
--
-- RUN IT AS THE OWNER, AGAINST THE TARGET DATABASE, WITH THE CHUGGY
-- DEPLOYMENTS SCALED TO ZERO AND A DUMP TAKEN:
--   psql "$CHUG_PG_URL" -v ON_ERROR_STOP=1 -f deploy/rig/wipe-tickets.sql

BEGIN;

TRUNCATE TABLE
  public.agent_session,
  public.commit_permit,
  public.decision_input,
  public.dispatch_candidate,
  public.dispatch_candidate_dependency,
  public.dispatch_view,
  public.draft,
  public.draft_brief,
  public.draft_brief_check,
  public.draft_brief_link,
  public.draft_revision,
  public.execution,
  public.execution_attempt,
  public.execution_request,
  public.execution_request_task,
  public.execution_result,
  public.execution_result_artifact,
  public.execution_result_report,
  public.execution_result_source,
  public.execution_run,
  public.execution_run_model_usage,
  public.execution_run_total,
  public.execution_run_transcript_batch,
  public.execution_run_turn,
  public.finalization_attempt,
  public.finalization_change_proposal,
  public.finalization_reconciliation,
  public.finalization_request,
  public.input_bundle,
  public.input_bundle_reference,
  public.journal_entry,
  public.native_action,
  public.native_action_resolution,
  public.operation,
  public.project_change,
  public.project_notification,
  public.project_readiness,
  public.scheduler_incident,
  public.selector_agentic_refusal,
  public.selector_attempt,
  public.selector_decision_permit,
  public.selector_interaction,
  public.selector_interaction_resource,
  public.selector_observation,
  public.selector_planning_intent,
  public.selector_project_state,
  public.selector_proposal_delivery,
  public.selector_proposal_review,
  public.session_attempt,
  public.session_store_batch,
  public.session_turn,
  public.ticket_definition,
  public.ticket_projection,
  public.ticket_source,
  public.worker_artifact_reservation
  RESTART IDENTITY;

UPDATE public.project
   SET head = 0,
       ingress_next = 1,
       ticket_next = 1,
       notification_next = 1,
       manifest_next = 1;

UPDATE public.thread_wake_cursor SET sequence = 0;

COMMIT;
