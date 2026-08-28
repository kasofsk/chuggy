import {
  allChangeProposalContradictions,
  allChangeProposalCreations,
  allChangeProposalReconciliations,
  changeProposalRequestIdentityChars,
  proposalBodyCharsMax,
  proposalDisplayUrlCharsMax,
  proposalEvidenceCharsMax,
  proposalTitleCharsMax,
} from "../../../../interpreter/changeProposal.ts";
import {
  finalizerIdentityCharsMax,
  gitObjectIdPattern,
  gitRefNameCharsMax,
} from "../../../../interpreter/finalizer.ts";
import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  schemaTextSet,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * The row one change proposal leaves. It is written before the forge is asked
 * for the proposal and its creation result exactly once afterwards, so a crash
 * between the two leaves a row with no result — which is a create that may have
 * happened, and is the only reason this relation exists rather than the request
 * being rebuilt each pass.
 *
 * A ROW WITH NO CREATION RESULT IS THE ROW THAT CRASH LEAVES, so nothing here
 * requires one before a reading may be recorded. A constraint demanding a
 * creation beside a reconciliation would forbid exactly the recovery this
 * relation exists for: the reading that settles a create nobody heard back
 * from is written against a row with no creation, and the count it increments
 * is what bounds it.
 *
 * WHAT WAS ASKED FOR IS RECORDED BESIDE WHAT CAME BACK. The head and base each
 * carry the commit they were observed at, and neither is derivable afterwards:
 * a rebuild reads whatever those refs hold now, and an operator settling a hold
 * needs what the forge was actually sent. The refs, the title and the body are
 * beside them because they are what a read compares field by field.
 *
 * A RESULT IS A KIND AND ITS EVIDENCE, as a reconciliation verdict is. The
 * evidence is one document rather than a column apiece because the pure layer
 * compares every field of it against the request, so a column omitted here
 * would be a comparison that silently stopped happening.
 */
const finalizationChangeProposal = [
  `CREATE TABLE finalization_change_proposal (
     tenant           text NOT NULL,
     project          text NOT NULL,
     request          text NOT NULL,
     permit           text NOT NULL,
     proposal_request text NOT NULL,
     head_ref         text NOT NULL,
     head_commit      text NOT NULL,
     base_ref         text NOT NULL,
     base_commit      text NOT NULL,
     title            text NOT NULL,
     body             text NOT NULL,
     creation               text,
     creation_contradiction text,
     creation_evidence      jsonb,
     proposal_url           text,
     reconciliation               text,
     reconciliation_contradiction text,
     reconciliation_evidence      jsonb,
     reconciliations      integer NOT NULL DEFAULT 0,
     opened_at        timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, request),
     CONSTRAINT finalization_change_proposal_has_its_request
       FOREIGN KEY (tenant, project, request)
       REFERENCES finalization_request (tenant, project, request),
     CONSTRAINT finalization_change_proposal_has_its_permit
       FOREIGN KEY (tenant, project, permit)
       REFERENCES commit_permit (tenant, project, permit),
     CONSTRAINT finalization_change_proposal_identity_is_never_reused
       UNIQUE (proposal_request),
     CONSTRAINT finalization_change_proposal_identity_is_a_digest CHECK (
       proposal_request ~ '^[0-9a-f]{${changeProposalRequestIdentityChars}}$'),
     CONSTRAINT finalization_change_proposal_commits_are_object_ids CHECK (
       head_commit ~ '${gitObjectIdPattern()}'
       AND base_commit ~ '${gitObjectIdPattern()}'),
     CONSTRAINT finalization_change_proposal_text_is_bounded CHECK (
       length(permit) BETWEEN 1 AND ${finalizerIdentityCharsMax}
       AND length(head_ref) BETWEEN 1 AND ${gitRefNameCharsMax}
       AND length(base_ref) BETWEEN 1 AND ${gitRefNameCharsMax}
       AND length(title) BETWEEN 1 AND ${proposalTitleCharsMax}
       AND length(body) BETWEEN 1 AND ${proposalBodyCharsMax}
       AND coalesce(length(proposal_url), 1) BETWEEN 1 AND ${proposalDisplayUrlCharsMax}),
     CONSTRAINT finalization_change_proposal_results_are_whole CHECK (
       (creation IS NULL
         OR creation IN (${schemaTextSet(allChangeProposalCreations)}))
       AND (reconciliation IS NULL
         OR reconciliation IN (${schemaTextSet(allChangeProposalReconciliations)}))
       AND (creation_evidence IS NULL OR creation IS NOT NULL)
       AND (reconciliation_evidence IS NULL OR reconciliation IS NOT NULL)
       AND (creation_contradiction IS NULL) = (creation IS DISTINCT FROM 'Contradictory')
       AND (reconciliation_contradiction IS NULL)
         = (reconciliation IS DISTINCT FROM 'Contradictory')
       AND (creation_contradiction IS NULL
         OR creation_contradiction IN (${schemaTextSet(allChangeProposalContradictions)}))
       AND (reconciliation_contradiction IS NULL
         OR reconciliation_contradiction IN (${schemaTextSet(allChangeProposalContradictions)}))),
     CONSTRAINT finalization_change_proposal_reconciliations_are_counted CHECK (
       reconciliations >= 0),
     CONSTRAINT finalization_change_proposal_evidence_is_bounded CHECK (
       coalesce(length(creation_evidence::text), 1)
         BETWEEN 1 AND ${proposalEvidenceCharsMax}
       AND coalesce(length(reconciliation_evidence::text), 1)
         BETWEEN 1 AND ${proposalEvidenceCharsMax})
   )`,
  `CREATE INDEX finalization_change_proposal_unanswered
     ON finalization_change_proposal (opened_at) WHERE creation IS NULL`,
];

/**
 * What may still be written after the row exists: the creation result once, and
 * the reconciliation's as often as one is read. Everything the forge was asked
 * for is immutable, so a second pass cannot rewrite the request it is
 * reconciling and then call the answer a match.
 */
const finalizationChangeProposalWriteOnce = [
  `CREATE FUNCTION finalization_change_proposal_is_written_once()
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
       RETURN NEW;
     END $$`,
  `ALTER FUNCTION finalization_change_proposal_is_written_once()
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE EXECUTE ON FUNCTION finalization_change_proposal_is_written_once()
     FROM PUBLIC`,
  `CREATE TRIGGER finalization_change_proposal_is_written_once
     BEFORE UPDATE OR DELETE ON finalization_change_proposal
     FOR EACH ROW EXECUTE FUNCTION finalization_change_proposal_is_written_once()`,
  `REVOKE ALL ON finalization_change_proposal
     FROM ${apiRole}, ${ticketServiceRole}, ${selectorServiceRole}, ${schedulerRole}`,
  `GRANT SELECT, INSERT ON finalization_change_proposal TO ${finalizerRole}`,
  `GRANT UPDATE (creation, creation_contradiction, creation_evidence,
     proposal_url, reconciliation, reconciliation_contradiction,
     reconciliation_evidence, reconciliations)
     ON finalization_change_proposal TO ${finalizerRole}`,
];

/**
 * A ticket that finishes by opening a change proposal. The row is the finalizer
 * role's alone: nothing else may read what a forge was asked for, and nothing at
 * all may decide a ticket from it.
 */
export const migration052: Migration = {
  version: 52,
  name: "the finalization change proposal",
  statements: [
    ...finalizationChangeProposal,
    ...finalizationChangeProposalWriteOnce,
  ],
};
