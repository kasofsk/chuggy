import { resumeTags } from "../../../../domain/generated/modelTypes.ts";
import { schemaTextSet, type Migration } from "../shared.ts";

/**
 * Admits the rework wall's own resume point, which the machine gained after
 * the projection's resume column was installed.
 *
 * THE RESUME CHECK IS REPLACED RATHER THAN LEFT TO MIGRATION 054. That
 * constraint is generated from `resumeTags`, so a fresh install already writes
 * the wider one; an installation that ran 054 before this point existed holds
 * the narrower one and its ledger will never run 054 again. This is migration
 * 043's arrangement, for the same reason.
 *
 * NOTHING IS BACKFILLED and nothing needs to be: no row can already carry the
 * new value, because no writer could have produced one against a constraint
 * that refused it.
 */
export const migration055: Migration = {
  version: 55,
  name: "the rework wall's resume point",
  statements: [
    `ALTER TABLE ticket_projection
       DROP CONSTRAINT ticket_projection_resume_is_known,
       ADD CONSTRAINT ticket_projection_resume_is_known CHECK (
         resume_at IS NULL OR resume_at IN (${schemaTextSet(resumeTags)})
       )`,
  ],
};
