import { resumeTags } from "../../../../domain/generated/modelTypes.ts";
import {
  apiRole,
  schemaTextSet,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * Projects where a resume would re-enter a parked ticket and what the ticket
 * has left to spend, so the public read serves both without the desk and
 * without a browser re-deriving the machine.
 *
 * WRITTEN FROM THE SAME CORE SNAPSHOT AS `phase` AND `reason`, in the
 * transaction that journals the decision. That is the whole of why these may be
 * stored at all: the projection is one read of one post-state, so no column of
 * a row can be at a journal position another column is not.
 *
 * EVERY COLUMN IS NULLABLE AND NONE IS BACKFILLED, because there is nowhere
 * honest to backfill from — the accounts and the resume point live only in the
 * journaled core, and the desk task migration 039 recovered `reason` from
 * records no equivalent of. So a row keeps NULL until its ticket's next
 * journaled decision, and the read omits what it does not hold rather than
 * naming a default that would read as a figure.
 *
 * `finalization_left` CARRIES A SECOND ABSENCE: a ticket priced `DeadlineOnly`
 * budgets no finalization account, and the writer leaves the column NULL for
 * one rather than writing the zero such a ticket's account stands at. The two
 * absences are told apart by `gas_left`, which every accounted row carries, and
 * the CHECK below is what keeps that true.
 *
 * THE DEPLOYMENT'S GAS IS NOT HERE. Every ticket is released with it, it is a
 * singleton of `deployment_authoring_policy` that a writer refuses to start
 * against a different value of, and a copy per ticket row would be a stored
 * duplicate of a derivable fact.
 */
export const migration054: Migration = {
  version: 54,
  name: "ticket resume and accounts projection",
  statements: [
    `ALTER TABLE ticket_projection
       ADD COLUMN resume_at text,
       ADD COLUMN gas_left bigint,
       ADD COLUMN rework_left bigint,
       ADD COLUMN finalization_left bigint,
       ADD CONSTRAINT ticket_projection_resume_is_known CHECK (
         resume_at IS NULL OR resume_at IN (${schemaTextSet(resumeTags)})
       ),
       ADD CONSTRAINT ticket_projection_accounts_are_not_negative CHECK (
         coalesce(gas_left, 0) >= 0 AND coalesce(rework_left, 0) >= 0
           AND coalesce(finalization_left, 0) >= 0
       ),
       ADD CONSTRAINT ticket_projection_accounts_are_whole CHECK (
         (gas_left IS NULL) = (rework_left IS NULL)
           AND (gas_left IS NOT NULL OR finalization_left IS NULL)
       )`,
    `GRANT SELECT (resume_at, gas_left, rework_left, finalization_left)
       ON ticket_projection TO ${apiRole}`,
    `GRANT UPDATE (resume_at, gas_left, rework_left, finalization_left)
       ON ticket_projection TO ${ticketServiceRole}`,
  ],
};
