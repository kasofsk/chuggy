import { schedulerRole } from "../shared.ts";
import type { Migration } from "../shared.ts";

/**
 * The view one attempt's harness is served, resolved by the scheduler that
 * claimed the work and written beside the bearer that authenticates the fetch.
 *
 * A HARNESS MUST BE ABLE TO CARRY ALMOST NOTHING. It used to be handed its
 * whole view marshalled into the launcher's own envelope, which only a launcher
 * inside this cluster can write; a worker pool this tree did not write places
 * a process with a callback and a token and nothing else. So the view is
 * materialised here, where the plane already reads the attempt by the digest of
 * that token, and the plane needs no reach into the ticket machine to serve it.
 */
export const migration006: Migration = {
  version: 6,
  name: "execution-worker-view",
  statements: [
    `ALTER TABLE ticket_execution ADD COLUMN worker_view jsonb`,
    `GRANT UPDATE(worker_view) ON ticket_execution TO ${schedulerRole}`,
  ],
};
