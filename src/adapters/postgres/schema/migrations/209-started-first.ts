/**
 * Admission and launch take a started ticket's execution before an unstarted
 * ticket's, and the oldest ticket's before a younger one's, as the claims do.
 *
 * `execution_attempt_started` IS WHETHER A TICKET IS STARTED, AND IT IS STATED
 * NOWHERE ELSE. A ticket is started where an execution of it was registered
 * strictly before the execution named, which a spawn set's executions,
 * registered together, never are; or where an attempt of that execution other
 * than the one named was claimed, which one withdrawn before any runner took
 * it was not. A null attempt names an execution's attempt yet to open, so any
 * claimed attempt of it counts: that is how admission and launch, which rank
 * executions with no live attempt, ask the claims' own question. Its body is
 * 147's with `<>` read as `IS DISTINCT FROM`, which answers a named attempt as
 * it did. The scheduler executes it and `execution_ticket_registered`, both
 * with its own privileges over the columns they read.
 */

import {
  executionAttemptStartedFunction,
  executionTicketRegisteredFunction,
  schedulerRole,
  type Migration,
} from "../shared.ts";

const started = `public.${executionAttemptStartedFunction}(in_tenant text, in_project text, in_execution text, in_attempt text)`;

const registered = `public.${executionTicketRegisteredFunction}(in_tenant text, in_project text, in_ticket bigint)`;

export const migration209: Migration = {
  version: 209,
  name: "admission and launch take a started ticket first",
  statements: [
    `CREATE OR REPLACE FUNCTION ${started} RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT EXISTS(SELECT 1 FROM execution x JOIN execution s
                  ON s.tenant=x.tenant AND s.project=x.project AND s.ticket=x.ticket
                WHERE x.tenant=in_tenant AND x.project=in_project AND x.execution=in_execution
                  AND s.registered_at<x.registered_at)
           OR EXISTS(SELECT 1 FROM execution_attempt c
                WHERE c.tenant=in_tenant AND c.project=in_project AND c.execution=in_execution
                  AND c.attempt IS DISTINCT FROM in_attempt AND c.claimed_at IS NOT NULL)
     $$`,
    `GRANT EXECUTE ON FUNCTION ${started} TO ${schedulerRole}`,
    `GRANT EXECUTE ON FUNCTION ${registered} TO ${schedulerRole}`,
  ],
};
