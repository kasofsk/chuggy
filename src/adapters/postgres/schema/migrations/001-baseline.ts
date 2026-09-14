import { baselineFunctions } from "./baseline/functions.ts";
import { baselineRelations } from "./baseline/relations.ts";
import { baselineConstraints } from "./baseline/constraints.ts";
import { baselinePrivileges } from "./baseline/privileges.ts";
import { baselineSeed } from "./baseline/seed.ts";
import { roleStatement, type Migration } from "../shared.ts";

export const migration001: Migration = {
  version: 1,
  name: "the database baseline",
  statements: [
    ...[
      "chuggy_ticket_service",
      "chuggy_api",
      "chuggy_boundary_owner",
      "chuggy_selector_service",
      "chuggy_selector_control",
      "chuggy_selector_review",
      "chuggy_scheduler",
      "chuggy_finalizer",
      "chuggy_worker_plane",
      "chuggy_configuration_importer",
    ].map(roleStatement),
    "SET LOCAL check_function_bodies = false",
    ...baselineFunctions,
    ...baselineRelations,
    ...baselineConstraints,
    ...baselinePrivileges,
    ...baselineSeed,
  ],
};
