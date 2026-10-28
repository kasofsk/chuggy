/**
 * The metrics plane's role, which reads what every run cost and how long it
 * took and nothing else.
 *
 * IT IS GRANTED THE COLUMNS ITS ONE READ NAMES, per column, so a column added
 * to any of these relations later is one it cannot read until a migration says
 * it may. It writes nothing and calls no function.
 */

import { metricsPlaneRole, roleStatement, type Migration } from "../shared.ts";

/** Each relation the plane reads, and the columns of it the read names. */
const metricsPlaneColumns: readonly (readonly [string, string])[] = [
  [
    "execution",
    "tenant,project,execution,ticket,task,source_request,owner,placement,configuration_revision",
  ],
  [
    "execution_request_task",
    "tenant,project,request,task,kind,stage,evaluator",
  ],
  ["ticket_definition", "tenant,project,ticket,selection,overrides"],
  [
    "execution_attempt",
    "tenant,project,execution,attempt,state,personal,opened_at,ended_at",
  ],
  [
    "execution_run_total",
    "tenant,project,execution,attempt,turns,duration_ms,duration_api_ms",
  ],
  [
    "execution_run_model_usage",
    "tenant,project,execution,attempt,model,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros",
  ],
  ["configuration_revision", "tenant,project,revision,canonical"],
  [
    "session_turn",
    "tenant,project,session,state,model,tokens,cost_micros,duration_ms,ended_at",
  ],
  ["agent_session", "tenant,project,session,kind,principal"],
  ["ticket_projection", "tenant,project,phase"],
];

export const migration090: Migration = {
  version: 90,
  name: "a metrics plane reads what every run cost",
  statements: [
    roleStatement(metricsPlaneRole),
    `GRANT USAGE ON SCHEMA public TO ${metricsPlaneRole}`,
    `GRANT SELECT ON TABLE public.schema_migration TO ${metricsPlaneRole}`,
    ...metricsPlaneColumns.map(
      ([relation, columns]) =>
        `GRANT SELECT(${columns}) ON TABLE public.${relation} TO ${metricsPlaneRole}`,
    ),
  ],
};
