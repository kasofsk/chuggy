/**
 * A proposal behind its base is brought up to date, and merged at the head
 * that update made.
 *
 * `merge_head` IS THE HEAD ADOPTED IN PLACE OF THE ONE ASKED FOR, absent until
 * one is. What the forge was asked for stays written once; the head a merge is
 * conditional on is `coalesce(merge_head, head_commit)`, and adopting a head is
 * the one write that lets a moved head's answer give way: `merge` returns from
 * `HeadMoved` to nothing beside a `merge_head` that changed, and the merge it
 * answered is released in the same write, so the counters still say nothing is
 * in flight.
 *
 * THE UPDATES ARE COUNTED AS THE MERGES ARE. `merge_updates` counts the
 * updates this row may have asked the forge for and `merge_update_declines`
 * the ones the forge would not take, so the ceiling is spent from their
 * difference; `merge_update_unread` is an update asked that no reading has
 * seen since, and only a row with an update to its name can carry one. Every
 * row there is counts none, which is what it has asked for.
 *
 * THE LANDINGS DOOR NAMES THE HEAD THE FINALIZER MERGED AT, which is the
 * adopted one where a head was adopted. Its result is unchanged, so it is
 * replaced in place and keeps its owner and its grants; its owner is granted
 * the column it now reads.
 */

import {
  boundaryOwnerRole,
  finalizerRole,
  ticketLandingsReadFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

export const migration092: Migration = {
  version: 92,
  name: "a proposal behind its base is brought up to date",
  statements: [
    `ALTER TABLE public.finalization_change_proposal
       ADD COLUMN merge_head text,
       ADD COLUMN merge_updates integer DEFAULT 0 NOT NULL,
       ADD COLUMN merge_update_declines integer DEFAULT 0 NOT NULL,
       ADD COLUMN merge_update_unread boolean DEFAULT false NOT NULL`,
    `ALTER TABLE public.finalization_change_proposal
       ADD CONSTRAINT finalization_change_proposal_merge_head_is_an_object_id
         CHECK ((merge_head IS NULL) OR (merge_head ~ ${gitObject})),
       ADD CONSTRAINT finalization_change_proposal_updates_are_counted
         CHECK ((merge_update_declines >= 0)
                AND (merge_updates >= merge_update_declines)
                AND ((NOT merge_update_unread)
                     OR (merge_updates > merge_update_declines)))`,
    `GRANT UPDATE (merge_head, merge_updates, merge_update_declines,
                   merge_update_unread)
       ON TABLE public.finalization_change_proposal TO ${finalizerRole}`,
    `GRANT SELECT (merge_head)
       ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `CREATE OR REPLACE FUNCTION public.finalization_change_proposal_is_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
       IF TG_OP = 'DELETE' THEN
         RAISE EXCEPTION 'a change proposal that could be erased is not evidence'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.request, NEW.permit, NEW.proposal_request,
           NEW.head_ref, NEW.head_commit, NEW.base_ref, NEW.base_commit,
           NEW.title, NEW.body, NEW.opened_at)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.request, OLD.permit, OLD.proposal_request,
           OLD.head_ref, OLD.head_commit, OLD.base_ref, OLD.base_commit,
           OLD.title, OLD.body, OLD.opened_at) THEN
         RAISE EXCEPTION 'what a change proposal asked for is written once'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.creation IS NOT NULL
          AND (NEW.creation, NEW.creation_contradiction, NEW.creation_evidence)
              IS DISTINCT FROM
              (OLD.creation, OLD.creation_contradiction, OLD.creation_evidence) THEN
         RAISE EXCEPTION 'a change proposal is created once and read back after'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.merge IS NOT NULL
          AND (NEW.merge, NEW.merge_reason, NEW.merge_commit)
              IS DISTINCT FROM (OLD.merge, OLD.merge_reason, OLD.merge_commit)
          AND NOT (OLD.merge = 'HeadMoved' AND NEW.merge IS NULL
                   AND NEW.merge_head IS DISTINCT FROM OLD.merge_head) THEN
         RAISE EXCEPTION 'a change proposal is merged once and read back after'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1)
          OR NEW.refusals NOT IN (OLD.refusals, OLD.refusals + 1)
          OR NEW.declines NOT IN (OLD.declines, OLD.declines + 1)
          OR NEW.reconciliations
             NOT IN (OLD.reconciliations, OLD.reconciliations + 1)
          OR NEW.merge_attempts
             NOT IN (OLD.merge_attempts, OLD.merge_attempts + 1)
          OR NEW.merge_refusals
             NOT IN (OLD.merge_refusals, OLD.merge_refusals + 1)
          OR NEW.merge_declines
             NOT IN (OLD.merge_declines, OLD.merge_declines + 1)
          OR NEW.merge_readings
             NOT IN (OLD.merge_readings, OLD.merge_readings + 1)
          OR NEW.merge_updates
             NOT IN (OLD.merge_updates, OLD.merge_updates + 1)
          OR NEW.merge_update_declines
             NOT IN (OLD.merge_update_declines, OLD.merge_update_declines + 1) THEN
         RAISE EXCEPTION 'a change proposal counts one act at a time'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${signature}
    RETURNS TABLE(request text, authorizing_seq bigint, work_cycle bigint,
                  finalization_generation bigint, state text, concluded text,
                  hold_kind text, hold_passes integer,
                  held_since timestamp with time zone, attempts integer,
                  outcome text, failure_kind text, target_ref text,
                  target_commit text, candidate_commit text,
                  prepared_at timestamp with time zone, conflict_manifest text,
                  approval_open boolean, proposed boolean, head_ref text,
                  base_ref text, creation text, url text, merge text,
                  merge_reason text, mergeability text, merge_commit text,
                  landed_commit text, merge_state text, merge_wait text,
                  merge_heard_at timestamp with time zone, head_commit text,
                  merged_head text, proposal_status text)
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
             coalesce(s.state IN ('Open','Registered')
                      AND a.outcome='Prepared' AND a.approval_required
                      AND p.permit IS NULL AND n.state='Open', false),
             c.request IS NOT NULL, c.head_ref, c.base_ref, c.creation,
             coalesce(c.creation_evidence->>'url',
                      c.reconciliation_evidence->>'url'),
             c.merge, c.merge_reason,
             c.merge_reading_evidence->>'mergeability', c.merge_commit,
             CASE WHEN l.landed->>'commit' ~ ${gitObject}
                  THEN l.landed->>'commit' END,
             c.merge_reading_evidence->>'mergeState',
             CASE WHEN c.merge='HeadMoved'
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
                                c.creation_evidence->>'status') END
        FROM shown s
        LEFT JOIN LATERAL (
          SELECT x.* FROM finalization_attempt x
           WHERE x.tenant=in_tenant AND x.project=in_project
             AND x.request=s.request
           ORDER BY x.prepared_at DESC, x.attempt DESC LIMIT 1
        ) a ON true
        LEFT JOIN commit_permit p
          ON p.tenant=in_tenant AND p.project=in_project AND p.attempt=a.attempt
        LEFT JOIN native_action n
          ON n.tenant=in_tenant AND n.project=in_project AND n.attempt=a.attempt
         AND n.kind='FinalizationApproval'
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
  ],
};
