/**
 * A slot a started ticket's completion freed waits for that ticket's next
 * stage, and `execution_between_stages` is the one statement of which
 * completions it waits for.
 *
 * A COMPLETION IS BETWEEN STAGES FROM ITS SUBMISSION UNTIL THE TICKET SERVICE
 * ANSWERS IT WITH NO NEXT STAGE, OR UNTIL ITS NEXT STAGE IS ADMITTED. It is
 * between stages while its decision input is pending, deferred passes
 * included, and once journaled while a spawn request of the same ticket that
 * the same journal entry authorized is still open or has an execution queued
 * for a slot in the cluster. A completion refused, cancelled, or journaled
 * with no spawn of its own ticket is not, nor is one whose next stage queued
 * for a person, which names no requirement, nor one in a project that is not
 * `Active`, whose inputs nothing answers. The freed slot is the completion's
 * own, so each row names the account and the cluster it was freed from, and
 * the function reads only the completions of the cluster it is asked about.
 *
 * Each branch starts from a bounded set: the pending completions, by
 * `decision_input_completion_head`; the open spawn requests, by
 * `execution_request_claimable`; and the cluster's queued executions, by
 * `execution_queued`. It runs as its owner, because the scheduler holds no
 * privilege on `decision_input` or `journal_entry`, and it is granted to the
 * scheduler alone; another plane that needs the fact is granted this. The
 * owner already reads an entry's sequence, and is granted its cause, which is
 * how a spawn request is traced to the completion its entry answered.
 */

import {
  boundaryOwnerRole,
  executionBetweenStagesFunction,
  schedulerRole,
  type Migration,
} from "../shared.ts";

const betweenStages = `public.${executionBetweenStagesFunction}(in_cluster text)`;

export const migration210: Migration = {
  version: 210,
  name: "a freed slot waits for its started ticket's next stage",
  statements: [
    `GRANT SELECT(cause_kind, cause_id) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${betweenStages}
       RETURNS TABLE(tenant text, project text, ticket bigint, account text, execution text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH awaited AS (
         SELECT q.tenant, q.project, q.ticket, q.authorizing_seq
           FROM execution_request q
          WHERE q.state='Open' AND q.kind IN ('SpawnWork','SpawnEvaluation')
         UNION
         SELECT q.tenant, q.project, q.ticket, q.authorizing_seq
           FROM execution n
           JOIN execution_request q
             ON q.tenant=n.tenant AND q.project=n.project AND q.request=n.source_request
          WHERE n.cluster=in_cluster AND n.status='Queued'
            AND n.requirement_value IS NOT NULL
       ), completed AS (
         SELECT c.tenant, c.project, c.ticket, c.account, c.execution
           FROM decision_input d
           JOIN execution c
             ON c.tenant=d.tenant AND c.project=d.project
            AND c.completion_operation=d.input_id
          WHERE d.state='Pending' AND d.base_priority='Completion'
            AND d.input_kind='Operation' AND c.cluster=in_cluster
         UNION
         SELECT c.tenant, c.project, c.ticket, c.account, c.execution
           FROM awaited w
           JOIN journal_entry j
             ON j.tenant=w.tenant AND j.project=w.project AND j.seq=w.authorizing_seq
           JOIN execution c
             ON c.tenant=j.tenant AND c.project=j.project
            AND c.completion_operation=j.cause_id AND c.ticket=w.ticket
          WHERE j.cause_kind='Operation' AND c.cluster=in_cluster
       )
       SELECT s.tenant, s.project, s.ticket, s.account, s.execution
         FROM completed s
         JOIN project p ON p.tenant=s.tenant AND p.project=s.project
        WHERE p.lifecycle='Active'
     $$`,
    `ALTER FUNCTION ${betweenStages} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${betweenStages} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${betweenStages} TO ${schedulerRole}`,
  ],
};
