import { apiRole, ticketServiceRole, type Migration } from "../shared.ts";

export const migration023: Migration = {
  version: 23,
  name: "authoring policy and dependable projection",
  statements: [
    `CREATE TABLE deployment_authoring_policy (
       singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
       domain_configuration text NOT NULL CHECK (length(domain_configuration) BETWEEN 1 AND 65536)
     )`,
    `ALTER TABLE ticket_projection ADD COLUMN dependable boolean NOT NULL DEFAULT true`,
    `UPDATE ticket_projection p SET dependable=false
      WHERE p.phase='Revoked' OR EXISTS (
        SELECT 1 FROM journal_entry j,
          jsonb_array_elements(j.entry::jsonb->'rec'->'transitions') transition
         WHERE j.tenant=p.tenant AND j.project=p.project AND j.seq=p.seq
           AND j.entry::jsonb->'rec'->>'label'='ticket-revoked'
           AND transition->>'to'='Escalated'
           AND (transition->>'ticket')::bigint=p.ticket
      )`,
    `GRANT SELECT ON deployment_authoring_policy TO ${apiRole},${ticketServiceRole}`,
    `GRANT INSERT ON deployment_authoring_policy TO ${ticketServiceRole}`,
    `GRANT UPDATE (domain_configuration) ON deployment_authoring_policy TO ${ticketServiceRole}`,
    `GRANT SELECT (dependable) ON ticket_projection TO ${apiRole}`,
    `GRANT UPDATE (dependable) ON ticket_projection TO ${ticketServiceRole}`,
  ],
};
