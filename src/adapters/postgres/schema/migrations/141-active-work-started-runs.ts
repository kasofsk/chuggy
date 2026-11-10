/**
 * A project's active work counts a `Launching` execution whose run has started
 * as running.
 *
 * `project_active_work` IS REPLACED IN PLACE, its arguments and answer as the
 * baseline made them, so its owner and its grants stand. An execution's live
 * attempt is its newest attempt that is `Placing` or `Running`, and its run has
 * started where that attempt has an `execution_run`: the rule the API's
 * execution reads derive a status by, so the counts and the list agree.
 * `launching` counts a `Launching` execution whose live attempt has no started
 * run, and `running` a `Running` one and a `Launching` one whose has. `queued`,
 * `admitted` and the cluster and account totals are as they were: a started run
 * holds the slot its launch held.
 */

import { activeWorkFunction, type Migration } from "../shared.ts";

export const migration141: Migration = {
  version: 141,
  name: "a project's active work counts a started run as running",
  statements: [
    `CREATE OR REPLACE FUNCTION public.${activeWorkFunction}(in_tenant text, in_project text) RETURNS TABLE(queued bigint, admitted bigint, launching bigint, running bigint, cluster_slots_max bigint, cluster_active bigint, account_maximum bigint, account_active bigint, account_deficit bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT own.queued, own.admitted, own.launching, own.running,
              coalesce(c.slots_max, 0)::bigint, coalesce(clustered.active, 0),
              coalesce(a.maximum, 0)::bigint, coalesce(held.active, 0),
              greatest(coalesce(a.reserved, 0) - coalesce(held.active, 0), 0)::bigint
         FROM (SELECT count(*) FILTER (WHERE e.status = 'Queued')    AS queued,
                      count(*) FILTER (WHERE e.status = 'Admitted')  AS admitted,
                      count(*) FILTER (WHERE e.status = 'Launching'
                                         AND live.started_at IS NULL) AS launching,
                      count(*) FILTER (WHERE e.status = 'Running'
                                          OR (e.status = 'Launching'
                                              AND live.started_at IS NOT NULL)) AS running
                 FROM execution e
                 LEFT JOIN LATERAL (SELECT r.started_at FROM execution_attempt x
                     LEFT JOIN execution_run r ON r.tenant = x.tenant AND r.project = x.project
                      AND r.execution = x.execution AND r.attempt = x.attempt
                    WHERE x.tenant = e.tenant AND x.project = e.project
                      AND x.execution = e.execution AND x.state IN ('Placing','Running')
                    ORDER BY x.attempt_number DESC LIMIT 1) live ON true
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
     $$`,
  ],
};
