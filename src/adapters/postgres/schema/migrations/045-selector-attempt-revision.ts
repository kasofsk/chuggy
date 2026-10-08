/**
 * A selector attempt keeps the project revision its decision is fenced on, so a
 * process that did not begin the decision can still record it.
 *
 * THE REVISION IS `selector_project_state.revision` AS THE DECISION READ IT
 * before observing. The record is written only where the project still stands
 * at it, which is what lets a successor finish a predecessor's decision without
 * fencing on a revision it read itself.
 *
 * IT IS ADDITIVE. An attempt written before this has none, and the selector
 * reads that as a decision it cannot fence. The selector's own role may write
 * the column, as it writes the two settings revisions beside it.
 */

import { selectorServiceRole, type Migration } from "../shared.ts";

export const migration045: Migration = {
  version: 45,
  name: "a selector attempt keeps the project revision its decision is fenced on",
  statements: [
    `ALTER TABLE public.selector_attempt
       ADD COLUMN project_revision bigint,
       ADD CONSTRAINT selector_attempt_project_revision_check
         CHECK (project_revision IS NULL OR project_revision >= 0)`,
    `GRANT UPDATE(project_revision) ON TABLE public.selector_attempt TO ${selectorServiceRole}`,
  ],
};
