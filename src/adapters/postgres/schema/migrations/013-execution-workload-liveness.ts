import {
  poolPlaneRole,
  schedulerRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/**
 * When the workload itself last said anything, which no other column on this
 * row can answer.
 *
 * A LEASE IS THE CLAIMANT'S LIVENESS AND NOT THE WORKLOAD'S. A pool renews by
 * polling, and what it reports as held is read off its own fabric — a pod that
 * has not exited, a job that still has a name. Neither says the harness inside
 * is doing anything, so a workload that wedged keeps a lease renewed under it
 * for as long as its pool stays up. Outside Kubernetes nothing else bounds it
 * either: there is no active deadline on a Nomad allocation, so the deadline an
 * assignment carries is one the harness holds itself to and a harness that
 * stopped holding anything holds that too.
 *
 * So the workload stamps this column itself, under the attempt bearer and on
 * the plane only it reaches. A claim clears the stamp because it belongs to the
 * attempt that wrote it, and every claimant therefore holds the column: the
 * scheduler that binds a pod and the plane that hands a pool its assignment
 * both start an attempt, and a stamp surviving into the next one would read as
 * a workload that had spoken.
 */
export const migration013: Migration = {
  version: 13,
  name: "execution-workload-liveness",
  statements: [
    `ALTER TABLE ticket_execution ADD COLUMN last_reported_at timestamptz`,
    `GRANT UPDATE(last_reported_at) ON ticket_execution TO ${workerPlaneRole}`,
    `GRANT UPDATE(last_reported_at) ON ticket_execution TO ${schedulerRole}`,
    `GRANT SELECT(last_reported_at) ON ticket_execution TO ${poolPlaneRole}`,
    `GRANT UPDATE(last_reported_at) ON ticket_execution TO ${poolPlaneRole}`,
  ],
};
