import { selectorReviewRole, type Migration } from "../shared.ts";

/**
 * The selector review group reads the ledger no longer. That read is how a
 * serving process proves its schema before it serves, and no process connects
 * as this group any more: the API's pool that did is gone.
 */
export const migration194: Migration = {
  version: 194,
  name: "the selector review group stops reading the ledger",
  statements: [
    `REVOKE SELECT ON TABLE public.schema_migration FROM ${selectorReviewRole}`,
  ],
};
