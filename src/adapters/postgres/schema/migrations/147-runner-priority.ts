/**
 * A project on a member's allowlist has a priority, and a claim takes a ticket
 * already started before one that is new.
 *
 * THE PRIORITY IS THE OWNER'S, ONE PER PROJECT ON THEIR LIST. Every row reads
 * `Normal` until its owner writes otherwise, so every runner claims as it did.
 * The API writes it; the pool plane reads it for a personal runner's order.
 *
 * `execution_attempt_started` IS WHETHER A TICKET IS STARTED, AND IT IS STATED
 * NOWHERE ELSE. A ticket is started where an execution of it was registered
 * strictly before the attempt's own, which a spawn set's executions,
 * registered together, never are; or where an earlier attempt of the
 * attempt's own execution was claimed, which one withdrawn before any runner
 * took it was not. `execution_ticket_registered` is a ticket's age, its first
 * execution's registration. Both run with their caller's privileges, so the
 * pool plane reads the columns they read, and both find a ticket's executions
 * through `execution_names_one_logical_task`, which leads with `(tenant,
 * project, ticket)`, rather than through the project's whole history.
 */

import {
  apiRole,
  boundaryOwnerRole,
  executionAttemptStartedFunction,
  executionTicketRegisteredFunction,
  poolPlaneRole,
  type Migration,
} from "../shared.ts";

const started = `public.${executionAttemptStartedFunction}(in_tenant text, in_project text, in_execution text, in_attempt text)`;

const registered = `public.${executionTicketRegisteredFunction}(in_tenant text, in_project text, in_ticket bigint)`;

/** The ownership every function this adds ends with, executed by the pool plane alone. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${poolPlaneRole}`,
  ];
}

export const migration147: Migration = {
  version: 147,
  name: "a member's runners take a higher project first, and a started ticket before a new one",
  statements: [
    `ALTER TABLE public.personal_runner_project
       ADD COLUMN priority text NOT NULL DEFAULT 'Normal'
         CONSTRAINT personal_runner_project_priority_is_known
         CHECK (priority = ANY (ARRAY['High'::text, 'Normal'::text, 'Low'::text]))`,
    `GRANT UPDATE(priority) ON TABLE public.personal_runner_project TO ${apiRole}`,
    `GRANT SELECT(priority) ON TABLE public.personal_runner_project TO ${poolPlaneRole}`,
    `GRANT SELECT(ticket,registered_at) ON TABLE public.execution TO ${poolPlaneRole}`,
    `GRANT SELECT(claimed_at) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `CREATE FUNCTION ${started} RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT EXISTS(SELECT 1 FROM execution x JOIN execution s
                  ON s.tenant=x.tenant AND s.project=x.project AND s.ticket=x.ticket
                WHERE x.tenant=in_tenant AND x.project=in_project AND x.execution=in_execution
                  AND s.registered_at<x.registered_at)
           OR EXISTS(SELECT 1 FROM execution_attempt c
                WHERE c.tenant=in_tenant AND c.project=in_project AND c.execution=in_execution
                  AND c.attempt<>in_attempt AND c.claimed_at IS NOT NULL)
     $$`,
    ...owned(started),
    `CREATE FUNCTION ${registered} RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT min(s.registered_at) FROM execution s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.ticket=in_ticket
     $$`,
    ...owned(registered),
  ],
};
