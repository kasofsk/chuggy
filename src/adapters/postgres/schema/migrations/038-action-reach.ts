/**
 * What the API reads to say where a declared action stands for a landed
 * ticket: the commit the ticket landed at, through one door, and what each
 * action was reported to have done, by grant.
 *
 * A TICKET LANDED AT THE COMMIT ITS NEWEST PROMOTED PERMIT PUT ON THE BRANCH
 * IT WAS BOUND FOR, AND NOWHERE WHILE NOTHING SAYS SO. A landing that advances
 * the branch itself promotes its candidate there, so the candidate is the
 * commit. A landing that proposes promotes the ticket's own branch, which is
 * on no other, so its commit is the one its proposal was merged at: the merge
 * this deployment made, else the merge a reading of the proposal found made,
 * else the merge the evidence its publication was accepted on already showed.
 * Until its proposal's row says one of those it has landed nowhere, whether
 * the row is not yet written, the proposal is still open, or somebody else
 * merged it where merging was not this landing's to do.
 *
 * THE LANDING MODE IS READ WHERE THE FINALIZER'S OWN DOOR READS IT, in the
 * ticket's definition. A promoted permit with no proposal row is a landed
 * ticket under one mode and a held one under another, and no finalizer row
 * tells them apart.
 *
 * THE TIME IS ONE NO COMMIT HOLDING THE LANDED ONE WAS REPORTED BEFORE. A
 * proposal's row is written before its forge is first asked to open it, and a
 * permit is granted before its branch is moved, so each stamp precedes the
 * commit's arrival on the branch.
 *
 * THE DOOR IS A DOOR BECAUSE THE ROWS ARE THE FINALIZER'S. A grant on them
 * would hand the API every project's candidates and proposals, and it needs
 * one commit of one ticket. A retired binding is answered and marked, since a
 * ticket landed where it landed whatever became of the binding.
 *
 * WHAT WAS REPORTED IS READ BY GRANT, as what is declared is, and without who
 * reported it. An action's newest success is read by an index of its own, so
 * it costs what its newest row does however many failures lie above it.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketLandedCommitReadFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketLandedCommitReadFunction}(in_tenant text, in_project text, in_ticket bigint)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

export const migration038: Migration = {
  version: 38,
  name: "where a ticket landed and what was reported of its actions are read by the API",
  statements: [
    `CREATE INDEX finalization_attempt_by_ticket
       ON public.finalization_attempt USING btree (tenant, project, ticket)`,
    `CREATE INDEX action_observation_newest_success
       ON public.action_observation USING btree (tenant, project, action, ordinal DESC)
       WHERE (outcome = 'Succeeded'::text)`,
    `GRANT SELECT (tenant, project, request, opened_at, creation,
                   creation_evidence, reconciliation, reconciliation_evidence,
                   merge, merge_commit, merge_reading, merge_reading_evidence)
       ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `GRANT SELECT (tenant, project, action, ordinal, repository_commit, outcome,
                   observed_at, received_at, detail, link)
       ON TABLE public.action_observation TO ${apiRole}`,
    `CREATE FUNCTION ${signature}
    RETURNS TABLE(repository text, recovery_epoch text, retired boolean,
                  repository_commit text, landed_after timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      WITH promoted AS (
        SELECT a.request, a.repository, a.candidate_commit, p.granted_at
          FROM finalization_attempt a
          JOIN finalization_request f
            ON f.tenant=a.tenant AND f.project=a.project AND f.request=a.request
          JOIN commit_permit p
            ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
          JOIN finalization_reconciliation r
            ON r.tenant=p.tenant AND r.project=p.project AND r.permit=p.permit
         WHERE a.tenant=in_tenant AND a.project=in_project
           AND a.ticket=in_ticket AND r.verdict='Promoted'
         ORDER BY f.authorizing_seq DESC, p.granted_at DESC, p.permit DESC
         LIMIT 1
      ), landed AS (
        SELECT n.repository,
               CASE
                 WHEN c.request IS NULL THEN
                   CASE WHEN w.definition->'finalization'->>'mode'
                             IN ('PullRequest','PullRequestMerge')
                        THEN NULL ELSE n.candidate_commit END
                 WHEN c.merge='Merged' THEN c.merge_commit
                 WHEN c.merge_reading='Accepted'
                   THEN c.merge_reading_evidence->>'mergeCommit'
                 WHEN w.definition->'finalization'->>'mode'='PullRequestMerge'
                      AND c.creation IN ('Created','AlreadyExists')
                      AND c.creation_evidence->>'status'='Merged'
                   THEN c.creation_evidence->>'mergeCommit'
                 WHEN c.reconciliation='Accepted'
                      AND c.reconciliation_evidence->>'status'='Merged'
                   THEN c.reconciliation_evidence->>'mergeCommit'
               END AS repository_commit,
               coalesce(c.opened_at, n.granted_at) AS landed_after
          FROM promoted n
          LEFT JOIN ticket_definition w
            ON w.tenant=in_tenant AND w.project=in_project
           AND w.ticket=in_ticket
          LEFT JOIN finalization_change_proposal c
            ON c.tenant=in_tenant AND c.project=in_project
           AND c.request=n.request
      )
      SELECT l.repository, b.recovery_epoch, b.retired_at IS NOT NULL,
             l.repository_commit, l.landed_after
        FROM landed l
        JOIN project_repository b
          ON b.tenant=in_tenant AND b.project=in_project
         AND b.repository=l.repository
       WHERE l.repository_commit ~ ${gitObject}
    $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
