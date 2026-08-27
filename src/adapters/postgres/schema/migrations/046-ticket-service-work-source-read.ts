import { ticketServiceRole, type Migration } from "../shared.ts";

/**
 * An evaluation is observed against the commit its work produced, so the ticket
 * service reads the declaration alongside the execution row that carries the
 * manifest it is keyed by.
 */
export const migration046: Migration = {
  version: 46,
  name: "ticket service work source read",
  statements: [
    `GRANT SELECT (tenant,project,manifest,commit)
       ON execution_result_source TO ${ticketServiceRole}`,
  ],
};
