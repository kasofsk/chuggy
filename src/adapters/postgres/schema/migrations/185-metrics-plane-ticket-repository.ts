/**
 * The metrics plane reads the repository each ticket's brief names, which it
 * labels the ticket's families and its executions' by.
 *
 * `ticket_definition.repository` IS THE BRIEF'S, generated from
 * `ticket_definition.brief` and so never apart from it: the brief the ticket
 * was released or last updated with, which is the one it runs. The plane is
 * granted it and not the brief, which holds the intent beside it, and it joins
 * by the keys 091 already granted. `draft_brief.repository` is the draft's,
 * which a `Pending` ticket's revision moves with no update to follow it, and
 * `ticket_source` holds a row only once the ticket has run.
 */

import { metricsPlaneRole, type Migration } from "../shared.ts";

export const migration185: Migration = {
  version: 185,
  name: "the metrics plane reads the repository each ticket's brief names",
  statements: [
    `ALTER TABLE public.ticket_definition
       ADD COLUMN repository text GENERATED ALWAYS AS (brief->>'repository') STORED`,
    `GRANT SELECT(repository) ON TABLE public.ticket_definition TO ${metricsPlaneRole}`,
  ],
};
