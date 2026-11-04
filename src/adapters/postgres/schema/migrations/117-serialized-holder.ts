/**
 * The finalizer reads which phase a ticket is in, so a Serialized ticket
 * waiting on the holder of its reference is not claimed.
 *
 * The holder is derived and stored nowhere (`src/interpreter/serializedHolder.ts`),
 * and whether a ticket is still on the path from a re-check send-back to its
 * landing is a fact of `ticket_projection.phase` alone: a ticket between the
 * send-back and its next finalization request has no request to show it.
 *
 * `ticket_projection` IS GRANTED `SELECT` ON FOUR COLUMNS, `tenant`, `project`,
 * `ticket` and `phase`, and nothing else. The finalizer still holds no `UPDATE`,
 * `INSERT` or `DELETE` on it, which is what keeps a conclusion from being forged
 * there; a conclusion reaches the mailbox through its door alone.
 */

import { finalizerRole, type Migration } from "../shared.ts";

export const migration117: Migration = {
  version: 117,
  name: "the finalizer reads the phase a ticket is in",
  statements: [
    `GRANT SELECT(tenant, project, ticket, phase) ON TABLE public.ticket_projection TO ${finalizerRole}`,
  ],
};
