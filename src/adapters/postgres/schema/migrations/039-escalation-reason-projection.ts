import { reasonTags } from "../../../../domain/generated/modelTypes.ts";
import {
  apiRole,
  schemaTextSet,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/** Projects the wall a parked ticket hit so the public read serves it without the desk. */
export const migration039: Migration = {
  version: 39,
  name: "escalation reason projection",
  statements: [
    `ALTER TABLE ticket_projection
       ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'NoReason'`,
    `ALTER TABLE ticket_projection
       DROP CONSTRAINT IF EXISTS ticket_projection_reason_is_known`,
    `ALTER TABLE ticket_projection
       ADD CONSTRAINT ticket_projection_reason_is_known
       CHECK (reason IN (${schemaTextSet(reasonTags)}))`,
    `UPDATE ticket_projection p SET reason=a.reason
       FROM native_action a
      WHERE a.tenant=p.tenant AND a.project=p.project AND a.ticket=p.ticket
        AND a.state='Open' AND a.kind='TicketEscalation'
        AND p.phase='Escalated' AND p.reason='NoReason'`,
    `GRANT SELECT (reason) ON ticket_projection TO ${apiRole}`,
    `GRANT UPDATE (reason) ON ticket_projection TO ${ticketServiceRole}`,
  ],
};
