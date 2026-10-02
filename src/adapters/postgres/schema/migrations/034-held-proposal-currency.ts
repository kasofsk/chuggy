/**
 * A held proposal is always one its writer could still accept: a decision
 * stays `AwaitingApproval` only while every ticket it names is at the version
 * its command was fenced at. The writer ends each held decision naming a
 * ticket it moves, in the transaction that moves it, and the selector ends one
 * whose ticket moved while its lead was deciding, in the transaction that
 * records it. Either ends the decision whole and records no review, since a
 * reviewer is shown a decision whole and nobody answered this one.
 *
 * Both, and a review, take the project's row lock, which the writer holds for
 * the whole of every decision. An answer is therefore ordered against every
 * move of the project's tickets: one that lands first is an approval the
 * writer's fence refuses afterwards, and one that lands after finds the
 * decision ended and changes nothing.
 */

import {
  boundaryOwnerRole,
  selectorProposalRetireFunction,
  selectorReviewFunction,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const retire = `public.${selectorProposalRetireFunction}(in_tenant text, in_project text)`;

export const migration034: Migration = {
  version: 34,
  name: "a held proposal ends when its ticket moves",
  statements: [
    `CREATE INDEX selector_proposal_delivery_held
       ON public.selector_proposal_delivery (tenant, project, ticket)
       WHERE state='AwaitingApproval'`,
    `CREATE FUNCTION ${retire} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR SHARE;
       UPDATE selector_proposal_delivery
          SET state='Terminal',outcome='{"state":"SelectionChanged"}'
        WHERE selector_decision IN (
            SELECT held.selector_decision FROM selector_proposal_delivery held
              JOIN ticket_projection moved
                ON moved.tenant=held.tenant AND moved.project=held.project
               AND moved.ticket=held.ticket
             WHERE held.tenant=in_tenant AND held.project=in_project
               AND held.state='AwaitingApproval'
               AND moved.seq<>(held.command::jsonb->>'expectedTicketVersion')::bigint);
     END $$`,
    `ALTER FUNCTION ${retire} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${retire} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${retire} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${retire} TO ${selectorServiceRole}`,
    `CREATE OR REPLACE FUNCTION public.${selectorReviewFunction}(in_decision text, in_tenant text, in_project text, in_review text, in_reviewer_kind text, in_reviewer_subject text, in_feedback text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
         BEGIN
           PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR SHARE;
           IF in_review='Approved' THEN
             UPDATE selector_proposal_delivery SET state='Pending',retry_at=now()
               WHERE selector_decision=in_decision AND tenant=in_tenant AND project=in_project
                 AND state='AwaitingApproval';
           ELSIF in_review='Rejected' THEN
             UPDATE selector_proposal_delivery SET state='Terminal',outcome=json_build_object(
                 'state','RejectedByUser','feedback',in_feedback)::text
               WHERE selector_decision=in_decision AND tenant=in_tenant AND project=in_project
                 AND state='AwaitingApproval';
           ELSE RAISE EXCEPTION 'invalid selector proposal review';
           END IF;
           IF FOUND THEN
             INSERT INTO selector_proposal_review
               (selector_decision,tenant,project,outcome,reviewer_kind,reviewer_subject,feedback)
             VALUES (in_decision,in_tenant,in_project,in_review,
               in_reviewer_kind,in_reviewer_subject,in_feedback);
           END IF;
           RETURN FOUND;
         END $$`,
    `SELECT ${selectorProposalRetireFunction}(tenant,project)
       FROM (SELECT DISTINCT tenant,project FROM selector_proposal_delivery
              WHERE state='AwaitingApproval') held`,
  ],
};
