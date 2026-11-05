/**
 * The finalizer asks whether an evaluation sent a ticket back to work after a
 * journal position, so a Serialized re-check whose evaluation failed stops
 * holding its reference.
 *
 * `ticket_evaluation_reworked_since` IS A DOOR, NOT A GRANT. It answers whether
 * the journal holds a `TicketEvaluationReworkStarted`,
 * `TicketEvaluationFailureInvalidated` or `TicketEvaluationInvalidated` naming
 * the ticket past the position, the three arms by which an evaluation starts a
 * work cycle. The finalizer still reads nothing of the journal itself.
 *
 * `journal_entry` IS GRANTED `SELECT(seq)` TO THE BOUNDARY OWNER, beside the
 * `tenant`, `project` and `entry` 013 granted, so the door can bound its read
 * by position.
 */

import {
  boundaryOwnerRole,
  finalizerRole,
  ticketEvaluationReworkedSinceFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketEvaluationReworkedSinceFunction}(in_tenant text, in_project text, in_ticket bigint, in_seq bigint)`;

export const migration119: Migration = {
  version: 119,
  name: "the finalizer asks whether an evaluation sent a ticket back to work",
  statements: [
    `GRANT SELECT(seq) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${signature} RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT EXISTS (
         SELECT 1 FROM journal_entry j
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND j.seq > in_seq
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->>'type' END)
                  IN ('TicketEvaluationReworkStarted',
                      'TicketEvaluationFailureInvalidated',
                      'TicketEvaluationInvalidated')
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->'value'->'ticket' END)
                  = to_jsonb(in_ticket))
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${finalizerRole}`,
  ],
};
