/**
 * A stack's landings follow a proposal merged by anyone, the forge's merge
 * queue included.
 *
 * `evaluation_stack_landings` IS REPLACED, its signature, owner and grants as
 * 157 gave them. A proposal lands where it concluded merged, at the commit
 * that merge made: `merge_commit` where the finalizer's own merge left one,
 * and otherwise the `mergeCommit` of an accepted merge reading that read it
 * `Merged`, which is how a proposal merged by anyone else concludes. A
 * proposal with neither lands nothing. The boundary owner already
 * reads both columns, so nothing is granted.
 */

import { stackLandingsFunction, type Migration } from "../shared.ts";

const landings = `public.${stackLandingsFunction}(in_tenant text, in_project text, in_repository text, in_target text, in_tip text, in_limit integer)`;

export const migration201: Migration = {
  version: 201,
  name: "a stack's landings follow a proposal merged through the forge's merge queue",
  statements: [
    `CREATE OR REPLACE FUNCTION ${landings}
       RETURNS TABLE(landing_depth integer, landing_ticket bigint, landing_accepted text)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH RECURSIVE concluded AS (
           SELECT a.tenant, a.project, a.ticket, a.repository, a.target_ref,
                  a.target_commit, a.candidate_commit, a.input_bundle,
                  c.request AS proposal, c.base_ref, c.base_commit,
                  CASE
                    WHEN c.merge = 'Merged' THEN c.merge_commit
                    WHEN c.merge_reading = 'Accepted'
                     AND c.merge_reading_evidence->>'status' = 'Merged'
                      THEN c.merge_reading_evidence->>'mergeCommit'
                  END AS merged_commit
             FROM finalization_attempt a
             JOIN commit_permit p
               ON p.tenant = a.tenant AND p.project = a.project
              AND p.attempt = a.attempt
             JOIN finalization_reconciliation r
               ON r.tenant = p.tenant AND r.project = p.project
              AND r.permit = p.permit AND r.verdict = 'Promoted'
             LEFT JOIN finalization_change_proposal c
               ON c.tenant = a.tenant AND c.project = a.project
              AND c.request = a.request
            WHERE a.tenant = in_tenant AND a.project = in_project
              AND a.repository = in_repository
              AND coalesce(c.base_ref, a.target_ref) = in_target
         ), promoted AS (
           SELECT a.ticket, coalesce(a.base_commit, a.target_commit) AS target_commit,
                  coalesce(a.merged_commit, a.candidate_commit) AS landed_commit,
                  (SELECT s.commit
                     FROM input_bundle_reference m
                     JOIN execution_result_source s
                       ON s.tenant = m.tenant AND s.project = m.project
                      AND s.manifest = m.reference_id
                    WHERE m.tenant = a.tenant AND m.project = a.project
                      AND m.bundle = a.input_bundle
                      AND m.reference_kind = 'ResultManifest'
                    ORDER BY m.ordinal
                    LIMIT 1) AS accepted
             FROM concluded a
            WHERE a.proposal IS NULL OR a.merged_commit IS NOT NULL
         ), chain AS (
           SELECT 1 AS depth, p.ticket, p.landed_commit, p.accepted
             FROM promoted p WHERE p.target_commit = in_tip
           UNION ALL
           SELECT n.depth + 1, p.ticket, p.landed_commit, p.accepted
             FROM chain n JOIN promoted p ON p.target_commit = n.landed_commit
            WHERE n.depth < in_limit
         )
         SELECT depth, ticket, accepted FROM chain ORDER BY depth
       $$`,
  ],
};
