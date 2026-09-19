import type { Migration } from "../shared.ts";

/**
 * The uniqueness one attempt's bearer already had by construction and did not
 * have on the relation.
 *
 * A BEARER IS THE WHOLE OF WHAT A HARNESS KNOWS. It is drawn per claim by the
 * same mint that draws the assignment migration 7 made unique, and the plane
 * serving harnesses resolves the view, the credential mint and the terminal
 * through its digest alone. Resolving a row by a value nothing held to one row
 * is a `LIMIT`-less read that returns an arbitrary match, so the property the
 * three statements rest on is asserted here rather than assumed of the caller
 * that writes it.
 *
 * A REUSED BEARER IS NOW A REFUSED CLAIM. A pool client that placed two
 * assignments under one token would otherwise have bound two live attempts to
 * one credential, and either of them could report the other's outcome; the
 * constraint turns that into the second claim failing, which is the failure a
 * caller can see. Unbound rows carry NULL and are not constrained, because a
 * unique index admits as many nulls as there are rows.
 */
export const migration011: Migration = {
  version: 11,
  name: "execution-capability-digest",
  statements: [
    `ALTER TABLE ticket_execution
       ADD CONSTRAINT ticket_execution_capability_digest_key UNIQUE(capability_digest)`,
  ],
};
