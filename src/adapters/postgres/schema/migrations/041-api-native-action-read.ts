import { apiRole, type Migration } from "../shared.ts";

/**
 * Lets the public read answer a ticket's open questions. The grant is column
 * by column: the attempt an approval is bound to, the answer already given and
 * the effect that materialized the action are the desk's, not a reader's.
 */
export const migration041: Migration = {
  version: 41,
  name: "api native action read",
  statements: [
    `GRANT SELECT (tenant, project, action, ticket, kind, authorizing_seq, state)
       ON native_action TO ${apiRole}`,
    `GRANT SELECT (tenant, project, action, resolution)
       ON native_action_resolution TO ${apiRole}`,
  ],
};
