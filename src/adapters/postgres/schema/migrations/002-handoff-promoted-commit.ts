import type { Migration } from "../shared.ts";

/**
 * What a finalization put on the reference its brief names, which is the commit
 * a handoff is rendered against.
 *
 * THE ATTEMPT'S CANDIDATE IS NOT THAT COMMIT WHERE A PROPOSAL LANDED THE WORK.
 * A finalization that lands by merging a proposal promotes its candidate onto
 * the branch the proposal is opened from, and the commit that reaches the base
 * is the merge the forge made. Reading the candidate there would hand the
 * fabric a commit that is on no reference anybody ships from.
 *
 * THE MERGE IS PROVED BY WHICHEVER ANSWER CARRIED IT, because a forge that
 * merged and then went quiet is the ordinary case the readings exist for. The
 * merge answer's own column is the first of them; a reading of that merge and
 * the evidence a create or its reconciliation came back with are the rest, each
 * carrying the commit only for a proposal the forge called merged. A request
 * with no proposal at all — a push — answers with the candidate it was given.
 *
 * ONE DERIVATION SERVES BOTH READERS. The submission that offers an accepted
 * promotion and the door a handoff retry reads it back through ask the same
 * question of the same rows, and a second copy of this `COALESCE` would be a
 * second authority on which commit was promoted. It is `SECURITY DEFINER`
 * because the role that submits results holds nothing on the proposal relation,
 * and a grant on that relation would be a licence to read every proposal this
 * installation has ever opened.
 *
 * THE DEFINER'S OWN READ IS GRANTED HERE, as `finalization_attempt`'s already
 * was. A `SECURITY DEFINER` body runs as the boundary owner and not as whoever
 * migrated, so a function nobody granted the owner its relation is a door that
 * parses and then refuses every caller.
 */
export const migration002: Migration = {
  version: 2,
  name: "a handoff renders against the commit its promotion landed",
  statements: [
    `GRANT SELECT ON TABLE public.finalization_change_proposal TO chuggy_boundary_owner;`,
    `CREATE FUNCTION finalization_promoted_commit(in_tenant text, in_project text, in_request text, in_candidate text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT coalesce(
                (SELECT coalesce(p.merge_commit,
                                 p.merge_reading_evidence->>'mergeCommit',
                                 p.reconciliation_evidence->>'mergeCommit',
                                 p.creation_evidence->>'mergeCommit')
                   FROM finalization_change_proposal p
                  WHERE p.tenant=in_tenant AND p.project=in_project
                    AND p.request=in_request),
                in_candidate)
     $$;`,
    `ALTER FUNCTION public.finalization_promoted_commit(in_tenant text, in_project text, in_request text, in_candidate text) OWNER TO chuggy_boundary_owner;`,
    `REVOKE ALL ON FUNCTION public.finalization_promoted_commit(in_tenant text, in_project text, in_request text, in_candidate text) FROM PUBLIC;`,
    `GRANT EXECUTE ON FUNCTION public.finalization_promoted_commit(in_tenant text, in_project text, in_request text, in_candidate text) TO chuggy_ticket_service;`,
    `DROP FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint);`,
    `CREATE FUNCTION read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) RETURNS TABLE(repository text, promoted_commit text, configuration_revision text, configuration_digest text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.repository,
              finalization_promoted_commit(a.tenant,a.project,a.request,a.candidate_commit),
              a.configuration_revision,a.configuration_digest
         FROM finalization_request f
         JOIN finalization_attempt a
           ON a.tenant=f.tenant AND a.project=f.project AND a.request=f.request
         JOIN commit_permit p
           ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
         JOIN finalization_reconciliation r
           ON r.tenant=p.tenant AND r.project=p.project AND r.permit=p.permit
        WHERE f.tenant=in_tenant AND f.project=in_project AND f.ticket=in_ticket
          AND f.kind='PromoteForHandoff' AND p.state='Concluded'
          AND r.verdict='Promoted'
        ORDER BY f.authorizing_seq DESC,a.prepared_at DESC LIMIT 1
       $$;`,
    `ALTER FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) OWNER TO chuggy_boundary_owner;`,
    `REVOKE ALL ON FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) FROM PUBLIC;`,
    `GRANT ALL ON FUNCTION public.read_accepted_handoff_promotion(in_tenant text, in_project text, in_ticket bigint) TO chuggy_ticket_service;`,
  ],
};
