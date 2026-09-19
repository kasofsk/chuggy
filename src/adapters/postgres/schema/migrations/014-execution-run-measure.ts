import { apiRole, workerPlaneRole, type Migration } from "../shared.ts";

/**
 * What one attempt's run spent, reported by the workload and by nobody else.
 *
 * THE ROWS ARE THE ATTEMPT'S AND NOT THE TASK'S. A `ticket_execution` row is
 * one per task and is mutated in place, so a measure keyed on it alone would be
 * overwritten by the next attempt and a comparison between attempts would be
 * impossible. The attempt number is part of every key here, and a claim that
 * starts an attempt starts an empty measure rather than inheriting one.
 *
 * A TURN CARRIES NO INSTANT. The plane dates the row it stores, because a
 * harness clock belongs to a machine this tree has never seen and is no
 * authority on when a row was written; the durations a run reports are the
 * workload's own account of itself and are stored as that.
 *
 * ONLY THE PLANE A HARNESS REACHES WRITES THESE, and only the API reads them.
 * Nothing clears a measure, because the attempt it belongs to is in its key and
 * the next attempt writes its own; what an earlier attempt spent stays readable.
 * Neither the scheduler nor the plane pools poll holds anything here: a
 * claimant reports no measure and cannot forge one.
 */
export const migration014: Migration = {
  version: 14,
  name: "execution-run-measure",
  statements: [
    `CREATE TABLE ticket_execution_run_turn (
       tenant text NOT NULL, project text NOT NULL, task_key text NOT NULL,
       attempt integer NOT NULL CHECK(attempt >= 0),
       ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 1000),
       model text NOT NULL CHECK(length(model) BETWEEN 1 AND 128),
       tokens_input bigint NOT NULL CHECK(tokens_input >= 0),
       tokens_output bigint NOT NULL CHECK(tokens_output >= 0),
       tokens_cache_creation bigint NOT NULL CHECK(tokens_cache_creation >= 0),
       tokens_cache_read bigint NOT NULL CHECK(tokens_cache_read >= 0),
       recorded_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,task_key,attempt,ordinal),
       FOREIGN KEY(tenant,project,task_key) REFERENCES ticket_execution(tenant,project,task_key) ON DELETE CASCADE)`,
    `CREATE TABLE ticket_execution_run_total (
       tenant text NOT NULL, project text NOT NULL, task_key text NOT NULL,
       attempt integer NOT NULL CHECK(attempt >= 0),
       turns bigint NOT NULL CHECK(turns >= 0),
       duration_ms bigint NOT NULL CHECK(duration_ms >= 0),
       duration_api_ms bigint NOT NULL CHECK(duration_api_ms >= 0),
       tokens_input bigint NOT NULL CHECK(tokens_input >= 0),
       tokens_output bigint NOT NULL CHECK(tokens_output >= 0),
       tokens_cache_creation bigint NOT NULL CHECK(tokens_cache_creation >= 0),
       tokens_cache_read bigint NOT NULL CHECK(tokens_cache_read >= 0),
       cost_usd_micros bigint NOT NULL CHECK(cost_usd_micros >= 0),
       cost_basis text NOT NULL CHECK(cost_basis IN ('List')),
       permission_denials bigint NOT NULL CHECK(permission_denials >= 0),
       result_subtype text CHECK(result_subtype IS NULL OR length(result_subtype) BETWEEN 1 AND 64),
       stop_reason text CHECK(stop_reason IS NULL OR length(stop_reason) BETWEEN 1 AND 64),
       recorded_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,task_key,attempt),
       FOREIGN KEY(tenant,project,task_key) REFERENCES ticket_execution(tenant,project,task_key) ON DELETE CASCADE)`,
    `CREATE TABLE ticket_execution_run_model_usage (
       tenant text NOT NULL, project text NOT NULL, task_key text NOT NULL,
       attempt integer NOT NULL CHECK(attempt >= 0),
       model text NOT NULL CHECK(length(model) BETWEEN 1 AND 128),
       tokens_input bigint NOT NULL CHECK(tokens_input >= 0),
       tokens_output bigint NOT NULL CHECK(tokens_output >= 0),
       tokens_cache_creation bigint NOT NULL CHECK(tokens_cache_creation >= 0),
       tokens_cache_read bigint NOT NULL CHECK(tokens_cache_read >= 0),
       cost_usd_micros bigint NOT NULL CHECK(cost_usd_micros >= 0),
       PRIMARY KEY(tenant,project,task_key,attempt,model),
       FOREIGN KEY(tenant,project,task_key) REFERENCES ticket_execution(tenant,project,task_key) ON DELETE CASCADE)`,
    `GRANT SELECT,INSERT ON ticket_execution_run_turn,
       ticket_execution_run_total,ticket_execution_run_model_usage TO ${workerPlaneRole}`,
    `GRANT SELECT ON ticket_execution_run_turn,
       ticket_execution_run_total,ticket_execution_run_model_usage TO ${apiRole}`,
  ],
};
