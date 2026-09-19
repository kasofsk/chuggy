import { schedulerRole, type Migration } from "../shared.ts";

/**
 * The scheduler reads the journal it writes to, which it was never granted.
 *
 * IT SUBMITS THROUGH A FUNCTION AND READS THROUGH THE TABLE. An Execution-origin
 * input goes in via `accept_ticket_execution_input`, which is SECURITY DEFINER
 * and owned by the boundary owner — so the INSERT needed no grant and none was
 * written. Reading back what a submission became does not go through that
 * function: `postgresTicketMachine` selects the accepted input by identity, as
 * itself, and migration 002 granted `ticket_machine_input` to the API, the
 * ticket service and the boundary owner and not to this role.
 *
 * NOTHING REACHED IT UNTIL A TICKET WAS DISPATCHED. The scheduler starts,
 * connects, asserts its `current_user` and idles clean; the read happens on the
 * first execution it has to report a terminal for. So an installation looks
 * healthy for as long as it has no work, and fails with `permission denied for
 * table ticket_machine_input` the moment it has some.
 *
 * SELECT ON THE TABLE AND NOT ON COLUMNS, unlike the UPDATE grants beside it.
 * The read wants the command, the origin, the decision, the sequence, the
 * attribution and the metadata, which is every column the key does not already
 * name — a column list here would be the whole table written out and one more
 * place to forget when a column is added.
 */
export const migration016: Migration = {
  version: 16,
  name: "scheduler-reads-machine-input",
  statements: [`GRANT SELECT ON ticket_machine_input TO ${schedulerRole}`],
};
