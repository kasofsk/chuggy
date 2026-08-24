import {
  apiRole,
  finalizerRole,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

export const migration016: Migration = {
  version: 16,
  name: "runtime schema readiness",
  statements: [
    `GRANT SELECT ON schema_migration TO ${apiRole},${ticketServiceRole},
         ${selectorServiceRole},${schedulerRole},${finalizerRole}`,
  ],
};
