import { ticketServiceRole, type Migration } from "../shared.ts";

/**
 * The writer may move a ticket's configuration pin, which is what an update
 * resolved at another revision does to the ticket's projection row. 016 gave
 * the update its revision and not the pin, so every update's decision raised
 * `permission denied` and the partition could not be decided again.
 *
 * The api role keeps what 016 left it: the revision, and never the digest.
 *
 * NO GUARD, BECAUSE NOTHING STORED MOVES. A grant held already is granted again
 * as a no-op, so a database given this grant by hand migrates the same.
 */
export const migration017: Migration = {
  version: 17,
  name: "an update re-pins its ticket's configuration",
  statements: [
    `GRANT UPDATE(configuration_revision, configuration_digest)
       ON TABLE public.ticket_projection TO ${ticketServiceRole}`,
  ],
};
