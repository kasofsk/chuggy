import { ticketServiceRole, type Migration } from "../shared.ts";

/** The ticket service observes completed work source without broader execution authority. */
export const migration036: Migration = {
  version: 36,
  name: "ticket service execution source read",
  statements: [
    `GRANT SELECT (tenant,project,ticket,task,source_request,result_manifest)
       ON execution TO ${ticketServiceRole}`,
  ],
};
