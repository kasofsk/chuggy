/**
 * An OnChange evaluator's passing verdict is carried to a later work cycle of
 * its ticket rather than run again, and the carry is recorded.
 *
 * `execution` GAINS `workload_digest`, the digest of the workload a task of a
 * catalog was registered to run, its ticket's overrides applied. The scheduler
 * writes it when it registers the row and is granted INSERT on that column
 * alone. Every row there is keeps none, which every row there is may, and a row
 * with none is never carried from.
 *
 * `execution_attempt_state_is_known` IS REPLACED, admitting `Carried` beside
 * the six states the baseline admitted, so no stored row is refused. A carried
 * attempt is the one a carried execution's manifest is bound to, and it never
 * places: `execution_attempt_carried_is_unplaced` holds it to no pool, no
 * lease, no invocation, no workload and no secret a worker could present. It
 * is ended as it is opened, so `execution_attempt_ending_is_whole` and
 * `execution_attempt_is_fenced` hold it as they hold every finished attempt.
 *
 * `execution_verdict_carry` NAMES THE EXECUTION EACH CARRIED ONE CARRIED FROM,
 * written in the transaction that settles it. The scheduler is granted INSERT
 * of the columns it names and reads none of them, and
 * `execution_verdict_carry_is_immutable` refuses every change and delete of
 * every role.
 *
 * `evaluation_stack_landings` IS THE ONE DEFINITION OF A LANDING SINCE A
 * STACK'S TIP: the finalizer's standing read calls it, and so does
 * `ticket_cycle_beneath_landed`. That door answers `Unstacked` for a work
 * cycle with no stack row, `Landed` where every ticket beneath it landed right
 * after its tip at the commit the row names, and `NotLanded` otherwise, which
 * includes landings that cannot be followed. The scheduler may execute the door
 * and reads neither the stack relations nor the journal. Both run as the
 * boundary owner, which is granted SELECT on `evaluation_stack_beneath` and on
 * the proposal's `base_commit`, the two rows the read takes that it did not
 * already reach.
 */

import {
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  stackBeneathLandedFunction,
  stackLandingsFunction,
  type Migration,
} from "../shared.ts";

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** Every attempt state the baseline admitted, and the one this adds. */
const attemptStates = [
  "Placing",
  "Running",
  "Reported",
  "Lost",
  "Withdrawn",
  "Superseded",
  "Carried",
];

const landings = `public.${stackLandingsFunction}(in_tenant text, in_project text, in_repository text, in_target text, in_tip text, in_limit integer)`;

const beneathLanded = `public.${stackBeneathLandedFunction}(in_tenant text, in_project text, in_ticket bigint, in_work_cycle bigint)`;

export const migration157: Migration = {
  version: 157,
  name: "an OnChange evaluator's passing verdict is carried to a later work cycle",
  statements: [
    `ALTER TABLE public.execution
       ADD COLUMN workload_digest text
         CONSTRAINT execution_workload_digest_is_sha256
         CHECK (workload_digest IS NULL OR workload_digest ~ '^[0-9a-f]{64}$')`,
    `GRANT INSERT(workload_digest) ON TABLE public.execution TO ${schedulerRole}`,
    `ALTER TABLE public.execution_attempt
       DROP CONSTRAINT execution_attempt_state_is_known,
       ADD CONSTRAINT execution_attempt_state_is_known CHECK ((state = ANY (${textArray(attemptStates)}))),
       ADD CONSTRAINT execution_attempt_carried_is_unplaced
         CHECK (state <> 'Carried'
                OR (pool IS NULL AND lease_owner IS NULL AND invocation IS NULL
                    AND workload IS NULL AND capability_secret_digest IS NULL))`,
    `CREATE TABLE public.execution_verdict_carry (
       tenant text NOT NULL,
       project text NOT NULL,
       execution text NOT NULL,
       source_execution text NOT NULL,
       carried_at timestamp with time zone NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant,project,execution),
       CONSTRAINT execution_verdict_carry_is_from_another
         CHECK (source_execution <> execution),
       CONSTRAINT execution_verdict_carry_names_its_execution
         FOREIGN KEY (tenant,project,execution)
         REFERENCES public.execution(tenant,project,execution),
       CONSTRAINT execution_verdict_carry_names_its_source
         FOREIGN KEY (tenant,project,source_execution)
         REFERENCES public.execution(tenant,project,execution))`,
    `CREATE TRIGGER execution_verdict_carry_is_immutable BEFORE DELETE OR UPDATE ON public.execution_verdict_carry
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `GRANT INSERT(tenant,project,execution,source_execution) ON TABLE public.execution_verdict_carry TO ${schedulerRole}`,
    `GRANT SELECT ON TABLE public.evaluation_stack_beneath TO ${boundaryOwnerRole}`,
    `GRANT SELECT (base_commit) ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${landings}
       RETURNS TABLE(landing_depth integer, landing_ticket bigint, landing_accepted text)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH RECURSIVE promoted AS (
           SELECT a.ticket, coalesce(c.base_commit, a.target_commit) AS target_commit,
                  coalesce(c.merge_commit, a.candidate_commit) AS landed_commit,
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
              AND (c.request IS NULL OR c.merge = 'Merged')
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
    `ALTER FUNCTION ${landings} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${landings} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${landings} TO ${finalizerRole}`,
    `CREATE FUNCTION ${beneathLanded} RETURNS text
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH stack AS (
           SELECT s.repository, s.target_ref, s.tip,
                  (SELECT count(*)::integer FROM evaluation_stack_beneath b
                    WHERE b.tenant = s.tenant AND b.project = s.project
                      AND b.ticket = s.ticket AND b.work_cycle = s.work_cycle) AS height
             FROM evaluation_stack s
            WHERE s.tenant = in_tenant AND s.project = in_project
              AND s.ticket = in_ticket AND s.work_cycle = in_work_cycle
         ), landed AS (
           SELECT l.landing_depth, l.landing_ticket, l.landing_accepted
             FROM stack k
            CROSS JOIN LATERAL ${stackLandingsFunction}(
              in_tenant, in_project, k.repository, k.target_ref, k.tip, k.height) l
         )
         SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM stack) THEN 'Unstacked'
           WHEN (SELECT count(*) FROM landed) = (SELECT height FROM stack)
            AND (SELECT count(*)
                   FROM evaluation_stack_beneath b
                   JOIN landed l
                     ON l.landing_depth = b.depth AND l.landing_ticket = b.beneath_ticket
                    AND l.landing_accepted = b.beneath_commit
                  WHERE b.tenant = in_tenant AND b.project = in_project
                    AND b.ticket = in_ticket AND b.work_cycle = in_work_cycle)
                = (SELECT height FROM stack)
           THEN 'Landed'
           ELSE 'NotLanded'
         END
       $$`,
    `ALTER FUNCTION ${beneathLanded} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${beneathLanded} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${beneathLanded} TO ${schedulerRole}`,
  ],
};
