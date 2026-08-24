import { selectorReviewRole, type Migration } from "../shared.ts";

export const migration018: Migration = {
  version: 18,
  name: "selector review schema readiness",
  statements: [`GRANT SELECT ON schema_migration TO ${selectorReviewRole}`],
};
