/**
 * What one ticket selects from the catalog its configuration is.
 *
 * A SELECTION NAMES ENTRIES AND NEVER WRITES ONE. Each field is a name in the
 * pinned version 2 configuration, so a ticket chooses among the workloads,
 * plans and finalizers its repository's reviewed catalog declared, and nothing
 * it says can reach past what that review allowed. A field left out is the
 * catalog's default.
 *
 * ONLY A CATALOG HAS ANYTHING TO SELECT. A version 1 configuration is one
 * document, so a selection naming anything is refused against it, and a draft
 * pinning one carries none, which is every draft written before catalogs.
 */

import { z } from "zod";

import { configurationCatalogNameSchema } from "./configurationDocument.ts";

/** The catalog entries one ticket runs on, each the catalog's default where it is absent. */
export const configurationSelectionSchema = z.strictObject({
  work: configurationCatalogNameSchema.optional(),
  evaluation: configurationCatalogNameSchema.optional(),
  finalization: configurationCatalogNameSchema.optional(),
});

export type ConfigurationSelection = z.infer<
  typeof configurationSelectionSchema
>;

/** Whether a selection names nothing, which is the selection every ticket on a version 1 configuration holds. */
export function configurationSelectionEmpty(
  selection: ConfigurationSelection | undefined,
): boolean {
  return (
    selection === undefined ||
    (selection.work === undefined &&
      selection.evaluation === undefined &&
      selection.finalization === undefined)
  );
}
