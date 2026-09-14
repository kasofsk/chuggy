/**
 * The merge one change proposal is asked for, recorded beside the create on the
 * proposal's own row. The columns sit there rather than in a table of their own
 * because they are answers about the same proposal under the same claim, so the
 * lock order is the one 052 installed and no transaction takes a new class.
 *
 * THE MERGE COUNTERS ARE THE MERGE'S STATE, exactly as the create's are the
 * create's. `merge_attempts` counts the merges this row may have sent,
 * `merge_refusals` the ones readings proved nothing came of, and
 * `merge_declines` the ones the forge would not take at all, so
 * `merge_attempts = merge_refusals + merge_declines` is nothing in flight and
 * one more than that is a merge nobody heard back from. `merge_readings` counts
 * the readings taken about those merges.
 *
 * A MERGE IS ASKED ONLY OF A PROPOSAL THIS ROW HAS EVIDENCE OF. The number the
 * merge addresses comes out of that evidence and out of nothing else, so a row
 * counting a merge attempt with neither answer's evidence stored is one no pass
 * could have built the request from.
 *
 * WHAT THE MERGE ANSWERED CARRIES EXACTLY WHAT ITS ARM HAS. A merge that landed
 * names the commit it left and nothing else does; a refusal names the reason it
 * was refused and nothing else does. Both pairings are refused in both
 * directions, because an arm whose evidence is missing and evidence under an
 * arm that has none are the same unreadable row.
 */

import {
  allChangeProposalContradictions,
  allChangeProposalMergeAnswers,
  allChangeProposalMergeReconciliationsStored,
  allChangeProposalUnmergeableSettled,
  proposalEvidenceCharsMax,
  type ChangeProposalEvidence,
  type ChangeProposalMergeReconciliationStored,
} from "../../../../interpreter/changeProposal.ts";
import { gitObjectIdPattern } from "../../../../interpreter/finalizer.ts";
import { finalizerRole, schemaTextSet, type Migration } from "../shared.ts";

/**
 * The arms a stored merge reading names no proposal on, taken from the arm's own
 * type so an answer that grew evidence is a compile error here rather than a
 * CHECK that quietly stopped requiring one.
 */
const changeProposalMergeReadingsWithoutEvidence: readonly Exclude<
  ChangeProposalMergeReconciliationStored,
  { readonly evidence: ChangeProposalEvidence }
>["reconciled"][] = ["Absent", "Unstorable"];

/** The arms of one roster a stored result carries evidence for. */
function changeProposalKindsWithEvidence(
  roster: readonly string[],
  without: readonly string[],
): readonly string[] {
  return roster.filter((kind) => !without.includes(kind));
}

/** The arms of the merge reading roster a stored result carries evidence for. */
const changeProposalMergeReadingsWithEvidence = changeProposalKindsWithEvidence(
  allChangeProposalMergeReconciliationsStored,
  changeProposalMergeReadingsWithoutEvidence,
);

const finalizationChangeProposalMerge = [
  `ALTER TABLE finalization_change_proposal
     ADD COLUMN merge                    text,
     ADD COLUMN merge_reason             text,
     ADD COLUMN merge_commit             text,
     ADD COLUMN merge_reading            text,
     ADD COLUMN merge_reading_contradiction text,
     ADD COLUMN merge_reading_evidence   jsonb,
     ADD COLUMN merge_attempts           integer NOT NULL DEFAULT 0,
     ADD COLUMN merge_refusals           integer NOT NULL DEFAULT 0,
     ADD COLUMN merge_declines           integer NOT NULL DEFAULT 0,
     ADD COLUMN merge_readings           integer NOT NULL DEFAULT 0,
     ADD CONSTRAINT finalization_change_proposal_merge_is_whole CHECK (
       (merge IS NULL OR merge IN (${schemaTextSet([
         ...allChangeProposalMergeAnswers,
       ])}))
       AND (merge_reason IS NULL) = (merge IS DISTINCT FROM 'NotMergeable')
       AND (merge_reason IS NULL
         OR merge_reason IN (${schemaTextSet([
           ...allChangeProposalUnmergeableSettled,
         ])}))
       AND (merge_commit IS NULL) = (merge IS DISTINCT FROM 'Merged')
       AND (merge_commit IS NULL OR merge_commit ~ '${gitObjectIdPattern()}')
       AND (merge_reading IS NULL
         OR merge_reading IN (${schemaTextSet([
           ...allChangeProposalMergeReconciliationsStored,
         ])}))
       AND (merge_reading_evidence IS NULL OR merge_reading IS NOT NULL)
       AND (merge_reading IS NULL
         OR merge_reading NOT IN (${schemaTextSet(
           changeProposalMergeReadingsWithEvidence,
         )})
         OR merge_reading_evidence IS NOT NULL)
       AND (merge_reading_contradiction IS NULL)
         = (merge_reading IS DISTINCT FROM 'Contradictory')
       AND (merge_reading_contradiction IS NULL
         OR merge_reading_contradiction
            IN (${schemaTextSet(allChangeProposalContradictions)}))
       AND coalesce(length(merge_reading_evidence::text), 1)
         BETWEEN 1 AND ${proposalEvidenceCharsMax}),
     ADD CONSTRAINT finalization_change_proposal_merges_are_counted CHECK (
       merge_refusals >= 0 AND merge_declines >= 0 AND merge_readings >= 0
       AND merge_attempts
         BETWEEN merge_refusals + merge_declines
             AND merge_refusals + merge_declines + 1
       AND (merge IS NULL OR merge_attempts = merge_refusals + merge_declines + 1)
       AND (merge_attempts = 0
         OR creation_evidence IS NOT NULL
         OR reconciliation_evidence IS NOT NULL))`,
];

/**
 * What may still be written after a merge is asked for: the merge answer once,
 * its reading as often as one is read, and each counter one step at a time.
 * 052's trigger is replaced rather than added to, so one function is the whole
 * of what this row admits.
 */
const finalizationChangeProposalWriteOnce = [
  `CREATE OR REPLACE FUNCTION finalization_change_proposal_is_written_once()
     RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
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
              IS DISTINCT FROM (OLD.merge, OLD.merge_reason, OLD.merge_commit) THEN
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
             NOT IN (OLD.merge_readings, OLD.merge_readings + 1) THEN
         RAISE EXCEPTION 'a change proposal counts one act at a time'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `GRANT UPDATE (merge, merge_reason, merge_commit,
     merge_reading, merge_reading_contradiction, merge_reading_evidence,
     merge_attempts, merge_refusals, merge_declines, merge_readings)
     ON finalization_change_proposal TO ${finalizerRole}`,
];

/** A finalization that merges the proposal it opened, and records what the forge answered. */
export const migration093: Migration = {
  version: 93,
  name: "a proposal's own merge",
  statements: [
    ...finalizationChangeProposalMerge,
    ...finalizationChangeProposalWriteOnce,
  ],
};
