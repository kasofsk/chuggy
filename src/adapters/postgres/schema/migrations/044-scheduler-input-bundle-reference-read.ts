import { schedulerRole, type Migration } from "../shared.ts";

/**
 * Migration 13 revoked the scheduler's privileges on `input_bundle_reference`,
 * and the prior-work-reports read migration 37 opened joins that table to reach
 * the manifests an evaluation's bundle pinned.
 */
export const migration044: Migration = {
  version: 44,
  name: "scheduler input bundle reference read",
  statements: [`GRANT SELECT ON input_bundle_reference TO ${schedulerRole}`],
};
