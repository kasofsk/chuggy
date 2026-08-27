import { finalizerRole, type Migration } from "../shared.ts";

/**
 * Migration 42 gave the brief to the roles that render it, and a finalization's
 * target is now narrowed by the branch it names, so the finalizer reads the
 * same two relations the brief is spelled across.
 */
export const migration045: Migration = {
  version: 45,
  name: "finalizer ticket brief read",
  statements: [
    `GRANT SELECT ON draft_brief,draft_brief_link TO ${finalizerRole}`,
  ],
};
