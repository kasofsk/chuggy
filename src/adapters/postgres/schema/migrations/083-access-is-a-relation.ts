/**
 * Project access leaves this database. `authorize_project_access` and the
 * `project_membership` table it read are dropped, and every definer that
 * joined that table for a name derives one instead.
 *
 * THE DERIVATION IS `src/interpreter/projectAccess.ts`'s AND IS STATED THERE.
 * A principal's authority is the principal itself under one kind, so the owner
 * of a thread, the asker of an inquiry and the authorship the wake bridge
 * matches on are all reachable from the session row alone. `owner` and `asker`
 * are not answered here at all rather than answered as a second copy of
 * `principal`: standing rule 3 rejects the duplicate, and the boundary is where
 * a name is now resolved from.
 *
 * `Orphaned` LEAVES THE MAILBOX DOORS BECAUSE THE TABLE WAS THE ONLY THING
 * THEY COULD ASK. The API authorizes `Mutate` before it enqueues and the
 * selector authorizes `Read` before it wakes, so the fact the arm reported is
 * one both callers already hold; a door reading a table that is gone would
 * report every member orphaned instead.
 *
 * NOTHING BACKFILLS. Tuples for every existing member are written with
 * `src/roots/provisionProjectAccess.ts` against the authority before this
 * migration is applied; a principal with no tuple is refused from the moment
 * the API is restarted, which is what makes the write a precondition of the
 * release rather than a follow-up to it.
 *
 * ROWS WRITTEN BEFORE THIS MIGRATION STOP MATCHING THEIR AUTHOR, and that loss
 * is accepted rather than repaired: they carry the operator-chosen kind and
 * subject the dropped table supplied, not the one a principal derives, so a
 * draft written before the cutover is no longer seeded into its author's next
 * thread and a ticket authored before it wakes nobody.
 * `deploy/rig/keto/README.md` names this as a release step.
 *
 * `project_membership_grants_no_boundary_authority` GOES WITH THE TABLE AND ITS
 * RULE IS NOW STRUCTURAL. That CHECK existed because an authority kind was a
 * granted string an administrator chose; the kind is a constant in the
 * interpreter now, so no writer can name a boundary's kind at all.
 */

import {
  leadInquiriesReadFunction,
  leadInquiryReadFunction,
  projectAuthorizationFunction,
  type Migration,
} from "../shared.ts";
import { threadMailboxDoor, threadMailboxDoors } from "./062-threads.ts";
import {
  inquiryDoorGrants,
  inquiryReadSignatures,
  leadInquiryReads,
} from "./063-lead-inquiries.ts";
import { threadWakeCandidatesRead } from "./071-change-row-reason.ts";
import {
  threadListingCarriesTheRail,
  threadReadGrants,
  threadStandingCarriesTheRail,
} from "./079-thread-rail.ts";

/**
 * The authority kind this migration was applied with. It is written out here
 * rather than read from the interpreter because the ledger keeps no digest of
 * a body it has applied, so a kind that moves later must not reach back into
 * this one — and a rename that leaves the two disagreeing is then red on the
 * next run rather than a bridge that silently matches nothing.
 */
const memberAuthorityKindApplied = "Member";

/** A revision this session's principal authored, under the authority the interpreter derives for them. */
const authoredUnderTheDerivedAuthority = `EXISTS(SELECT 1 FROM draft_revision r
                      WHERE r.tenant=c.tenant AND r.project=c.project
                        AND r.ticket::text=c.resource
                        AND r.authority_kind='${memberAuthorityKindApplied}'
                        AND r.authority_subject=s.principal)`;

const doorsStopAskingForAMembership = threadMailboxDoors.map(
  (door) =>
    `CREATE OR REPLACE ${threadMailboxDoor({ ...door, orphaned: false })}`,
);

const inquiryReadsStopNamingAnAsker = [
  `DROP FUNCTION ${leadInquiriesReadFunction}(text,text,bigint)`,
  `DROP FUNCTION ${leadInquiryReadFunction}(text,text,text)`,
  ...leadInquiryReads({ asker: false }),
  ...inquiryDoorGrants(inquiryReadSignatures),
];

const theAuthorityLeavesTheDatabase = [
  `DROP FUNCTION ${projectAuthorizationFunction}(text,text,text,text)`,
  `DROP TABLE project_membership`,
];

/** Who may address a project is the authority's to answer, and no row here says so. */
export const migration083: Migration = {
  version: 83,
  name: "project access is a relation, not a row",
  statements: [
    ...doorsStopAskingForAMembership,
    ...threadWakeCandidatesRead(authoredUnderTheDerivedAuthority),
    ...threadListingCarriesTheRail({ owner: false }),
    ...threadStandingCarriesTheRail({ owner: false }),
    ...threadReadGrants,
    ...inquiryReadsStopNamingAnAsker,
    ...theAuthorityLeavesTheDatabase,
  ],
};
