/**
 * A finalization asks no person's approval: a person approves a ticket's work
 * through an `Approval` evaluator in its plan, and nothing at landing waits on
 * one.
 *
 * IT REFUSES RATHER THAN REWRITES. Before anything is dropped it asserts that
 * no attempt recorded an approval as required, that no `FinalizationApproval`
 * action was ever opened and no `Decline` was ever offered, and that no stored
 * operation answers one with `Decline`, which the command grammar would no
 * longer read. A database holding any of them fails here, its rows untouched.
 *
 * `request_finalization_approval` IS DROPPED, and the landings door is dropped
 * and recreated as 160's with no `approval_open`, because a result type cannot
 * change in place; dropping it takes its owner and its grants, so both are
 * given again as 160 gave them. Only then is `finalization_attempt.approval_required`
 * dropped, since both bodies read it.
 *
 * `native_action` LOSES `attempt`, which only a `FinalizationApproval` named,
 * with its foreign key, its index and the desk index's clause on it; its kind,
 * capability and pairing checks and `native_action_resolution`'s are 148's
 * less that kind, its capability and `Decline`. `native_action_resolution_pairs_with_its_kind`,
 * `public_ticket_command_is_valid` and `accept_operation` are 148's and 155's
 * with `Decline` taken out, replaced in place so each keeps its owner and
 * grants. The finalizer read both action tables for the approval alone, so its
 * `SELECT` on them is revoked.
 */

import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketLandingsReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import { migration148 } from "./148-evaluation-approval.ts";
import { migration155 } from "./155-approval-answered.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

/** The rows that would still name the approval, each a reason this migration refuses. */
const approvalStillStored = `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.finalization_attempt WHERE approval_required) THEN
      RAISE EXCEPTION 'migration 181: a finalization attempt records an approval as required'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.native_action
                WHERE kind = 'FinalizationApproval'
                   OR required_capability = 'ApproveFinalization'
                   OR attempt IS NOT NULL) THEN
      RAISE EXCEPTION 'migration 181: a finalization approval was opened'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.native_action_resolution
                WHERE resolution = 'Decline') THEN
      RAISE EXCEPTION 'migration 181: an action offers Decline'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.operation
                WHERE command_tag = 'ResolveNativeAction'
                  AND command::jsonb->>'resolution' = 'Decline') THEN
      RAISE EXCEPTION 'migration 181: a stored operation answers Decline'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END $$`;

const declineAmong = "'Approve', 'Decline', 'Reject'";

/** One of `migration`'s functions, with `Decline` taken out of every list of answers it names. */
function migration181Narrowed(migration: Migration, prefix: string): string {
  const stood = migration.statements.find((statement) =>
    statement.startsWith(prefix),
  );
  if (stood === undefined || !stood.includes(declineAmong))
    throw new Error(
      `migration 181: ${String(migration.version)} no longer installs the function this narrows`,
    );
  const narrowed = stood.replaceAll(declineAmong, "'Approve', 'Reject'");
  if (narrowed.includes("Decline"))
    throw new Error(
      `migration 181: ${String(migration.version)}'s function names Decline outside a list this narrows`,
    );
  return narrowed;
}

export const migration181: Migration = {
  version: 181,
  name: "a finalization asks no person's approval",
  statements: [
    approvalStillStored,
    `DROP FUNCTION public.request_finalization_approval(in_tenant text, in_project text, in_attempt text, in_action text, in_recovery_epoch text)`,
    `DROP FUNCTION ${landingsSignature}`,
    `CREATE FUNCTION ${landingsSignature}
    RETURNS TABLE(request text, authorizing_seq bigint, work_cycle bigint,
                  finalization_generation bigint, state text, concluded text,
                  hold_kind text, hold_passes integer,
                  held_since timestamp with time zone, attempts integer,
                  outcome text, failure_kind text, target_ref text,
                  target_commit text, candidate_commit text,
                  prepared_at timestamp with time zone, conflict_manifest text,
                  proposed boolean, head_ref text,
                  base_ref text, creation text, url text, merge text,
                  merge_reason text, mergeability text, merge_commit text,
                  landed_commit text, merge_state text, merge_wait text,
                  merge_heard_at timestamp with time zone, head_commit text,
                  merged_head text, proposal_status text,
                  queue_removal_reason text, queue_removal_actor text,
                  recheck_reason text, recheck_base_ref text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      WITH concluded AS (
        SELECT DISTINCT ON (e.value->'workCycle', e.value->'generation')
               e.value->'workCycle' AS work_cycle,
               e.value->'generation' AS generation, e.type
          FROM journal_entry j
          CROSS JOIN LATERAL (
            SELECT d->>'type' AS type, d->'value' AS value
              FROM (SELECT CASE WHEN j.entry IS JSON OBJECT
                                THEN j.entry::jsonb->'event' END AS d) x
          ) e
         WHERE j.tenant=in_tenant AND j.project=in_project
           AND e.type IN ('TicketFinalizationSucceeded',
                          'TicketFinalizationNeedsWork',
                          'TicketFinalizationUnavailable')
           AND e.value->'ticket'=to_jsonb(in_ticket)
         ORDER BY e.value->'workCycle', e.value->'generation'
      ), counted AS (
        SELECT f.request, f.authorizing_seq, f.work_cycle,
               f.finalization_generation, f.state, f.hold_kind, f.hold_passes,
               f.held_since,
               CASE WHEN f.state='Fulfilled' THEN c.type END AS concluded,
               (SELECT count(*) FROM finalization_attempt y
                 WHERE y.tenant=f.tenant AND y.project=f.project
                   AND y.request=f.request)::integer AS attempts
          FROM finalization_request f
          LEFT JOIN concluded c
            ON c.work_cycle=to_jsonb(f.work_cycle)
           AND c.generation=to_jsonb(f.finalization_generation)
         WHERE f.tenant=in_tenant AND f.project=in_project
           AND f.ticket=in_ticket
      ), shown AS (
        SELECT * FROM counted s
         WHERE s.concluded IS DISTINCT FROM 'TicketFinalizationSucceeded'
            OR s.attempts > 0
         ORDER BY s.authorizing_seq DESC, s.request DESC
         LIMIT greatest(in_count, 0)
      )
      SELECT s.request, s.authorizing_seq, s.work_cycle,
             s.finalization_generation, s.state, s.concluded, s.hold_kind,
             s.hold_passes, s.held_since, s.attempts, a.outcome,
             a.failure_kind, a.target_ref, a.target_commit, a.candidate_commit,
             a.prepared_at, a.conflict_manifest,
             c.request IS NOT NULL, c.head_ref, c.base_ref, c.creation,
             coalesce(c.creation_evidence->>'url',
                      c.reconciliation_evidence->>'url'),
             c.merge, c.merge_reason,
             c.merge_reading_evidence->>'mergeability', c.merge_commit,
             CASE WHEN a.outcome='Landed' THEN a.target_commit
                  WHEN l.landed->>'commit' ~ ${gitObject}
                  THEN l.landed->>'commit' END,
             c.merge_reading_evidence->>'mergeState',
             CASE WHEN c.merge IS NULL
                       AND c.merge_queue_standing->'queued'='true'::jsonb
                    THEN 'Queued'
                  WHEN c.merge IS NULL AND c.merge_queue_refused
                       AND c.merge_queue_standing->'enabled'='true'::jsonb
                    THEN 'Blocked'
                  WHEN c.merge='HeadMoved'
                       AND coalesce(c.merge_reading,'Unmerged')='Unmerged'
                    THEN 'HeadMoved'
                  WHEN c.merge IS NULL AND c.merge_reading='Unmerged'
                       AND c.merge_attempts=c.merge_refusals+c.merge_declines
                    THEN 'Blocked' END,
             c.merge_heard_at, c.head_commit,
             CASE WHEN l.landed->>'head' ~ ${gitObject}
                       AND l.landed->>'head' IS DISTINCT FROM c.head_commit
                  THEN l.landed->>'head' END,
             CASE WHEN c.merge='Merged' THEN 'Merged'
                  ELSE coalesce(c.merge_reading_evidence->>'status',
                                c.reconciliation_evidence->>'status',
                                c.creation_evidence->>'status') END,
             c.merge_queue_standing->'removal'->>'reason',
             c.merge_queue_standing->'removal'->>'actor',
             a.recheck_reason, a.recheck_base_ref
        FROM shown s
        LEFT JOIN LATERAL (
          SELECT x.* FROM finalization_attempt x
           WHERE x.tenant=in_tenant AND x.project=in_project
             AND x.request=s.request
           ORDER BY x.prepared_at DESC, x.attempt DESC LIMIT 1
        ) a ON true
        LEFT JOIN finalization_change_proposal c
          ON c.tenant=in_tenant AND c.project=in_project AND c.request=s.request
        LEFT JOIN ticket_definition w
          ON w.tenant=in_tenant AND w.project=in_project AND w.ticket=in_ticket
        LEFT JOIN LATERAL (
          SELECT CASE
                   WHEN c.request IS NULL THEN
                     CASE WHEN w.definition->'finalization'->>'mode'
                               IN ('PullRequest','PullRequestMerge')
                          THEN NULL
                          ELSE jsonb_build_object('commit', x.candidate_commit)
                     END
                   WHEN c.merge='Merged'
                     THEN jsonb_build_object('commit', c.merge_commit,
                                             'head', coalesce(c.merge_head,
                                                              c.head_commit))
                   WHEN c.merge_reading='Accepted'
                     THEN jsonb_build_object(
                            'commit', c.merge_reading_evidence->'mergeCommit',
                            'head', c.merge_reading_evidence->'head'->'commit')
                   WHEN w.definition->'finalization'->>'mode'='PullRequestMerge'
                        AND c.creation IN ('Created','AlreadyExists')
                        AND c.creation_evidence->>'status'='Merged'
                     THEN jsonb_build_object(
                            'commit', c.creation_evidence->'mergeCommit',
                            'head', c.creation_evidence->'head'->'commit')
                   WHEN c.reconciliation='Accepted'
                        AND c.reconciliation_evidence->>'status'='Merged'
                     THEN jsonb_build_object(
                            'commit', c.reconciliation_evidence->'mergeCommit',
                            'head', c.reconciliation_evidence->'head'->'commit')
                 END AS landed
            FROM finalization_attempt x
            JOIN commit_permit q
              ON q.tenant=x.tenant AND q.project=x.project AND q.attempt=x.attempt
            JOIN finalization_reconciliation r
              ON r.tenant=q.tenant AND r.project=q.project AND r.permit=q.permit
           WHERE x.tenant=in_tenant AND x.project=in_project
             AND x.request=s.request AND r.verdict='Promoted'
           ORDER BY q.granted_at DESC, q.permit DESC
           LIMIT 1
        ) l ON true
    $$`,
    `ALTER FUNCTION ${landingsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${landingsSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${schedulerRole}`,
    `ALTER TABLE public.finalization_attempt DROP COLUMN approval_required`,
    `DROP INDEX public.native_action_decision_opens_one_desk`,
    `ALTER TABLE public.native_action
       DROP CONSTRAINT native_action_kind_is_known,
       DROP CONSTRAINT native_action_capability_is_known,
       DROP CONSTRAINT native_action_kind_names_its_capability,
       DROP COLUMN attempt,
       ADD CONSTRAINT native_action_kind_is_known CHECK (kind = ANY (ARRAY['TicketEscalation'::text, 'EvaluationApproval'::text])),
       ADD CONSTRAINT native_action_capability_is_known CHECK (required_capability = ANY (ARRAY['ResolveTicket'::text, 'ApproveEvaluation'::text])),
       ADD CONSTRAINT native_action_kind_names_its_capability CHECK ((kind = 'TicketEscalation') = (required_capability = 'ResolveTicket') AND (kind = 'EvaluationApproval') = (required_capability = 'ApproveEvaluation') AND (kind = 'EvaluationApproval') = (execution IS NOT NULL) AND (kind <> 'EvaluationApproval' OR escalation = 'NoEscalation'))`,
    `CREATE UNIQUE INDEX native_action_decision_opens_one_desk ON public.native_action USING btree (tenant, project, authorizing_seq) WHERE execution IS NULL`,
    `ALTER TABLE public.native_action_resolution
       DROP CONSTRAINT native_action_resolution_is_known,
       ADD CONSTRAINT native_action_resolution_is_known CHECK (resolution = ANY (ARRAY['Resume'::text, 'Revoke'::text, 'Approve'::text, 'Reject'::text]))`,
    `CREATE OR REPLACE FUNCTION public.native_action_resolution_pairs_with_its_kind() RETURNS trigger
     LANGUAGE plpgsql
     AS $$
       DECLARE asked text;
       BEGIN
         SELECT n.kind INTO asked FROM native_action n
          WHERE n.tenant = NEW.tenant AND n.project = NEW.project
            AND n.action = NEW.action;
         IF NOT ((asked = 'TicketEscalation' AND NEW.resolution IN ('Resume', 'Revoke'))
              OR (asked = 'EvaluationApproval' AND NEW.resolution IN ('Approve', 'Reject'))) THEN
           RAISE EXCEPTION '% is not an answer a % asks for', NEW.resolution, asked
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$`,
    migration181Narrowed(
      migration155,
      "CREATE OR REPLACE FUNCTION public.public_ticket_command_is_valid(",
    ),
    migration181Narrowed(
      migration148,
      "CREATE OR REPLACE FUNCTION public.accept_operation(",
    ),
    `REVOKE SELECT ON TABLE public.native_action FROM ${finalizerRole}`,
    `REVOKE SELECT ON TABLE public.native_action_resolution FROM ${finalizerRole}`,
  ],
};
