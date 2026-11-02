/**
 * The metrics plane reads each ticket's history: its journal, who first wrote
 * its draft, the authority of the operation that decided an entry, and the
 * escalation a ticket stands at. It is granted those columns alone, as 091
 * granted the rest.
 */

import { metricsPlaneRole, type Migration } from "../shared.ts";

/** Each relation the ticket reads name, and the columns of it they name that the plane was not granted already. */
const metricsPlaneTicketColumns: readonly (readonly [string, string])[] = [
  [
    "journal_entry",
    "tenant,project,seq,entry,committed_at,cause_kind,cause_id,configuration_revision",
  ],
  [
    "draft_revision",
    "tenant,project,ticket,authoring_version,authority_kind,authority_subject",
  ],
  ["operation", "tenant,project,operation,authority_kind"],
  ["ticket_projection", "ticket,escalation"],
];

export const migration108: Migration = {
  version: 108,
  name: "the metrics plane reads each ticket's history",
  statements: metricsPlaneTicketColumns.map(
    ([relation, columns]) =>
      `GRANT SELECT(${columns}) ON TABLE public.${relation} TO ${metricsPlaneRole}`,
  ),
};
