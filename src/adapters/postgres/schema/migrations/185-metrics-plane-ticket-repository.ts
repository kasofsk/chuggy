/**
 * The metrics plane reads the repository each ticket's brief names, which it
 * labels the ticket's families and its executions' by.
 *
 * `draft_brief.repository` IS THE COLUMN, one row per ticket, the brief a
 * release stored and every revision of it while the ticket is `Pending`, and
 * fixed once it leaves. `ticket_source` holds a row only once the ticket has
 * run, and `ticket_definition.brief` holds the intent beside the repository.
 * The plane is granted the repository and the keys it joins by, as 091 granted
 * the rest, and not the intent or any other column of the brief.
 */

import { metricsPlaneRole, type Migration } from "../shared.ts";

export const migration185: Migration = {
  version: 185,
  name: "the metrics plane reads the repository each ticket's brief names",
  statements: [
    `GRANT SELECT(tenant,project,ticket,repository) ON TABLE public.draft_brief TO ${metricsPlaneRole}`,
  ],
};
